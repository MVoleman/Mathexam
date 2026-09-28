import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { students } from "@/db/schema";
import type { SyncResult } from "@/lib/integrations/types";

/**
 * SS 12000 roster import — the Swedish national standard for school
 * information exchange, used by municipal hubs (IST, Tieto/EdLevo) and by
 * Skolon's provisioning. This is how rosters arrive in Swedish procurement
 * (Skolfederation handles SSO; SS 12000 handles provisioning).
 *
 * Deployment model: one DeepGrader deployment per huvudman, configured with
 * the hub's API base URL and bearer token via env:
 *   SS12000_BASE_URL=https://api.ist.com/ss12000v2-api/source/<customer>/v2.0
 *   SS12000_TOKEN=<bearer JWT from the hub>
 *
 * Field mapping follows SS 12000 v2.0 /persons; hubs vary slightly in what
 * they populate, so the mapping below is defensive. Adjust per hub during
 * onboarding.
 */

export function isSS12000Configured(): boolean {
  return Boolean(process.env.SS12000_BASE_URL && process.env.SS12000_TOKEN);
}

type SS12000Person = {
  id: string;
  givenName?: string;
  middleName?: string;
  familyName?: string;
  displayName?: string;
  emails?: { value?: string; type?: string }[];
  enrolments?: { schoolYear?: number; schoolUnit?: { displayName?: string } }[];
};

type SS12000Page = {
  data?: SS12000Person[];
  persons?: SS12000Person[]; // some hubs use this key
  pageToken?: string | null;
};

async function fetchPersonsPage(pageToken?: string): Promise<SS12000Page> {
  const base = process.env.SS12000_BASE_URL!;
  const token = process.env.SS12000_TOKEN!;

  const url = new URL(`${base.replace(/\/$/, "")}/persons`);
  // Only persons with an enrolment (i.e. students), expanded for class info.
  url.searchParams.set("relationship.entity.type", "enrolment");
  url.searchParams.set("expand", "enrolments");
  url.searchParams.set("limit", "100");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`SS 12000-anropet misslyckades (${response.status}).`);
  }
  return (await response.json()) as SS12000Page;
}

function personName(p: SS12000Person): string {
  if (p.displayName) return p.displayName;
  const parts = [p.givenName, p.middleName, p.familyName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Okänt namn";
}

function personClass(p: SS12000Person): string | null {
  const enrolment = p.enrolments?.[0];
  if (!enrolment) return null;
  const unit = enrolment.schoolUnit?.displayName;
  const year = enrolment.schoolYear ? `åk ${enrolment.schoolYear}` : null;
  return [unit, year].filter(Boolean).join(" · ") || null;
}

/** Imports all enrolled persons from the configured SS 12000 hub (upsert). */
export async function syncRoster(schoolId: string): Promise<SyncResult> {
  if (!isSS12000Configured()) {
    throw new Error("SS 12000 är inte konfigurerat (SS12000_BASE_URL/SS12000_TOKEN).");
  }

  const persons: SS12000Person[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await fetchPersonsPage(pageToken);
    persons.push(...(page.data ?? page.persons ?? []));
    pageToken = page.pageToken ?? undefined;
    pages += 1;
  } while (pageToken && pages < 100); // hard cap: 10 000 persons per sync

  let imported = 0;
  let updated = 0;
  for (const person of persons) {
    if (!person.id) continue;
    const [row] = await db
      .insert(students)
      .values({
        schoolId,
        source: "skolfederation",
        externalId: person.id,
        fullName: personName(person),
        email: person.emails?.[0]?.value ?? null,
        className: personClass(person),
      })
      .onConflictDoUpdate({
        target: [students.schoolId, students.source, students.externalId],
        targetWhere: sql`external_id is not null`,
        set: {
          fullName: personName(person),
          email: person.emails?.[0]?.value ?? null,
          className: personClass(person),
          updatedAt: sql`now()`,
        },
      })
      .returning({ createdAt: students.createdAt, updatedAt: students.updatedAt });

    if (row && row.createdAt.getTime() === row.updatedAt.getTime()) imported += 1;
    else updated += 1;
  }

  return { coursesSeen: pages, studentsImported: imported, studentsUpdated: updated };
}
