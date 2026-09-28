"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { gradingResults, questions } from "@/db/schema";
import { capturePrecedentFromOverride } from "@/lib/rag/learn";
import { assertResultInSchool, requireTeacher, TenancyError } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ReviewActionResult = { success: true } | { success: false; error: string };

// ---------------------------------------------------------------------------
// Approve the AI's grading as-is
// ---------------------------------------------------------------------------

export async function approveResult(resultId: string): Promise<ReviewActionResult> {
  const parsed = z.string().uuid().safeParse(resultId);
  if (!parsed.success) return { success: false, error: "Ogiltigt resultat-id." };

  const teacher = await requireTeacher();
  try {
    await assertResultInSchool(parsed.data, teacher.schoolId);
  } catch (err) {
    if (err instanceof TenancyError) {
      return { success: false, error: "Resultatet hittades inte." };
    }
    throw err;
  }

  const [updated] = await db
    .update(gradingResults)
    .set({ status: "approved", needsHumanReview: false, updatedAt: sql`now()` })
    .where(eq(gradingResults.id, parsed.data))
    .returning({ submissionId: gradingResults.submissionId });

  if (!updated) return { success: false, error: "Resultatet hittades inte." };

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "result.approve",
    entityType: "result",
    entityId: parsed.data,
  });

  revalidatePath(`/review/${updated.submissionId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Override points / add a teacher comment
// ---------------------------------------------------------------------------

const OverrideInputSchema = z.object({
  resultId: z.string().uuid(),
  awardedPoints: z.number().min(0),
  teacherComment: z.string().max(2000).optional(),
});
export type OverrideInput = z.infer<typeof OverrideInputSchema>;

export async function overrideResult(rawInput: OverrideInput): Promise<ReviewActionResult> {
  const parsed = OverrideInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const teacher = await requireTeacher();
  try {
    await assertResultInSchool(input.resultId, teacher.schoolId);
  } catch (err) {
    if (err instanceof TenancyError) {
      return { success: false, error: "Resultatet hittades inte." };
    }
    throw err;
  }

  const result = await db.query.gradingResults.findFirst({
    where: eq(gradingResults.id, input.resultId),
  });
  if (!result) return { success: false, error: "Resultatet hittades inte." };

  const question = await db.query.questions.findFirst({
    where: eq(questions.id, result.questionId),
  });
  if (!question) return { success: false, error: "Frågan hittades inte." };

  if (input.awardedPoints > question.maxPoints) {
    return {
      success: false,
      error: `Poängen får inte överstiga uppgiftens maxpoäng (${question.maxPoints}p).`,
    };
  }

  await db
    .update(gradingResults)
    .set({
      awardedPoints: input.awardedPoints,
      teacherComment: input.teacherComment ?? null,
      status: "overridden",
      needsHumanReview: false,
      updatedAt: sql`now()`,
    })
    .where(eq(gradingResults.id, input.resultId));

  // Learning flywheel: the override becomes an embedded grading precedent so
  // future similar answers are scored the way this teacher scores them.
  // Non-fatal — the override itself must never fail on KB write errors.
  try {
    await capturePrecedentFromOverride({
      resultId: input.resultId,
      awardedPoints: input.awardedPoints,
      teacherComment: input.teacherComment,
    });
  } catch (err) {
    console.error("Failed to capture grading precedent:", err);
  }

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "result.override",
    entityType: "result",
    entityId: input.resultId,
    metadata: { awardedPoints: input.awardedPoints },
  });

  revalidatePath(`/review/${result.submissionId}`);
  return { success: true };
}
