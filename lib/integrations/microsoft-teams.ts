import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, students } from "@/db/schema";
import type { ExternalStudent, SyncResult } from "@/lib/integrations/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Microsoft Teams (EDU) roster sync via Microsoft Graph education APIs.
 * Same provider contract as Google Classroom; plain fetch — no SDK needed.
 *
 * Entra ID app registration requirements (docs/INTEGRATIONS.md):
 * delegated scopes EducationClass.ReadBasic.All + EducationRoster.ReadBasic.All,
 * redirect URI <APP_URL>/api/integrations/microsoft/callback.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = [
  "offline_access",
  "User.Read",
  "EducationClass.ReadBasic.All",
  "EducationRoster.ReadBasic.All",
].join(" ");

const PROVIDER = "microsoft_teams";

function config() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_TENANT ?? "organizations";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !clientSecret || !appUrl) {
    throw new Error(
      "MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / NEXT_PUBLIC_APP_URL must be set.",
    );
  }
  return {
    clientId,
    clientSecret,
    authority: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`,
    redirectUri: `${appUrl}/api/integrations/microsoft/callback`,
  };
}

export function isTeamsConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

export function buildAuthUrl(state: string): string {
  const { clientId, authority, redirectUri } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `${authority}/authorize?${params}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const { authority } = config();
  const response = await fetch(`${authority}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft token request failed (${response.status}): ${text}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function storeTokensFromCallback(input: {
  code: string;
  profileId: string;
  schoolId: string;
}): Promise<void> {
  const { clientId, clientSecret, redirectUri } = config();
  const tokens = await tokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri,
      scope: SCOPES,
    }),
  );

  const values = {
    profileId: input.profileId,
    schoolId: input.schoolId,
    provider: PROVIDER,
    accessToken: encryptSecret(tokens.access_token),
    refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    expiryDate: new Date(Date.now() + tokens.expires_in * 1000),
    scope: tokens.scope ?? SCOPES,
    updatedAt: new Date(),
  };

  await db
    .insert(integrationConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [integrationConnections.profileId, integrationConnections.provider],
      set: {
        accessToken: values.accessToken,
        ...(values.refreshToken ? { refreshToken: values.refreshToken } : {}),
        expiryDate: values.expiryDate,
        scope: values.scope,
        updatedAt: values.updatedAt,
      },
    });
}

/** Valid access token for the teacher, refreshing (and persisting) if expired. */
async function accessToken(profileId: string): Promise<string | null> {
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.profileId, profileId),
      eq(integrationConnections.provider, PROVIDER),
    ),
  });
  if (!connection) return null;

  const stillValid =
    connection.expiryDate && connection.expiryDate.getTime() > Date.now() + 60_000;
  if (stillValid) return decryptSecret(connection.accessToken);

  if (!connection.refreshToken) return decryptSecret(connection.accessToken);

  const { clientId, clientSecret } = config();
  const tokens = await tokenRequest(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptSecret(connection.refreshToken),
      scope: SCOPES,
    }),
  );

  await db
    .update(integrationConnections)
    .set({
      accessToken: encryptSecret(tokens.access_token),
      ...(tokens.refresh_token
        ? { refreshToken: encryptSecret(tokens.refresh_token) }
        : {}),
      expiryDate: new Date(Date.now() + tokens.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(integrationConnections.id, connection.id));

  return tokens.access_token;
}

export async function isConnected(profileId: string): Promise<boolean> {
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.profileId, profileId),
      eq(integrationConnections.provider, PROVIDER),
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
        eq(integrationConnections.provider, PROVIDER),
      ),
    );
}

// ---------------------------------------------------------------------------
// Roster sync
// ---------------------------------------------------------------------------

type GraphList<T> = { value: T[]; "@odata.nextLink"?: string };
type GraphClass = { id: string; displayName?: string };
type GraphEducationUser = {
  id: string;
  displayName?: string;
  primaryRole?: string;
  mail?: string;
  userPrincipalName?: string;
};

async function graphGetAll<T>(token: string, url: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Microsoft Graph request failed (${response.status}).`);
    }
    const data = (await response.json()) as GraphList<T>;
    items.push(...data.value);
    next = data["@odata.nextLink"];
  }
  return items;
}

/** Imports every class's students into the school roster (upsert). */
export async function syncRoster(
  profileId: string,
  schoolId: string,
): Promise<SyncResult> {
  const token = await accessToken(profileId);
  if (!token) throw new Error("Microsoft Teams är inte anslutet.");

  const classes = await graphGetAll<GraphClass>(
    token,
    `${GRAPH}/education/me/classes`,
  );

  const externalStudents: ExternalStudent[] = [];
  for (const cls of classes) {
    const members = await graphGetAll<GraphEducationUser>(
      token,
      `${GRAPH}/education/classes/${cls.id}/members`,
    );
    for (const member of members) {
      if (member.primaryRole && member.primaryRole !== "student") continue;
      externalStudents.push({
        externalId: member.id,
        fullName: member.displayName ?? "Okänt namn",
        email: member.mail ?? member.userPrincipalName ?? null,
        className: cls.displayName ?? "Okänd klass",
      });
    }
  }

  let imported = 0;
  let updated = 0;
  for (const s of externalStudents) {
    const [row] = await db
      .insert(students)
      .values({
        schoolId,
        source: "microsoft_teams",
        externalId: s.externalId,
        fullName: s.fullName,
        email: s.email,
        className: s.className,
      })
      .onConflictDoUpdate({
        target: [students.schoolId, students.source, students.externalId],
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
    coursesSeen: classes.length,
    studentsImported: imported,
    studentsUpdated: updated,
  };
}
