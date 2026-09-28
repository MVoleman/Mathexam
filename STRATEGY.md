# DeepGrader — Strategy & Technical Audit (July 2026)

## The idea, honestly assessed

The core insight is sound and differentiated: grading handwritten math is the single most time-consuming, least-loved task in a math teacher's week, and generic AI tools fail at it because grading is not "is the answer right" — it's rubric-consistent partial credit, curriculum-mapped ability assessment, and formative feedback. DeepGrader's bet is **curriculum-native grading** (Lgr22 abilities as first-class data), **precedent-grounded scoring** (RAG over solution references), and **teacher-in-the-loop trust** (nothing final without review affordances). That combination is what generic chatbots and even Gradescope-class tools do not offer.

## Competitive position

Gradescope (Turnitin) dominates rubric-based grading in higher ed but its AI is answer-grouping, not free-form handwritten reasoning assessment, and it has no Swedish-curriculum awareness. Swedish incumbents (Kunskapsmatrisen, Exam.net, DigiExam) own distribution in schools but are assessment-delivery tools, not auto-graders of handwritten work. Generic LLM use (teachers pasting photos into a chatbot) is the real competitor — it's free but inconsistent, unauditable, GDPR-risky, and rubric-blind. The wedge: **be the only tool where the tenth correction teaches the system, so school #100 grades better than school #1 did.**

## The moat (what was built toward it today)

1. **Learning flywheel** — every teacher override is now auto-captured as an embedded grading precedent in the knowledge base and retrieved for future similar answers. Accuracy compounds with usage; this is data-network-effect territory that a chatbot can never match.
2. **Trust as a feature** — risk-based dual grading: partial-credit and low-confidence answers get a second opinion from an independent model family (Gemini cross-checks Claude); disagreement above a threshold auto-flags for human review with both scores shown. Calibrated distrust is the product.
3. **Curriculum-native data model** — Lgr22 abilities flow from question registration through grading to per-student reports and class analytics. Extending to Gy25/IB/Common Core is a schema value, not a rewrite.

## Technical audit — what was wrong and what changed

**Models were stale or dead.** `text-embedding-004` was deprecated 2026-01-14 — vector search would have started failing; migrated to `gemini-embedding-001` at 768 output dimensions (schema-compatible via MRL truncation). Transcription moved from Gemini 1.5 Pro to `gemini-3.5-flash` (currently the top OCR-class model, dramatically cheaper), grading to `claude-sonnet-5`. All model IDs are now env-overridable in one file (`lib/ai/models.ts`) — model churn is a config change, not a refactor.

**The economics were broken.** The old pipeline sent every page to the transcription model once per question: a 6-page submission on a 12-question exam = 72 page-reads. New engine does **one segmentation pass per submission** (all answers extracted and keyed to question numbers in a single call), then evaluates per question from text. That's ~10× cost and latency reduction on realistic exams, before dual grading spends some of the savings on trust.

**The product's front door was missing.** There was no way to upload student solutions. Now: per-student multi-file upload (photos or scanned PDFs; PDFs rasterize server-side through the shared pipeline), with a review-ready submission record per student.

**Throughput.** Batch worker now grades submissions and questions with bounded concurrency instead of strictly serially.

## Roadmap to "leading" — status (July 2026: all six shipped in v0.2)

1. **Auth + RLS + GDPR posture** — ✅ BUILT. Supabase Auth (email, first user
   becomes school admin), per-school row-level security (`db/sql/0001_rls.sql`)
   with app-level tenancy assertions on every action (`lib/auth.ts`), EU
   residency posture + subprocessor list (`docs/GDPR.md`), Swedish DPA/PUB-avtal
   template (`docs/DPA-TEMPLATE.md`), student data export/erasure
   (`actions/gdpr.ts`). Remaining hardening: signed storage URLs, token
   column encryption.
2. **Golden-set evals** — ✅ BUILT. Versioned corpora (`golden_sets` can be
   frozen), consent-gated capture from the review panel, runner reporting
   exact agreement / within-±0.5p / MAE with deltas vs the previous run
   (`lib/evals/runner.ts`, `/evals`, `npm run evals`). This doubles as the
   EU AI Act accuracy-monitoring evidence base.
3. **Queue-based workers** — ✅ BUILT on Inngest (EU region supported; payloads
   are row ids only). Batch grading = one retryable step per submission;
   rasterization worker for exam PDFs; eval runs queued. In-process fallback
   when no event key is set (local dev).
4. **Student/guardian portal** — ✅ BUILT. Hashed, expiring, revocable share
   codes; public `/portal/<code>` formative report (feedback + abilities, no
   AI internals); generation/revocation from the report page.
5. **Distribution** — ✅ BUILT for roster sync: Google Classroom and Microsoft
   Teams (per-teacher OAuth, encrypted tokens) plus SS 12000 hub import for
   Skolon/municipal provisioning (`/students`, `docs/INTEGRATIONS.md`).
   Remaining: Skolfederation SAML SSO for login and Skolon app-store
   registration.
6. **Multi-curriculum packs** — ✅ BUILT as data (`lib/curriculum/packs.ts`):
   Lgr22, Gy25, IB MYP, IB DP. Packs define ability/criteria codes, prompt
   personas and feedback language; exams choose a pack at creation and it
   flows through extraction, grading, review, analytics, reports and the
   portal. Grade *scales* beyond E/C/A limits are still informational only.

### Since shipped (v0.3)

Storage hardening (private buckets, per-school path prefixes, signed URLs,
legacy-URL fallback), column-level AES-256-GCM encryption of OAuth tokens,
server-rendered PDF report export, roster-linked submissions (picker on
upload), Microsoft Teams roster sync, and SS 12000 roster import.

### Since shipped (v0.4)

Audit logging of all teacher access to student data with an admin view
(`/audit`), per-roster-student portal codes (one code opens all of a
student's reports, expiring/revocable), a seeded shared global golden set
(12 curated Lgr22 typfall, frozen v1, runnable by every school), and the
SSO code path: `signInWithSSO` on the login page, per-school SSO domains
with auto-join, admin school settings (`/settings`), and the
Skolfederation/Skolon registration checklists (docs/SSO.md).

### Since shipped (v0.5)

Admin role management on `/settings` (promote/demote with last-admin guard,
audited), the PUBLIC accuracy benchmark at `/benchmark` (latest eval run per
global golden set + methodology), a curation pipeline for growing the global
corpus with real consented items (`npm run golden:export` → manual
anonymization review → versioned seed), audit-log retention (nightly Inngest
cron, `AUDIT_RETENTION_DAYS`, default one school year) with admin CSV export
(`/audit/export`) for huvudman compliance reviews, and ready-to-send
application drafts for Skolfederation membership and Skolon partnership
(docs/applications/).

### Next (new priority order)

1. SEND the Skolfederation + Skolon applications (drafts in
   docs/applications/ — purely organizational now).
2. Run the first public benchmark eval and share /benchmark in sales
   conversations.
3. Recruit 2–3 pilot schools to contribute consented golden items
   (golden:export pipeline) — grow the corpus past 100 items.
4. Billing/procurement plumbing (per-teacher or per-school licensing) once
   the first pilot converts.

## Sources

- [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview) — current lineup incl. `claude-sonnet-5`
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models) — `gemini-3.5-flash` GA, `gemini-3.1-pro-preview`
- [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings) — `gemini-embedding-001`, MRL output dimensionality
- [OCR Arena leaderboard](https://www.ocrarena.ai/compare/gemini-2-5-pro/gemini-3-flash) — Gemini 3-class Flash models lead OCR
