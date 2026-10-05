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

/**
 * Answers (submission × question) of an exam that have no grading result:
 * new submissions, questions added later and earlier failures. Already
 * graded answers are never re-graded by a batch.
 */
export async function pendingGradingItems(examId: string): Promise<Record<string, number>> {
  const rows = await db.execute<{ submissionId: string; pending: number }>(sql`
    SELECT ss.id AS "submissionId", count(*)::int AS pending
    FROM student_submissions ss
    JOIN questions q ON q.exam_id = ss.exam_id
    LEFT JOIN grading_results gr ON gr.submission_id = ss.id AND gr.question_id = q.id
    WHERE ss.exam_id = ${examId} AND gr.id IS NULL
    GROUP BY ss.id
  `);
  return Object.fromEntries(rows.map((r) => [r.submissionId, Number(r.pending)]));
}

export async function markJobRunning(jobId: string): Promise<{
  examId: string;
  submissionIds: string[];
  /** Ungraded answers per submission (JSON-safe for Inngest steps). */
  pending: Record<string, number>;
} | null> {
  const job = await db.query.gradingJobs.findFirst({
    where: eq(gradingJobs.id, jobId),
  });
  if (!job) return null;

  await db
    .update(gradingJobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(gradingJobs.id, jobId));

  const pending = await pendingGradingItems(job.examId);
  return { examId: job.examId, submissionIds: Object.keys(pending), pending };
}

/**
 * Grades one submission's ungraded answers inside a batch job, updating the
 * job's counters. Safe to retry: answers graded by an earlier attempt are
 * skipped.
 */
export async function gradeSubmissionForJob(
  jobId: string,
  submissionId: string,
  pendingCount: number,
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
    await gradeSubmission(submissionId, markItem, { onlyUngraded: true });
  } catch (err) {
    // Whole-submission failure: count all of its pending answers as failed.
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(gradingJobs)
      .set({
        failedItems: sql`${gradingJobs.failedItems} + ${pendingCount}`,
        lastError: message,
      })
      .where(eq(gradingJobs.id, jobId));
  }
}

export async function finalizeGradingJob(jobId: string, examId: string): Promise<void> {
  const job = await db.query.gradingJobs.findFirst({
    where: eq(gradingJobs.id, jobId),
    columns: { completedItems: true, failedItems: true },
  });
  // Nothing graded (e.g. a provider outage) is a failed job, not a finished
  // one. Partial failures stay "completed"; they live in failedItems/lastError.
  const nothingGraded = !!job && job.completedItems === 0 && job.failedItems > 0;

  await db
    .update(gradingJobs)
    .set({ status: nothingGraded ? "failed" : "completed", finishedAt: new Date() })
    .where(eq(gradingJobs.id, jobId));

  // Don't mark the exam graded off a failed run; keep "graded" only if an
  // earlier run already produced results.
  let examStatus: "graded" | "ready" = "graded";
  if (nothingGraded) {
    const [{ hasResults }] = await db.execute<{ hasResults: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM grading_results gr
        JOIN student_submissions ss ON ss.id = gr.submission_id
        WHERE ss.exam_id = ${examId}
      ) AS "hasResults"
    `);
    examStatus = hasResults ? "graded" : "ready";
  }
  await db.update(exams).set({ status: examStatus }).where(eq(exams.id, examId));
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
    (submissionId) => gradeSubmissionForJob(jobId, submissionId, loaded.pending[submissionId]),
  );

  await finalizeGradingJob(jobId, loaded.examId);
}
