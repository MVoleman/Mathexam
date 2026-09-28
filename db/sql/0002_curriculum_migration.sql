-- ============================================================================
-- Migration for EXISTING databases only (fresh installs: `drizzle-kit push`
-- creates the right shapes directly).
--
-- Multi-curriculum packs: exams carry a curriculum id, and question abilities
-- become free-text codes defined by the exam's pack instead of a pg enum.
-- ============================================================================

-- 1. Curriculum on exams (default keeps existing data on Lgr22).
alter table public.exams
  add column if not exists curriculum text not null default 'lgr22';

-- 2. lgr22_abilities: enum[] → text[] (values are unchanged for Lgr22 data).
alter table public.questions
  alter column lgr22_abilities type text[]
  using lgr22_abilities::text[];

-- 3. Drop the now-unused enum type.
drop type if exists public.lgr22_ability;
