import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  exams,
  gradingResults,
  profiles,
  studentSubmissions,
  type Profile,
} from "@/db/schema";
import { createServerSupabase } from "@/lib/supabase/server";

export type Teacher = Profile;

/**
 * The signed-in teacher's profile, or null. Cached per request.
 * Returns null when signed in but not yet onboarded (no profile row).
 */
export const getTeacher = cache(async (): Promise<Teacher | null> => {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  });
  return profile ?? null;
});

/**
 * Auth + tenancy gate for pages and server actions. Redirects to /login when
 * signed out, and to /onboarding when a user has no school profile yet.
 */
export async function requireTeacher(): Promise<Teacher> {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  });
  if (!profile) redirect("/onboarding");

  return profile;
}

// ---------------------------------------------------------------------------
// Tenancy assertions — every server action that receives an id from the
// client must verify it belongs to the caller's school before touching it.
// ---------------------------------------------------------------------------

export class TenancyError extends Error {
  constructor() {
    super("Hittades inte."); // Deliberately indistinguishable from "not found".
  }
}

/** Asserts the exam belongs to the school. Returns the exam id. */
export async function assertExamInSchool(
  examId: string,
  schoolId: string,
): Promise<void> {
  const row = await db.query.exams.findFirst({
    where: and(eq(exams.id, examId), eq(exams.schoolId, schoolId)),
    columns: { id: true },
  });
  if (!row) throw new TenancyError();
}

/** Asserts the submission's exam belongs to the school. Returns its examId. */
export async function assertSubmissionInSchool(
  submissionId: string,
  schoolId: string,
): Promise<{ examId: string }> {
  const [row] = await db
    .select({ examId: studentSubmissions.examId })
    .from(studentSubmissions)
    .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
    .where(and(eq(studentSubmissions.id, submissionId), eq(exams.schoolId, schoolId)));
  if (!row) throw new TenancyError();
  return row;
}

/** Asserts the grading result's exam belongs to the school. */
export async function assertResultInSchool(
  resultId: string,
  schoolId: string,
): Promise<{ submissionId: string }> {
  const [row] = await db
    .select({ submissionId: gradingResults.submissionId })
    .from(gradingResults)
    .innerJoin(
      studentSubmissions,
      eq(studentSubmissions.id, gradingResults.submissionId),
    )
    .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
    .where(and(eq(gradingResults.id, resultId), eq(exams.schoolId, schoolId)));
  if (!row) throw new TenancyError();
  return row;
}
