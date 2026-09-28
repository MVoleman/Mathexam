import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  evalResults,
  evalRuns,
  exams,
  goldenItems,
  goldenSets,
  gradingResults,
  questions,
  type EvalRun,
  type EvalRunConfig,
  type GoldenQuestionSnapshot,
  type Question,
} from "@/db/schema";
import { DUAL_GRADING, MODELS, embedText } from "@/lib/ai/models";
import { evaluateAnswer, type RagContext } from "@/lib/grading/engine";
import { findRelevantSolutionReferences } from "@/lib/rag/vector-search";
import { mapWithConcurrency } from "@/lib/utils/concurrency";

const EVAL_CONCURRENCY = 3;
/** Agreement tolerance for "within half a point". */
const HALF_POINT = 0.5;

// ---------------------------------------------------------------------------
// Capture: teacher-verified result → golden item
// ---------------------------------------------------------------------------

/**
 * Snapshots one reviewed grading result into a golden set. The item stores
 * the question as-graded and the transcription — no images and no student
 * identity — so the corpus is stable under later question edits and safe to
 * keep long-term (with consent).
 */
export async function captureGoldenItem(input: {
  resultId: string;
  setId: string;
  consentConfirmed: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.consentConfirmed) {
    return { ok: false, error: "Samtycke måste bekräftas innan svaret sparas." };
  }

  const set = await db.query.goldenSets.findFirst({
    where: eq(goldenSets.id, input.setId),
  });
  if (!set) return { ok: false, error: "Guldkorpusen hittades inte." };
  if (set.frozen) {
    return { ok: false, error: "Korpusen är fryst — skapa en ny version." };
  }

  const result = await db.query.gradingResults.findFirst({
    where: eq(gradingResults.id, input.resultId),
  });
  if (!result) return { ok: false, error: "Resultatet hittades inte." };
  if (result.status === "ai_graded") {
    return {
      ok: false,
      error: "Endast granskade svar (godkända eller ändrade) kan bli guldsvar.",
    };
  }

  const question = await db.query.questions.findFirst({
    where: eq(questions.id, result.questionId),
  });
  if (!question) return { ok: false, error: "Frågan hittades inte." };
  const exam = await db.query.exams.findFirst({
    where: eq(exams.id, question.examId),
  });
  if (!exam) return { ok: false, error: "Provet hittades inte." };

  const snapshot: GoldenQuestionSnapshot = {
    questionText: question.questionText,
    number: question.number,
    topic: question.topic,
    difficulty: question.difficulty,
    maxPoints: question.maxPoints,
    correctAnswer: question.correctAnswer,
    solutionSteps: question.solutionSteps,
    abilities: question.lgr22Abilities,
    course: exam.course,
    curriculum: exam.curriculum,
  };

  await db.insert(goldenItems).values({
    setId: input.setId,
    questionSnapshot: snapshot,
    transcription: result.transcription,
    /** Ground truth = the teacher's final award. */
    teacherPoints: result.awardedPoints,
    teacherComment: result.teacherComment,
    sourceResultId: result.id,
    consentConfirmed: true,
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Run: evaluate every golden item with the CURRENT pipeline configuration
// ---------------------------------------------------------------------------

function contextFromSnapshot(
  snapshot: GoldenQuestionSnapshot,
  references: RagContext["references"],
): RagContext {
  // Synthetic Question — evaluateAnswer only reads the pedagogical fields.
  const question = {
    id: "00000000-0000-0000-0000-000000000000",
    examId: "00000000-0000-0000-0000-000000000000",
    questionText: snapshot.questionText,
    number: snapshot.number,
    topic: snapshot.topic,
    difficulty: snapshot.difficulty,
    maxPoints: snapshot.maxPoints,
    correctAnswer: snapshot.correctAnswer,
    solutionSteps: snapshot.solutionSteps,
    lgr22Abilities: snapshot.abilities as Question["lgr22Abilities"],
    createdAt: new Date(),
  } satisfies Question;

  return { question, references, curriculum: snapshot.curriculum };
}

export function currentEvalConfig(label?: string): EvalRunConfig {
  return {
    gradingModel: MODELS.grading,
    secondOpinionModel: MODELS.secondOpinion,
    dualGrading: DUAL_GRADING,
    ...(label ? { label } : {}),
  };
}

/**
 * Runs the full golden set through the current evaluator and records
 * per-item and aggregate agreement-with-teacher metrics. Returns the
 * completed run (with deltas against the previous completed run on the
 * same set, if any).
 */
export async function runEvalSet(
  setId: string,
  label?: string,
): Promise<EvalRun & { previous: EvalRun | null }> {
  const items = await db.query.goldenItems.findMany({
    where: eq(goldenItems.setId, setId),
  });
  if (items.length === 0) throw new Error("Korpusen innehåller inga guldsvar.");

  const [run] = await db
    .insert(evalRuns)
    .values({
      setId,
      config: currentEvalConfig(label),
      status: "running",
      totalItems: items.length,
      startedAt: new Date(),
    })
    .returning();

  const errors: { itemId: string; abs: number }[] = [];

  await mapWithConcurrency(items, EVAL_CONCURRENCY, async (item) => {
    try {
      const snapshot = item.questionSnapshot;

      // Same retrieval path as production grading.
      let references: RagContext["references"] = [];
      try {
        const embedding = await embedText(
          `${snapshot.topic}: ${snapshot.questionText}`,
          "RETRIEVAL_QUERY",
        );
        references = await findRelevantSolutionReferences(
          embedding,
          snapshot.course,
          snapshot.topic,
          3,
        );
      } catch {
        // Eval still meaningful without RAG context; note stays in config.
      }

      const context = contextFromSnapshot(snapshot, references);
      const evaluation = item.transcription.isBlank
        ? { awardedPoints: 0 }
        : await evaluateAnswer(item.transcription, context);

      const aiPoints = Math.min(evaluation.awardedPoints, snapshot.maxPoints);
      const absError = Math.abs(aiPoints - item.teacherPoints);

      await db
        .insert(evalResults)
        .values({
          runId: run.id,
          itemId: item.id,
          aiPoints,
          teacherPoints: item.teacherPoints,
          absError,
          evaluation: {
            awardedPoints: aiPoints,
            maxPoints: snapshot.maxPoints,
            lgr22Assessment: [],
            reasoning: "",
            formativeFeedback: "",
            identifiedPitfalls: [],
            confidence: 1,
            needsHumanReview: false,
            ...("maxPoints" in evaluation ? evaluation : {}),
          },
        })
        .onConflictDoNothing();

      errors.push({ itemId: item.id, abs: absError });
      await db
        .update(evalRuns)
        .set({ completedItems: sql`${evalRuns.completedItems} + 1` })
        .where(eq(evalRuns.id, run.id));
    } catch (err) {
      await db
        .update(evalRuns)
        .set({
          failedItems: sql`${evalRuns.failedItems} + 1`,
          lastError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(evalRuns.id, run.id));
    }
  });

  // Aggregates.
  const n = errors.length;
  const exactAgreementPct =
    n === 0 ? 0 : (errors.filter((e) => e.abs < 1e-6).length / n) * 100;
  const withinHalfPointPct =
    n === 0 ? 0 : (errors.filter((e) => e.abs <= HALF_POINT).length / n) * 100;
  const meanAbsError = n === 0 ? 0 : errors.reduce((s, e) => s + e.abs, 0) / n;

  const [finished] = await db
    .update(evalRuns)
    .set({
      status: "completed",
      exactAgreementPct,
      withinHalfPointPct,
      meanAbsError,
      finishedAt: new Date(),
    })
    .where(eq(evalRuns.id, run.id))
    .returning();

  const previous = await db.query.evalRuns.findFirst({
    where: sql`${evalRuns.setId} = ${setId}
      and ${evalRuns.status} = 'completed'
      and ${evalRuns.id} <> ${run.id}
      and ${evalRuns.createdAt} < ${finished.createdAt}`,
    orderBy: desc(evalRuns.createdAt),
  });

  return { ...finished, previous: previous ?? null };
}
