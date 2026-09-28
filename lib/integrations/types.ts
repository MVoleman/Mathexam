/**
 * Roster-sync integration contract. Each provider imports courses/classes
 * and their students into the school's roster (`students` table).
 *
 * Implemented: google_classroom (per-teacher OAuth),
 *              microsoft_teams (per-teacher OAuth via Microsoft Graph),
 *              skolfederation (SS 12000 hub import, env-configured — used by
 *              Skolon and municipal hubs; see lib/integrations/ss12000.ts).
 * Planned:     Skolfederation SAML SSO (login) — see docs/INTEGRATIONS.md.
 */

export type RosterProviderId = "google_classroom" | "microsoft_teams" | "skolfederation";

export type ExternalCourse = {
  externalId: string;
  name: string;
};

export type ExternalStudent = {
  externalId: string;
  fullName: string;
  email: string | null;
  className: string;
};

export type SyncResult = {
  coursesSeen: number;
  studentsImported: number;
  studentsUpdated: number;
};

export const PROVIDER_LABELS: Record<RosterProviderId, string> = {
  google_classroom: "Google Classroom",
  microsoft_teams: "Microsoft Teams",
  skolfederation: "Skolfederation",
};

/** Providers not yet implemented — shown as "coming" in the UI. */
export const PLANNED_PROVIDERS: RosterProviderId[] = [];
