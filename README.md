# DeepGrader — AI-rättning av matematikprov

Next.js 14 (App Router) + Supabase (Auth, Postgres/pgvector, Storage) + Drizzle
+ Vercel AI SDK + Inngest. Grades handwritten math exams: one
segmentation/transcription pass per submission (Gemini 3.5 Flash),
RAG-grounded evaluation (Claude Sonnet 5), risk-based second opinions from an
independent model family, and a teacher-in-the-loop review workflow whose
overrides feed a learning knowledge base. Multi-tenant (per-school RLS),
multi-curriculum (Lgr22/Gy25/IB packs), with a golden-set eval harness and a
student/guardian portal. See STRATEGY.md for the analysis and roadmap status.

## Structure

```
db/schema.ts                        # schools, profiles, exams, questions, submissions,
                                    # solution_references (pgvector), grading_results,
                                    # grading_jobs, students, integration_connections,
                                    # share_codes, golden_sets/items, eval_runs/results
db/sql/0001_rls.sql                 # Row-level security per school (run in SQL editor)
db/sql/0002_curriculum_migration.sql# Migration for pre-curriculum databases
db/sql/0003_audit_and_portal.sql    # v0.4 migration + audit-log RLS
db/seeds/global-golden-set.json     # Shared anonymized eval corpus (npm run seed:golden)
lib/auth.ts                         # requireTeacher() + tenancy assertions
lib/audit.ts                        # Audit trail of teacher data access (/audit)
lib/supabase/                       # SSR client, middleware session refresh, admin client
lib/ai/models.ts                    # Central, env-overridable model config + embeddings
lib/curriculum/packs.ts             # Curriculum packs as DATA (Lgr22, Gy25, IB MYP/DP)
lib/grading/engine.ts               # Core pipeline: 1-pass transcription, RAG eval, dual grading
lib/grading/batch.ts                # Batch job pieces (shared by worker + fallback)
lib/queue/                          # Inngest client + worker functions
lib/evals/runner.ts                 # Golden-set eval runner (agreement-with-teacher)
lib/rag/                            # Hybrid vector search + learning flywheel
lib/pdf/                            # Rasterizer + exam PDF worker path
lib/portal/share-codes.ts           # Hashed, expiring portal codes
lib/storage.ts                      # Private buckets: school-prefixed paths + signed URLs
lib/crypto.ts                       # AES-256-GCM column encryption for OAuth tokens
lib/integrations/                   # Roster sync: Google Classroom, MS Teams, SS 12000
actions/                            # Server actions (all auth- and tenant-checked)
app/api/inngest/route.ts            # Queue worker endpoint
app/api/integrations/google/        # OAuth connect + callback
app/portal/                         # Public student/guardian report portal
app/evals/, app/students/           # Eval dashboard, roster management
app/audit/, app/settings/           # Admin: access log (+CSV export), school settings, roles
app/benchmark/                      # PUBLIC accuracy benchmark (global golden sets)
docs/GDPR.md, docs/DPA-TEMPLATE.md  # GDPR posture + PUB-avtal (DPA) template
docs/INTEGRATIONS.md, docs/SSO.md   # Roster providers + Skolfederation/Skolon SSO
scripts/run-evals.ts                # CLI: npm run evals -- <set-id> [label]
scripts/seed-global-golden-set.ts   # CLI: npm run seed:golden
```

## Setup

1. **Supabase**: create a project in an EU region (eu-north-1 Stockholm
   recommended). Run `CREATE EXTENSION IF NOT EXISTS vector;` in the SQL editor.
2. **Env**: copy `.env.example` → `.env.local` and fill in. `SHARE_CODE_PEPPER`
   is any long random string.
3. **Install & schema**: `npm install`, then `npx drizzle-kit push`, then run
   `db/sql/0001_rls.sql` and the RLS section of `db/sql/0003_audit_and_portal.sql`
   in the Supabase SQL editor. (Existing databases: run 0002 and all of 0003.)
   Optionally `npm run seed:golden` for the shared eval corpus.
4. **Storage**: create PRIVATE buckets `exams`, `exam_pages`, `submissions`.
   The app stores school-prefixed object paths and signs URLs on demand.
5. **shadcn/ui**: `npx shadcn@latest init` then
   `npx shadcn@latest add button card badge progress input label textarea`.
6. **Auth**: enable Email provider in Supabase Auth. First sign-up creates the
   school and becomes its admin.
7. **Queues (optional locally, required on serverless)**: `npm run inngest`
   for the local dev server, or set `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY`
   (EU: also `INNGEST_BASE_URL=https://api.eu.inngest.com`). Without a key,
   jobs run in-process (fine for local Node).
8. **Google Classroom (optional)**: OAuth client per `docs/INTEGRATIONS.md`.

## Scripts

`npm run dev` · `npm run build` · `npm run typecheck` · `npm run db:push` ·
`npm run evals -- <golden-set-id> [label]` · `npm run seed:golden` ·
`npm run golden:export -- <set-id>` · `npm run inngest`

## Operating rules

- Every prompt/model change: run `npm run evals` against the golden set and
  compare agreement deltas before shipping (regression gate).
- GDPR: see `docs/GDPR.md`. Student erasure/export: `actions/gdpr.ts`.
- Tenancy: server actions must call `requireTeacher()` and assert ownership
  via `lib/auth.ts` helpers; RLS is the backstop, not the primary gate.

## Known TODOs

- Send the Skolfederation + Skolon applications (ready drafts in
  docs/applications/; fill in company placeholders).
- Grow the global golden set past 100 real consented items via the
  golden:export curation pipeline, then publicize /benchmark.
- Billing/licensing plumbing for procurement.
