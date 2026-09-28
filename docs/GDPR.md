# DeepGrader — GDPR & EU AI Act posture

Status: engineering posture document. Not legal advice — have counsel review
before signing contracts with huvudmän.

## Roles

Under GDPR, the school huvudman (municipality or independent operator) is
**personuppgiftsansvarig** (controller) for all student data. DeepGrader is
**personuppgiftsbiträde** (processor) and acts only on documented instructions.
The signed instrument is the DPA (personuppgiftsbiträdesavtal) — template in
`docs/DPA-TEMPLATE.md`.

## Data inventory

Personal data processed: student identifier as entered by the teacher (name,
initials, or pseudonymous code — schools are instructed to use codes),
photographs/scans of handwritten exam solutions, AI transcriptions and
evaluations of those solutions, teacher comments, roster data when a school
enables Google Classroom sync (name, email, class, provider user id), and
teacher account data (name, email).

Special note on the knowledge base (`solution_references`): teacher overrides
are captured as grading precedents containing the *answer text, scoring
rationale and rubric rules only*. Student identifiers must never be written
into precedents (`lib/rag/learn.ts` is the enforcement point). Precedents are
shared across tenants — that is the product's learning flywheel — which is
only defensible because they are anonymized pedagogical content, not personal
data. Keep it that way.

## Data residency

All persistent data lives in the school's Supabase project region — provision
in an EU region (eu-north-1 Stockholm recommended). Storage buckets, Postgres
and Auth are all Supabase-hosted in-region. Vercel functions should be pinned
to an EU region (`arn1`/`fra1`). Inngest is configured against its EU domain
(`api.eu.inngest.com`); only orchestration metadata (event names, ids,
timestamps) leaves the app, never solution images or transcriptions — payloads
carry row ids only.

Model calls send solution images/transcriptions to Anthropic and Google APIs
under their zero-data-retention / no-training API terms. Both must be listed
as subprocessors in the DPA, and schools must be able to see the current
subprocessor list.

## Subprocessors (template list for the DPA appendix)

Supabase (database, auth, storage — EU region), Vercel (application hosting —
EU functions), Anthropic (grading model API), Google (transcription/extraction
model API, embeddings; optionally Classroom roster sync), Inngest (job
orchestration — EU region, metadata only).

## Security measures (TOMs, summarized)

Tenant isolation via per-school row-level security (`db/sql/0001_rls.sql`)
plus application-level tenancy assertions on every server action
(`lib/auth.ts`). Supabase Auth with per-user sessions. OAuth tokens stored
server-side, never exposed to the browser. Portal share codes are stored only
as salted SHA-256 hashes with mandatory expiry and revocation. Service-role
keys exist only in server environment variables.

Storage: buckets are private; the DB stores school-prefixed object paths and
the server mints short-lived (1 h) signed URLs for the review UI, AI model
calls and data exports (`lib/storage.ts`). OAuth tokens are encrypted at the
column level with AES-256-GCM (`lib/crypto.ts`, key in
`TOKEN_ENCRYPTION_KEY`).

All teacher access to student data (report/submission views, PDF exports,
grading decisions, share-code lifecycle, GDPR operations, roster syncs) is
written to an append-only audit trail (`audit_logs`), readable by school
admins at `/audit`. Portal views by students/guardians are logged without
actor identity.

Audit-log retention: entries are pruned automatically after
`AUDIT_RETENTION_DAYS` (default 365 — one school year; nightly Inngest cron).
Admins can export the full trail as CSV (`/audit/export`) for huvudman
compliance reviews; the export itself is audited. Write this retention period
into the DPA appendix when a huvudman requires a different one.

## Data subject rights

`actions/gdpr.ts` implements the operational hooks: **export** (all data held
about one student identifier, as JSON) and **erasure** (all submissions,
grading results and storage objects for a student identifier). Golden-set
items require explicit consent confirmation at capture time
(`consent_confirmed`), contain no student identifier, and survive erasure as
anonymized data; if a school withdraws consent, delete the affected
`golden_items` rows manually.

Retention default to write into the DPA: submission images and grading data
are deleted at the school's instruction and at latest at contract end;
recommend schools adopt a 1-school-year retention cycle.

## EU AI Act

Education is a high-risk category (Annex III 3(b): AI used to evaluate
learning outcomes). Posture: DeepGrader is a **teacher-assistance tool with
mandatory human oversight** — no grade is final without teacher review, every
AI score is overridable, dual-model disagreement auto-flags for human review,
and the review UI shows the AI's full reasoning (transparency). The golden-set
eval harness (`lib/evals`) is the accuracy-monitoring evidence base required
for conformity documentation: keep eval reports versioned per model/prompt
change.
