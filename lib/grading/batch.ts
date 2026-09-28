import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { exams, gradingJobs, questions, studentSubmissions } from "@/db/schema";
import { gradeSubmission } from "@/lib/grading/engine";
import { mapWithConcurrency } from "@/lib/utils/concurrency";

/** Submissions graded in parallel in the in-process fallback path. */
const SUBMISSION_CONCURRENCY = 2;

// ---------------------------------------------------------------------------
// Composable pieces — used by both the Inngest worker (one step per
// submission) and the in-process fallback loop.
// ---------------------------------------------------------------------------

export async function markJobRunning(jobId: string): Promise<{
  examId: string;
  submissionIds: string[];
  questionCount: number;
} | null> {
  const job = await db.query.gradingJobs.findFirst({
    where: eq(gradingJobs.id, jobId),
  });
  if (!job) return null;

  await db
    .update(gradingJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(gradingJobs.id, jobId));

  const [examQuestions, submissions] = await Promise.all([
    db.query.questions.findMany({
      where: eq(questions.examId, job.examId),
      columns: { id: true },
    }),
    db.query.studentSubmissions.findMany({
      where: eq(studentSubmissions.examId, job.examId),
      columns: { id: true },
    }),
  ]);

  return {
    examId: job.examId,
    submissionIds: submissions.map((s) => s.id),
    questionCount: examQuestions.length,
  };
}

/**
 * Grades one submission inside a batch job, updating the job's counters.
 * Idempotent enough for retries: gradeAnswer upserts per (submission,
 * question), so a retried submission overwrites rather than duplicates.
 */
export async function gradeSubmissionForJob(
  jobId: string,
  submissionId: string,
  questionCount: number,
): Promise<void> {
  const markItem = async (ok: boolean, error?: string) => {
    await db
      .update(gradingJobs)
      .set(
        ok
          ? { completedItems: sql`${gradingJobs.completedItems} + 1` }
          : {
              failedItems: sql`${gradingJobs.failedItems} + 1`,
              lastError: error ?? "Okänt fel.",
            },
      )
      .where(eq(gradingJobs.id, jobId));
  };

  try {
    await gradeSubmission(submissionId, markItem);
  } catch (err) {
    // Whole-submission failure: count all of its questions as failed.
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(gradingJobs)
      .set({
        failedItems: sql`${gradingJobs.failedItems} + ${questionCount}`,
        lastError: message,
      })
      .where(eq(gradingJobs.id, jobId));
  }
}

export async function finalizeGradingJob(jobId: string, examId: string): Promise<void> {
  await db
    .update(gradingJobs)
    .set({
      status: "completed", // per-item failures live in failedItems/lastError
      finishedAt: new Date(),
    })
    .where(eq(gradingJobs.id, jobId));

  await db.update(exams).set({ status: "graded" }).where(eq(exams.id, examId));
}

export async function failGradingJob(jobId: string, error: unknown): Promise<void> {
  await db
    .update(gradingJobs)
    .set({
      status: "failed",
      lastError: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
    })
    .where(eq(gradingJobs.id, jobId));
}

// ---------------------------------------------------------------------------
// In-process fallback (local dev / long-running Node without Inngest)
// ---------------------------------------------------------------------------

export async function processGradingJob(jobId: string): Promise<void> {
  const loaded = await markJobRunning(jobId);
  if (!loaded) return;

  await mapWithConcurrency(
    loaded.submissionIds,
    SUBMISSION_CONCURRENCY,
    (submissionId) => gradeSubmissionForJob(jobId, submissionId, loaded.questionCount),
  );

  await finalizeGradingJob(jobId, loaded.examId);
}
