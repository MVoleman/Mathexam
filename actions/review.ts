"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { exams, gradingResults, questions } from "@/db/schema";
import { getPack } from "@/lib/curriculum/packs";
import { rubricOf, scoreRubric } from "@/lib/rubric";
import { recordAbilityEvidence } from "@/lib/grading/evidence";
import type { AbilityAssessment } from "@/lib/validations/ai-schemas";
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
  /**
   * The teacher's verdict per ability. Replaces the AI's list; abilities the
   * AI assessed but that are missing here are dropped.
   */
  abilities: z
    .array(z.object({ ability: z.string(), demonstrated: z.boolean() }))
    .optional(),
  /**
   * The teacher's verdict per moment. When given, the points are computed
   * from the moments and `awardedPoints` is ignored.
   */
  rubric: z.array(z.object({ itemId: z.string(), met: z.boolean() })).optional(),
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

  let evaluation = result.evaluation;
  let awardedPoints = input.awardedPoints;
  if (input.rubric) {
    const rubric = rubricOf(question);
    const known = new Set(rubric.map((i) => i.id));
    const unknown = input.rubric.find((v) => !known.has(v.itemId));
    if (unknown) return { success: false, error: `Okänt moment: ${unknown.itemId}` };

    const previous = new Map((evaluation.rubricAssessment ?? []).map((v) => [v.itemId, v]));
    const scored = scoreRubric(
      rubric,
      input.rubric.map(({ itemId, met }) => {
        const prev = previous.get(itemId);
        return {
          itemId,
          met,
          evidence: prev && prev.met === met ? prev.evidence : "Bedömt av lärare vid granskning.",
        };
      }),
    );
    awardedPoints = scored.points;
    evaluation = {
      ...evaluation,
      rubricAssessment: scored.verdicts,
      lgr22Assessment: scored.abilityAssessment,
      awardedPoints,
    };
  } else if (input.abilities) {
    const exam = await db.query.exams.findFirst({
      where: eq(exams.id, question.examId),
      columns: { curriculum: true },
    });
    const validCodes = new Set(getPack(exam?.curriculum ?? "lgr22").abilities.map((a) => a.code));
    const invalid = input.abilities.find((a) => !validCodes.has(a.ability));
    if (invalid) return { success: false, error: `Okänd förmåga: ${invalid.ability}` };

    const previous = new Map(evaluation.lgr22Assessment.map((a) => [a.ability, a]));
    const assessment: AbilityAssessment[] = input.abilities.map(({ ability, demonstrated }) => {
      const prev = previous.get(ability);
      return {
        ability,
        demonstrated,
        // Keep the AI's level when the verdict still holds; otherwise fall
        // back to the question's level (shown) or none (not shown).
        level: demonstrated ? (prev?.demonstrated && prev.level) || question.difficulty : null,
        evidence:
          prev && prev.demonstrated === demonstrated ? prev.evidence : "Bedömt av lärare vid granskning.",
      };
    });
    evaluation = { ...evaluation, lgr22Assessment: assessment };
  }

  await db
    .update(gradingResults)
    .set({
      awardedPoints,
      evaluation,
      teacherComment: input.teacherComment ?? null,
      status: "overridden",
      needsHumanReview: false,
      updatedAt: sql`now()`,
    })
    .where(eq(gradingResults.id, input.resultId));

  // Progression follows the teacher's verdicts, not the AI's.
  if (input.rubric) {
    await recordAbilityEvidence(input.resultId, question, evaluation.rubricAssessment);
  }

  // Learning flywheel: the override becomes an embedded grading precedent so
  // future similar answers are scored the way this teacher scores them.
  // Non-fatal — the override itself must never fail on KB write errors.
  try {
    await capturePrecedentFromOverride({
      resultId: input.resultId,
      awardedPoints,
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
    metadata: {
      awardedPoints,
      // e.g. "method:+,concept:-"; omitted when abilities were left untouched.
      ...(input.abilities && {
        abilities: input.abilities.map((a) => `${a.ability}:${a.demonstrated ? "+" : "-"}`).join(","),
      }),
      // e.g. "m1:+,m2:-"; omitted when moments were left untouched.
      ...(input.rubric && {
        moments: input.rubric.map((v) => `${v.itemId}:${v.met ? "+" : "-"}`).join(","),
      }),
    },
  });

  revalidatePath(`/review/${result.submissionId}`);
  return { success: true };
}
