"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { exams, gradingResults, studentSubmissions } from "@/db/schema";
import {
  SUBMISSIONS_BUCKET,
  removeStorageObjects,
  resolveStorageUrls,
} from "@/lib/storage";
import { requireTeacher } from "@/lib/auth";
import { audit } from "@/lib/audit";

/**
 * GDPR data-subject operations. A "student" here is the free-text student
 * identifier teachers enter at upload time (schools are instructed to use
 * pseudonymous codes), scoped to the teacher's school.
 */

const StudentIdSchema = z.string().trim().min(1).max(200);

// ---------------------------------------------------------------------------
// Art. 15 — export everything held about one student identifier
// ---------------------------------------------------------------------------

export async function exportStudentData(rawStudentId: string): Promise<
  | { success: true; json: string }
  | { success: false; error: string }
> {
  const parsed = StudentIdSchema.safeParse(rawStudentId);
  if (!parsed.success) return { success: false, error: "Ogiltigt elev-id." };
  const teacher = await requireTeacher();

  const submissions = await db
    .select({
      submission: studentSubmissions,
      examTitle: exams.title,
      examCourse: exams.course,
    })
    .from(studentSubmissions)
    .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
    .where(
      and(
        eq(studentSubmissions.studentId, parsed.data),
        eq(exams.schoolId, teacher.schoolId),
      ),
    );

  const submissionIds = submissions.map((s) => s.submission.id);
  const results =
    submissionIds.length === 0
      ? []
      : await db
          .select()
          .from(gradingResults)
          .where(inArray(gradingResults.submissionId, submissionIds));

  // Signed, time-limited links so the export is directly usable.
  const signedBySubmission = new Map<string, string[]>();
  for (const { submission } of submissions) {
    signedBySubmission.set(
      submission.id,
      await resolveStorageUrls(SUBMISSIONS_BUCKET, submission.imageUrls),
    );
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    studentId: parsed.data,
    submissions: submissions.map(({ submission, examTitle, examCourse }) => ({
      id: submission.id,
      exam: { title: examTitle, course: examCourse },
      pageImageUrls: signedBySubmission.get(submission.id) ?? [],
      createdAt: submission.createdAt,
      results: results
        .filter((r) => r.submissionId === submission.id)
        .map((r) => ({
          questionId: r.questionId,
          transcription: r.transcription,
          evaluation: r.evaluation,
          awardedPoints: r.awardedPoints,
          teacherComment: r.teacherComment,
          status: r.status,
        })),
    })),
  };

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "gdpr.export",
    entityType: "student",
    entityId: parsed.data,
    metadata: { submissions: submissions.length },
  });

  return { success: true, json: JSON.stringify(payload, null, 2) };
}

// ---------------------------------------------------------------------------
// Art. 17 — erase all data for one student identifier (rows + storage)
// ---------------------------------------------------------------------------

export async function eraseStudentData(rawStudentId: string): Promise<
  | { success: true; deletedSubmissions: number }
  | { success: false; error: string }
> {
  const parsed = StudentIdSchema.safeParse(rawStudentId);
  if (!parsed.success) return { success: false, error: "Ogiltigt elev-id." };
  const teacher = await requireTeacher();

  const submissions = await db
    .select({ id: studentSubmissions.id, imageUrls: studentSubmissions.imageUrls })
    .from(studentSubmissions)
    .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
    .where(
      and(
        eq(studentSubmissions.studentId, parsed.data),
        eq(exams.schoolId, teacher.schoolId),
      ),
    );

  if (submissions.length === 0) {
    return { success: false, error: "Inga inlämningar för detta elev-id." };
  }

  // 1. Storage objects (handles both stored paths and legacy public URLs).
  try {
    await removeStorageObjects(
      SUBMISSIONS_BUCKET,
      submissions.flatMap((s) => s.imageUrls),
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Kunde inte radera bilder.",
    };
  }

  // 2. Rows (grading_results cascade from submissions).
  await db.delete(studentSubmissions).where(
    inArray(
      studentSubmissions.id,
      submissions.map((s) => s.id),
    ),
  );

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "gdpr.erase",
    entityType: "student",
    entityId: parsed.data,
    metadata: { submissions: submissions.length },
  });

  revalidatePath("/exams");
  return { success: true, deletedSubmissions: submissions.length };
}
