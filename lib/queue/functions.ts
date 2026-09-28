import { lt } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { inngest } from "@/lib/queue/inngest";
import {
  failGradingJob,
  finalizeGradingJob,
  gradeSubmissionForJob,
  markJobRunning,
} from "@/lib/grading/batch";
import { processExamPdfFromStorage } from "@/lib/pdf/process-exam";
import { runEvalSet } from "@/lib/evals/runner";

/**
 * Batch grading worker. One retryable step per submission, so a 30-student
 * class-set never has to fit inside a single serverless invocation, and a
 * flaky model call only retries its own submission.
 */
export const gradeBatchJob = inngest.createFunction(
  {
    id: "grade-batch-job",
    // At most 3 class sets grading concurrently across the whole app —
    // keeps model-API pressure and cost bounded.
    concurrency: [{ limit: 3 }],
    onFailure: async ({ event }) => {
      await failGradingJob(event.data.event.data.jobId, event.data.error);
    },
  },
  { event: "grading/job.created" },
  async ({ event, step }) => {
    const { jobId } = event.data;

    const loaded = await step.run("load-job", () => markJobRunning(jobId));
    if (!loaded) return { skipped: true };

    // Parallel steps — Inngest caps parallelism via the concurrency config,
    // and each submission is its own invocation + retry unit.
    await Promise.all(
      loaded.submissionIds.map((submissionId) =>
        step.run(`grade-submission-${submissionId}`, () =>
          gradeSubmissionForJob(jobId, submissionId, loaded.questionCount),
        ),
      ),
    );

    await step.run("finalize", () => finalizeGradingJob(jobId, loaded.examId));
    return { submissions: loaded.submissionIds.length };
  },
);

/** Exam PDF rasterization worker (large uploads / serverless deploys). */
export const rasterizeExamPdf = inngest.createFunction(
  { id: "rasterize-exam-pdf", concurrency: [{ limit: 2 }], retries: 2 },
  { event: "exam/pdf.process" },
  async ({ event, step }) => {
    await step.run("rasterize", () => processExamPdfFromStorage(event.data.examId));
    return { examId: event.data.examId };
  },
);

/** Golden-set eval run worker. */
export const runGoldenSetEval = inngest.createFunction(
  { id: "run-golden-set-eval", concurrency: [{ limit: 1 }], retries: 0 },
  { event: "evals/run.requested" },
  async ({ event, step }) => {
    const run = await step.run("run-eval-set", async () => {
      const result = await runEvalSet(
        event.data.setId,
        event.data.label ?? undefined,
      );
      // Keep the step output small (Inngest stores it).
      return {
        runId: result.id,
        exactAgreementPct: result.exactAgreementPct,
        meanAbsError: result.meanAbsError,
      };
    });
    return run;
  },
);

/**
 * Audit-log retention (docs/GDPR.md): entries older than
 * AUDIT_RETENTION_DAYS (default 365) are pruned nightly. Long enough for a
 * school-year compliance review, short enough to honor storage minimization.
 */
export const pruneAuditLogs = inngest.createFunction(
  { id: "prune-audit-logs", retries: 1 },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const days = Number(process.env.AUDIT_RETENTION_DAYS ?? 365);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deleted = await step.run("prune", async () => {
      const rows = await db
        .delete(auditLogs)
        .where(lt(auditLogs.createdAt, cutoff))
        .returning({ id: auditLogs.id });
      return rows.length;
    });

    return { deleted, cutoff: cutoff.toISOString() };
  },
);

export const functions = [
  gradeBatchJob,
  rasterizeExamPdf,
  runGoldenSetEval,
  pruneAuditLogs,
];
