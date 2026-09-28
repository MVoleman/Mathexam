# Distribution integrations

Strategy: sell where teachers already are. Roster sync first (kills manual
student entry), then LMS-native assignment flows, then Swedish procurement
channels.

## Google Classroom — implemented

Per-teacher OAuth (offline access) → `integration_connections`; sync imports
every active course's students into `students` with upsert on
(school, source, externalId). Code: `lib/integrations/google-classroom.ts`,
routes under `app/api/integrations/google/`, UI on `/students`.

Setup: create an OAuth web client in Google Cloud Console, enable the
Classroom API, register redirect URI
`<NEXT_PUBLIC_APP_URL>/api/integrations/google/callback`, set
`GOOGLE_CLASSROOM_CLIENT_ID` and `GOOGLE_CLASSROOM_CLIENT_SECRET`. Scopes
used: `classroom.courses.readonly`, `classroom.rosters.readonly`,
`classroom.profile.emails` (all read-only; keeps Google's app verification
lightweight).

## Microsoft Teams (EDU) — implemented

Per-teacher OAuth against Entra ID (`lib/integrations/microsoft-teams.ts`,
routes under `app/api/integrations/microsoft/`, UI on `/students`). Plain
fetch against Microsoft Graph: `GET /education/me/classes` →
`GET /education/classes/{id}/members`, students upserted with source
`microsoft_teams`. Tokens are AES-256-GCM-encrypted at rest and silently
refreshed via the stored refresh token.

Setup: create an Entra ID app registration, add delegated permissions
`EducationClass.ReadBasic.All` + `EducationRoster.ReadBasic.All` +
`User.Read` (admin consent usually required in school tenants), register
redirect URI `<NEXT_PUBLIC_APP_URL>/api/integrations/microsoft/callback`, set
`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and optionally
`MICROSOFT_TENANT` (defaults to `organizations`).

## Skolon / Skolfederation — SS 12000 import implemented; SAML SSO planned

Roster provisioning in Swedish procurement follows **SS 12000** (used by
Skolon and municipal hubs like IST and Tieto/EdLevo). Implemented in
`lib/integrations/ss12000.ts` as an env-configured, per-huvudman import
(`SS12000_BASE_URL` + `SS12000_TOKEN`): paginated `GET /persons` filtered on
enrolment, upserted with source `skolfederation`. Field mapping is defensive
— hubs vary; adjust during onboarding.

Still planned: **Skolfederation SAML SSO** for login — join the federation,
put a SAML SP in front of Supabase Auth (supported on Pro+), map
`eduPersonPrincipalName` to profiles. For **Skolon** app-store distribution,
additionally register as a Skolon partner and implement their SSO + Library
app manifest. Prioritize when the first paying municipality asks.
