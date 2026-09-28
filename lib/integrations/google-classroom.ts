import "server-only";

import { google } from "googleapis";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, students } from "@/db/schema";
import type { ExternalStudent, SyncResult } from "@/lib/integrations/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
];

function oauthClient() {
  const clientId = process.env.GOOGLE_CLASSROOM_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLASSROOM_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    throw new Error(
      "GOOGLE_CLASSROOM_CLIENT_ID / GOOGLE_CLASSROOM_CLIENT_SECRET / NEXT_PUBLIC_APP_URL must be set.",
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${appUrl}/api/integrations/google/callback`,
  );
}

export function isGoogleClassroomConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLASSROOM_CLIENT_ID && process.env.GOOGLE_CLASSROOM_CLIENT_SECRET,
  );
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline", // refresh token → periodic re-sync
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

/** Exchanges the callback code and stores tokens on the teacher's profile. */
export async function storeTokensFromCallback(input: {
  code: string;
  profileId: string;
  schoolId: string;
}): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(input.code);
  if (!tokens.access_token) throw new Error("Google returned no access token.");

  const values = {
    profileId: input.profileId,
    schoolId: input.schoolId,
    provider: "google_classroom" as const,
    accessToken: encryptSecret(tokens.access_token),
    refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(integrationConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [integrationConnections.profileId, integrationConnections.provider],
      set: {
        accessToken: values.accessToken,
        // Google only re-issues the refresh token on fresh consent.
        ...(values.refreshToken ? { refreshToken: values.refreshToken } : {}),
        expiryDate: values.expiryDate,
        scope: values.scope,
        updatedAt: values.updatedAt,
      },
    });
}

async function authorizedClient(profileId: string) {
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.profileId, profileId),
      eq(integrationConnections.provider, "google_classroom"),
    ),
  });
  if (!connection) return null;

  const client = oauthClient();
  client.setCredentials({
    access_token: decryptSecret(connection.accessToken),
    refresh_token: connection.refreshToken
      ? decryptSecret(connection.refreshToken)
      : undefined,
    expiry_date: connection.expiryDate?.getTime(),
  });

  // Persist silently refreshed tokens.
  client.on("tokens", (tokens) => {
    void db
      .update(integrationConnections)
      .set({
        ...(tokens.access_token
          ? { accessToken: encryptSecret(tokens.access_token) }
          : {}),
        ...(tokens.expiry_date ? { expiryDate: new Date(tokens.expiry_date) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.id, connection.id))
      .catch(() => {});
  });

  return client;
}

export async function isConnected(profileId: string): Promise<boolean> {
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.profileId, profileId),
      eq(integrationConnections.provider, "google_classroom"),
    ),
    columns: { id: true },
  });
  return Boolean(connection);
}

export async function disconnect(profileId: string): Promise<void> {
  await db
    .delete(integrationConnections)
    .where(
      and(
        eq(integrationConnections.profileId, profileId),
        eq(integrationConnections.provider, "google_classroom"),
      ),
    );
}

// ---------------------------------------------------------------------------
// Roster sync
// ---------------------------------------------------------------------------

/**
 * Imports every active course's students into the school roster.
 * Upserts on (school, source, externalId) so re-syncs update names/classes
 * instead of duplicating.
 */
export async function syncRoster(
  profileId: string,
  schoolId: string,
): Promise<SyncResult> {
  const auth = await authorizedClient(profileId);
  if (!auth) throw new Error("Google Classroom är inte ansluten.");

  const classroom = google.classroom({ version: "v1", auth });

  const coursesRes = await classroom.courses.list({
    teacherId: "me",
    courseStates: ["ACTIVE"],
    pageSize: 100,
  });
  const courses = coursesRes.data.courses ?? [];

  const externalStudents: ExternalStudent[] = [];
  for (const course of courses) {
    if (!course.id) continue;
    let pageToken: string | undefined;
    do {
      const res = await classroom.courses.students.list({
        courseId: course.id,
        pageSize: 100,
        pageToken,
      });
      for (const s of res.data.students ?? []) {
        if (!s.userId) continue;
        externalStudents.push({
          externalId: s.userId,
          fullName: s.profile?.name?.fullName ?? "Okänt namn",
          email: s.profile?.emailAddress ?? null,
          className: course.name ?? "Okänd klass",
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  let imported = 0;
  let updated = 0;
  for (const s of externalStudents) {
    const [row] = await db
      .insert(students)
      .values({
        schoolId,
        source: "google_classroom",
        externalId: s.externalId,
        fullName: s.fullName,
        email: s.email,
        className: s.className,
      })
      .onConflictDoUpdate({
        target: [students.schoolId, students.source, students.externalId],
        // Must match the partial unique index (external_id IS NOT NULL).
        targetWhere: sql`external_id is not null`,
        set: {
          fullName: s.fullName,
          email: s.email,
          className: s.className,
          updatedAt: sql`now()`,
        },
      })
      .returning({ createdAt: students.createdAt, updatedAt: students.updatedAt });

    if (row && row.createdAt.getTime() === row.updatedAt.getTime()) imported += 1;
    else updated += 1;
  }

  return {
    coursesSeen: courses.length,
    studentsImported: imported,
    studentsUpdated: updated,
  };
}
