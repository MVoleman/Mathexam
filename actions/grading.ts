"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { questions, studentSubmissions, type GradingResult } from "@/db/schema";
import {
  fetchRagContext,
  gradeAnswer,
  gradeSubmission,
  transcribeSingleAnswer,
} from "@/lib/grading/engine";
import { assertSubmissionInSchool, requireTeacher } from "@/lib/auth";
import { SUBMISSIONS_BUCKET, resolveStorageUrls } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Re-grade a single answer (targeted transcription + evaluation)
// ---------------------------------------------------------------------------

const DeepGraderInputSchema = z.object({
  questionId: z.string().uuid(),
  submissionId: z.string().uuid(),
});
export type DeepGraderInput = z.infer<typeof DeepGraderInputSchema>;

export async function deepGrader(rawInput: DeepGraderInput): Promise<GradingResult> {
  const input = DeepGraderInputSchema.parse(rawInput);

  const teacher = await requireTeacher();
  await assertSubmissionInSchool(input.submissionId, teacher.schoolId);

  const submission = await db.query.studentSubmissions.findFirst({
    where: eq(studentSubmissions.id, input.submissionId),
  });
  if (!submission) throw new Error("Inlämningen hittades inte.");
  if (submission.imageUrls.length === 0) throw new Error("Inlämningen saknar bilder.");

  const context = await fetchRagContext(input.questionId);
  const imageUrls = await resolveStorageUrls(SUBMISSIONS_BUCKET, submission.imageUrls);
  const transcription = await transcribeSingleAnswer(imageUrls, context.question);

  const result = await gradeAnswer({
    submissionId: input.submissionId,
    questionId: input.questionId,
    transcription,
  });

  revalidatePath(`/review/${input.submissionId}`);
  return result;
}

// ---------------------------------------------------------------------------
// Grade one whole submission on demand (outside a batch job)
// ---------------------------------------------------------------------------

export async function gradeSubmissionAction(
  submissionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = z.string().uuid().safeParse(submissionId);
  if (!parsed.success) return { success: false, error: "Ogiltigt inlämnings-id." };

  try {
    const teacher = await requireTeacher();
    await assertSubmissionInSchool(parsed.data, teacher.schoolId);
    await gradeSubmission(parsed.data);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Rättningen misslyckades.",
    };
  }

  const submission = await db.query.studentSubmissions.findFirst({
    where: eq(studentSubmissions.id, parsed.data),
    columns: { examId: true },
  });
  if (submission) revalidatePath(`/exams/${submission.examId}`);
  revalidatePath(`/review/${parsed.data}`);
  return { success: true };
}
