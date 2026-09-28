"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  exams,
  gradingJobs,
  questions,
  studentSubmissions,
  type GradingJob,
} from "@/db/schema";
import { failGradingJob, processGradingJob } from "@/lib/grading/batch";
import { inngest, queueEnabled } from "@/lib/queue/inngest";
import { requireTeacher } from "@/lib/auth";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Start a batch job for a whole exam (all submissions × all questions)
// ---------------------------------------------------------------------------

export async function startBatchGrading(
  examId: string,
): Promise<{ jobId: string } | { error: string }> {
  const teacher = await requireTeacher();
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, examId), eq(exams.schoolId, teacher.schoolId)),
  });
  if (!exam) return { error: "Provet hittades inte." };

  const [examQuestions, submissions] = await Promise.all([
    db.query.questions.findMany({ where: eq(questions.examId, examId) }),
    db.query.studentSubmissions.findMany({ where: eq(studentSubmissions.examId, examId) }),
  ]);

  if (examQuestions.length === 0) return { error: "Provet saknar frågor." };
  if (submissions.length === 0) return { error: "Inga inlämningar att rätta." };

  const [job] = await db
    .insert(gradingJobs)
    .values({
      examId,
      status: "queued",
      totalItems: examQuestions.length * submissions.length,
    })
    .returning();

  await db.update(exams).set({ status: "grading" }).where(eq(exams.id, examId));

  if (queueEnabled()) {
    // Serverless-safe: the Inngest worker grades each submission as its own
    // retryable step (app/api/inngest/route.ts).
    await inngest.send({ name: "grading/job.created", data: { jobId: job.id } });
  } else {
    // Local dev / long-running Node: fire-and-forget in-process.
    void processGradingJob(job.id).catch((err) => failGradingJob(job.id, err));
  }

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "grading.batch_start",
    entityType: "exam",
    entityId: examId,
    metadata: { submissions: submissions.length, questions: examQuestions.length },
  });

  revalidatePath(`/exams/${examId}`);
  return { jobId: job.id };
}

// ---------------------------------------------------------------------------
// Polling endpoint for the frontend
// ---------------------------------------------------------------------------

export async function getGradingJobStatus(jobId: string): Promise<GradingJob | null> {
  const teacher = await requireTeacher();
  const job = await db.query.gradingJobs.findFirst({
    where: eq(gradingJobs.id, jobId),
    with: { exam: { columns: { schoolId: true } } },
  });
  if (!job || job.exam.schoolId !== teacher.schoolId) return null;
  const { exam: _exam, ...rest } = job;
  return rest;
}
