-- ============================================================================
-- Row-Level Security — one school never sees another school's data.
--
-- Run AFTER `npx drizzle-kit push` in the Supabase SQL editor.
--
-- Defense in depth: the Next.js server uses the service role / direct
-- Postgres connection (which bypasses RLS) but enforces tenancy in
-- application code (lib/auth.ts). These policies are the hard backstop for
-- any anon/authenticated-key access path (client-side reads, PostgREST,
-- future mobile apps) and are what you point at in procurement reviews.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: the calling user's school (SECURITY DEFINER so it can read profiles
-- regardless of the profiles RLS policy).
-- ----------------------------------------------------------------------------
create or replace function public.auth_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profiles where id = auth.uid()
$$;

revoke all on function public.auth_school_id() from anon;
grant execute on function public.auth_school_id() to authenticated;

-- ----------------------------------------------------------------------------
-- Enable RLS everywhere (deny-by-default for anon/authenticated roles).
-- ----------------------------------------------------------------------------
alter table public.schools                  enable row level security;
alter table public.profiles                 enable row level security;
alter table public.exams                    enable row level security;
alter table public.questions                enable row level security;
alter table public.student_submissions      enable row level security;
alter table public.solution_references      enable row level security;
alter table public.grading_results          enable row level security;
alter table public.grading_jobs             enable row level security;
alter table public.students                 enable row level security;
alter table public.integration_connections  enable row level security;
alter table public.share_codes              enable row level security;
alter table public.golden_sets              enable row level security;
alter table public.golden_items             enable row level security;
alter table public.eval_runs                enable row level security;
alter table public.eval_results             enable row level security;

-- ----------------------------------------------------------------------------
-- schools / profiles
-- ----------------------------------------------------------------------------
create policy "members read their school"
  on public.schools for select to authenticated
  using (id = public.auth_school_id());

create policy "members read colleagues"
  on public.profiles for select to authenticated
  using (school_id = public.auth_school_id());

create policy "users read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

-- ----------------------------------------------------------------------------
-- exams and everything hanging off them
-- ----------------------------------------------------------------------------
create policy "school members full access to exams"
  on public.exams for all to authenticated
  using (school_id = public.auth_school_id())
  with check (school_id = public.auth_school_id());

create policy "school members full access to questions"
  on public.questions for all to authenticated
  using (exists (
    select 1 from public.exams e
    where e.id = exam_id and e.school_id = public.auth_school_id()
  ))
  with check (exists (
    select 1 from public.exams e
    where e.id = exam_id and e.school_id = public.auth_school_id()
  ));

create policy "school members full access to submissions"
  on public.student_submissions for all to authenticated
  using (exists (
    select 1 from public.exams e
    where e.id = exam_id and e.school_id = public.auth_school_id()
  ))
  with check (exists (
    select 1 from public.exams e
    where e.id = exam_id and e.school_id = public.auth_school_id()
  ));

create policy "school members full access to grading results"
  on public.grading_results for all to authenticated
  using (exists (
    select 1
    from public.student_submissions ss
    join public.exams e on e.id = ss.exam_id
    where ss.id = submission_id and e.school_id = public.auth_school_id()
  ))
  with check (exists (
    select 1
    from public.student_submissions ss
    join public.exams e on e.id = ss.exam_id
    where ss.id = submission_id and e.school_id = public.auth_school_id()
  ));

create policy "school members read grading jobs"
  on public.grading_jobs for select to authenticated
  using (exists (
    select 1 from public.exams e
    where e.id = exam_id and e.school_id = public.auth_school_id()
  ));

-- ----------------------------------------------------------------------------
-- Roster + integrations
-- ----------------------------------------------------------------------------
create policy "school members full access to students"
  on public.students for all to authenticated
  using (school_id = public.auth_school_id())
  with check (school_id = public.auth_school_id());

-- OAuth tokens: owner-only, and only via the server in practice.
create policy "owner reads own integration connections"
  on public.integration_connections for select to authenticated
  using (profile_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Portal share codes: no client access at all — the portal resolves codes
-- server-side with the service role. (RLS enabled, no policies = deny.)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Knowledge base (solution_references): shared, anonymized grading precedents
-- power the cross-school learning flywheel. Content must never contain
-- student identity (enforced at write time in lib/rag/learn.ts).
-- Server-only writes; authenticated read.
-- ----------------------------------------------------------------------------
create policy "authenticated read knowledge base"
  on public.solution_references for select to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- Golden-set evals: school-scoped; global sets (school_id is null) readable.
-- Writes go through the server.
-- ----------------------------------------------------------------------------
create policy "read own or global golden sets"
  on public.golden_sets for select to authenticated
  using (school_id is null or school_id = public.auth_school_id());

create policy "read items of visible sets"
  on public.golden_items for select to authenticated
  using (exists (
    select 1 from public.golden_sets gs
    where gs.id = set_id
      and (gs.school_id is null or gs.school_id = public.auth_school_id())
  ));

create policy "read runs of visible sets"
  on public.eval_runs for select to authenticated
  using (exists (
    select 1 from public.golden_sets gs
    where gs.id = set_id
      and (gs.school_id is null or gs.school_id = public.auth_school_id())
  ));

create policy "read results of visible runs"
  on public.eval_results for select to authenticated
  using (exists (
    select 1
    from public.eval_runs r
    join public.golden_sets gs on gs.id = r.set_id
    where r.id = run_id
      and (gs.school_id is null or gs.school_id = public.auth_school_id())
  ));

-- ============================================================================
-- Storage
--
-- Buckets `exams`, `exam_pages` and `submissions` must be PRIVATE. The app
-- stores bucket-relative, school-prefixed paths (<schoolId>/<examId>/…) and
-- mints short-lived signed URLs through the service role (lib/storage.ts).
-- Private buckets deny anon/authenticated access by default — no
-- storage.objects policies are needed; all access flows through the server.
--
-- Migrating from the earlier public-bucket setup: flip each bucket to
-- private in the dashboard. Legacy rows storing full public URLs only keep
-- working while buckets stay public; new uploads are path-based.
-- ============================================================================
