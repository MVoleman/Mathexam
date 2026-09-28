-- ============================================================================
-- v0.4 — audit logging + per-student portal codes + SSO domains.
-- Fresh installs: `drizzle-kit push` creates everything; run only the RLS
-- section below. Existing installs: run the whole file.
-- ============================================================================

-- --- Migration for existing databases -------------------------------------

alter table public.schools
  add column if not exists sso_domain text;
create unique index if not exists schools_sso_domain_uq
  on public.schools (sso_domain) where sso_domain is not null;

alter table public.share_codes
  alter column submission_id drop not null;
alter table public.share_codes
  add column if not exists student_id uuid references public.students(id) on delete cascade;

-- Exactly one target per code.
alter table public.share_codes
  add constraint share_codes_one_target_ck
  check (num_nonnulls(submission_id, student_id) = 1);

-- --- RLS -------------------------------------------------------------------

alter table public.audit_logs enable row level security;

-- School admins can read their school's audit trail; writes are server-only.
create policy "school admins read audit logs"
  on public.audit_logs for select to authenticated
  using (
    school_id = public.auth_school_id()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
