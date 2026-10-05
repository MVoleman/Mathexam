import { generateObject } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  exams,
  questions,
  studentSubmissions,
  gradingResults,
  type Question,
  type GradingResult,
} from "@/db/schema";
import {
  transcriptionModel,
  gradingModel,
  secondOpinionModel,
  embedText,
  DUAL_GRADING,
} from "@/lib/ai/models";
import {
  findRelevantSolutionReferences,
  type SolutionReferenceMatch,
} from "@/lib/rag/vector-search";
import { abilityPromptBlock, getAbilityLabels, getPack } from "@/lib/curriculum/packs";
import {
  formatLevelPoints,
  rubricOf,
  rubricPromptLines,
  scoreRubric,
  summarizeRubric,
} from "@/lib/rubric";
import { SUBMISSIONS_BUCKET, resolveStorageUrls } from "@/lib/storage";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { recordAbilityEvidence } from "@/lib/grading/evidence";
import {
  TranscriptionResultSchema,
  SubmissionTranscriptionSchema,
  ModelEvaluationSchema,
  type ModelEvaluation,
  type TranscriptionResult,
  type AnswerTranscription,
  type EvaluationResult,
} from "@/lib/validations/ai-schemas";

// Minimum transcription confidence before we trust the pipeline end-to-end.
const TRANSCRIPTION_CONFIDENCE_THRESHOLD = 0.7;
// Second opinion triggers below this primary-grader confidence (mode "risk").
const SECOND_OPINION_CONFIDENCE_THRESHOLD = 0.85;
// Questions evaluated in parallel per submission.
const EVALUATION_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// RAG context (memoized — the same question recurs across a whole class)
// ---------------------------------------------------------------------------

export type RagContext = {
  question: Question;
  references: SolutionReferenceMatch[];
  /** Curriculum pack id of the exam ("lgr22", "gy25", "ib-myp", "ib-dp"). */
  curriculum: string;
};

const RAG_CACHE_TTL_MS = 10 * 60 * 1000;
const ragCache = new Map<string, { at: number; value: Promise<RagContext> }>();

export async function fetchRagContext(questionId: string): Promise<RagContext> {
  const cached = ragCache.get(questionId);
  if (cached && Date.now() - cached.at < RAG_CACHE_TTL_MS) return cached.value;

  const value = (async () => {
    const question = await db.query.questions.findFirst({
      where: eq(questions.id, questionId),
    });
    if (!question) throw new Error(`Question ${questionId} not found.`);

    const exam = await db.query.exams.findFirst({ where: eq(exams.id, question.examId) });
    if (!exam) throw new Error(`Exam ${question.examId} not found.`);

    const embedding = await embedText(
      `${question.topic}: ${question.questionText}`,
      "RETRIEVAL_QUERY",
    );
    const references = await findRelevantSolutionReferences(
      embedding,
      exam.course,
      question.topic,
      3,
    );
    return { question, references, curriculum: exam.curriculum };
  })();

  ragCache.set(questionId, { at: Date.now(), value });
  value.catch(() => ragCache.delete(questionId)); // don't cache failures
  return value;
}

/** Invalidate after knowledge-base writes (e.g. the learning flywheel). */
export function invalidateRagCache(questionId: string): void {
  ragCache.delete(questionId);
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

const transcriptionSystemLines = [
  "You are transcribing a Swedish student's handwritten math exam answers.",
  "Transcribe ALL visible work verbatim, in order, including crossed-out attempts (mark them as such).",
  "Express the mathematics in LaTeX. Do not correct the student's errors.",
  "Report your confidence honestly and list any segments you could not read.",
];

/**
 * ONE pass over the whole submission: segments and transcribes every answer,
 * keyed to question numbers. O(pages) instead of O(pages × questions).
 */
export async function transcribeSubmission(
  imageUrls: string[],
  examQuestions: Pick<Question, "number" | "questionText">[],
): Promise<AnswerTranscription[]> {
  const questionList = examQuestions
    .map((q) => `- ${q.number}: ${q.questionText}`)
    .join("\n");

  const { object } = await generateObject({
    model: transcriptionModel(),
    schema: SubmissionTranscriptionSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              ...transcriptionSystemLines,
              "",
              "The exam has the following questions:",
              questionList,
              "",
              "Return one entry PER QUESTION, in order. If a question was not attempted, return it with isBlank=true.",
            ].join("\n"),
          },
          ...imageUrls.map((url) => ({ type: "image" as const, image: new URL(url) })),
        ],
      },
    ],
  });

  return object.answers;
}

/** Targeted single-question transcription (used for re-grades). */
export async function transcribeSingleAnswer(
  imageUrls: string[],
  question: Question,
): Promise<TranscriptionResult> {
  const { object } = await generateObject({
    model: transcriptionModel(),
    schema: TranscriptionResultSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              ...transcriptionSystemLines,
              `Locate and transcribe ONLY the answer to question ${question.number}:`,
              `"${question.questionText}"`,
            ].join("\n"),
          },
          ...imageUrls.map((url) => ({ type: "image" as const, image: new URL(url) })),
        ],
      },
    ],
  });
  return object;
}

// ---------------------------------------------------------------------------
// Evaluation (primary grader + independent second opinion)
// ---------------------------------------------------------------------------

function buildEvaluationPrompt(
  transcription: TranscriptionResult,
  context: RagContext,
): { system: string; prompt: string } {
  const { question, references } = context;
  const pack = getPack(context.curriculum);
  const feedbackLanguage = pack.language === "sv" ? "svenska" : "English";

  const referenceBlock =
    references.length > 0
      ? references
          .map(
            (ref, i) =>
              `### Referens ${i + 1} (${ref.source === "teacher_override" ? "lärarbedömt prejudikat" : "facitreferens"}, likhet ${(ref.similarity * 100).toFixed(0)}%)\n` +
              `Korrekt lösning: ${ref.correctSolution}\n` +
              `Vanliga fallgropar: ${ref.commonPitfalls ?? "–"}\n` +
              `Delpoängsregler: ${ref.partialCreditRules ?? "–"}`,
          )
          .join("\n\n")
      : "Ingen referens hittades — bedöm utifrån facit och lösningssteg.";

  return {
    system: [
      pack.graderPersona,
      "Bedöm ENDAST utifrån elevens redovisade arbete. Var konsekvent med delpoängsreglerna.",
      "Poäng ges per moment i bedömningsanvisningen: avgör för VARJE moment om elevens lösning uppfyller det (met) och citera belägg. Ett högre moment som bygger på ett lägre (\"med i övrigt godtagbar lösning …\") kräver normalt att det lägre också är uppfyllt. Räkna inte ihop poäng själv.",
      "Lärarbedömda prejudikat visar hur läraren själv poängsatt liknande svar — följ dem.",
      `Formativ återkoppling ska vara konstruktiv, konkret och riktad till eleven på ${feedbackLanguage}.`,
      "",
      `Kursplanens förmågor/kriterier (${pack.label}):`,
      abilityPromptBlock(pack),
    ].join("\n"),
    prompt: [
      `## Uppgift ${question.number} (${formatLevelPoints(summarizeRubric(rubricOf(question)).levelPoints)} E/C/A-poäng)`,
      question.questionText,
      `Facit: ${question.correctAnswer}`,
      question.solutionSteps ? `Lösningssteg: ${question.solutionSteps}` : "",
      "",
      "## Bedömningsanvisning (ge exakt ett omdöme per moment-id)",
      rubricPromptLines(rubricOf(question), getAbilityLabels(context.curriculum)),
      "",
      "## Referensmaterial (kunskapsbas)",
      referenceBlock,
      "",
      "## Elevens svar (transkriberat)",
      transcription.transcribedText,
      `LaTeX: ${transcription.latex}`,
      transcription.uncertainSegments.length > 0
        ? `Osäkra passager i transkriptionen: ${transcription.uncertainSegments.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * Turns the model's per-moment verdicts into a stored EvaluationResult:
 * points, max and the ability summary come from the moments, not the model.
 */
function toEvaluationResult(model: ModelEvaluation, context: RagContext): EvaluationResult {
  const rubric = rubricOf(context.question);
  const scored = scoreRubric(rubric, model.rubricAssessment);
  return {
    ...model,
    rubricAssessment: scored.verdicts,
    awardedPoints: scored.points,
    maxPoints: summarizeRubric(rubric).maxPoints,
    lgr22Assessment: scored.abilityAssessment,
  };
}

export async function evaluateAnswer(
  transcription: TranscriptionResult,
  context: RagContext,
): Promise<EvaluationResult> {
  const { system, prompt } = buildEvaluationPrompt(transcription, context);
  const { object } = await generateObject({
    model: gradingModel(),
    schema: ModelEvaluationSchema,
    system,
    prompt,
  });
  return toEvaluationResult(object, context);
}

async function secondOpinion(
  transcription: TranscriptionResult,
  context: RagContext,
): Promise<EvaluationResult> {
  const { system, prompt } = buildEvaluationPrompt(transcription, context);
  const { object } = await generateObject({
    model: secondOpinionModel(),
    schema: ModelEvaluationSchema,
    system,
    prompt,
  });
  return toEvaluationResult(object, context);
}

function needsSecondOpinion(evaluation: EvaluationResult, maxPoints: number): boolean {
  if (DUAL_GRADING === "off") return false;
  if (DUAL_GRADING === "all") return true;
  // "risk": partial credit is where rubric consistency is hardest, and
  // low confidence speaks for itself.
  const isPartial = evaluation.awardedPoints > 0 && evaluation.awardedPoints < maxPoints;
  return isPartial || evaluation.confidence < SECOND_OPINION_CONFIDENCE_THRESHOLD;
}

function disagreementThreshold(maxPoints: number): number {
  return Math.max(1, 0.25 * maxPoints);
}

// ---------------------------------------------------------------------------
// Grade one answer (shared by single re-grade and batch)
// ---------------------------------------------------------------------------

const blankEvaluation = (question: Question): EvaluationResult => ({
  awardedPoints: 0,
  maxPoints: question.maxPoints,
  rubricAssessment: rubricOf(question).map((i) => ({ itemId: i.id, met: false, evidence: "" })),
  lgr22Assessment: [],
  reasoning: "Svaret är blankt — inga poäng kan ges.",
  formativeFeedback:
    "Du lämnade den här uppgiften blank. Försök alltid påbörja en lösning — även en påbörjad metod kan ge poäng.",
  identifiedPitfalls: [],
  confidence: 1,
  needsHumanReview: false,
});

export async function gradeAnswer(input: {
  submissionId: string;
  questionId: string;
  transcription: TranscriptionResult;
}): Promise<GradingResult> {
  const context = await fetchRagContext(input.questionId);
  const maxPoints = context.question.maxPoints;
  const { transcription } = input;

  let evaluation = transcription.isBlank
    ? blankEvaluation(context.question)
    : await evaluateAnswer(transcription, context);

  // Independent cross-check where the risk sits.
  let secondOpinionPoints: number | null = null;
  if (!transcription.isBlank && needsSecondOpinion(evaluation, maxPoints)) {
    const second = await secondOpinion(transcription, context);
    secondOpinionPoints = Math.min(second.awardedPoints, maxPoints);

    const diff = Math.abs(evaluation.awardedPoints - secondOpinionPoints);
    if (diff >= disagreementThreshold(maxPoints)) {
      evaluation = {
        ...evaluation,
        needsHumanReview: true,
        reasoning:
          evaluation.reasoning +
          `\n\n⚠ Oberoende andrabedömning gav ${secondOpinionPoints}p (skillnad ${diff.toFixed(1)}p) — manuell granskning krävs.`,
      };
    }
  }

  // Guardrails.
  const awardedPoints = Math.min(evaluation.awardedPoints, maxPoints);
  const needsHumanReview =
    evaluation.needsHumanReview ||
    !transcription.isLegible ||
    transcription.confidence < TRANSCRIPTION_CONFIDENCE_THRESHOLD;

  const persisted = { ...evaluation, awardedPoints, needsHumanReview };

  const [result] = await db
    .insert(gradingResults)
    .values({
      submissionId: input.submissionId,
      questionId: input.questionId,
      transcription,
      evaluation: persisted,
      awardedPoints,
      secondOpinionPoints,
      status: "ai_graded",
      needsHumanReview,
    })
    .onConflictDoUpdate({
      target: [gradingResults.submissionId, gradingResults.questionId],
      set: {
        transcription,
        evaluation: persisted,
        awardedPoints,
        secondOpinionPoints,
        status: "ai_graded",
        needsHumanReview,
        teacherComment: null,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  await recordAbilityEvidence(result.id, context.question, persisted.rubricAssessment);
  return result;
}

// ---------------------------------------------------------------------------
// Grade a whole submission: 1 transcription pass + N evaluations
// ---------------------------------------------------------------------------

const normalizeNumber = (n: string) =>
  n.toLowerCase().replace(/[).\s]/g, "").trim();

const blankTranscription = (): TranscriptionResult => ({
  transcribedText: "",
  latex: "",
  confidence: 1,
  isLegible: true,
  uncertainSegments: [],
  isBlank: true,
});

export async function gradeSubmission(
  submissionId: string,
  onItem?: (ok: boolean, error?: string) => void | Promise<void>,
  /**
   * Batch mode: only evaluate questions this submission has no result for,
   * so earlier gradings (and teacher reviews of them) are never overwritten.
   */
  { onlyUngraded = false }: { onlyUngraded?: boolean } = {},
): Promise<void> {
  const submission = await db.query.studentSubmissions.findFirst({
    where: eq(studentSubmissions.id, submissionId),
  });
  if (!submission) throw new Error(`Submission ${submissionId} not found.`);
  if (submission.imageUrls.length === 0) {
    throw new Error(`Inlämning för elev ${submission.studentId} saknar bilder.`);
  }

  const examQuestions = await db.query.questions.findMany({
    where: eq(questions.examId, submission.examId),
  });
  if (examQuestions.length === 0) throw new Error("Provet saknar frågor.");

  let toGrade = examQuestions;
  if (onlyUngraded) {
    const graded = await db
      .select({ questionId: gradingResults.questionId })
      .from(gradingResults)
      .where(eq(gradingResults.submissionId, submissionId));
    const gradedIds = new Set(graded.map((g) => g.questionId));
    toGrade = examQuestions.filter((q) => !gradedIds.has(q.id));
    if (toGrade.length === 0) return; // nothing new: skip the model calls
  }

  // Buckets are private — mint signed URLs the model can fetch.
  const imageUrls = await resolveStorageUrls(SUBMISSIONS_BUCKET, submission.imageUrls);

  // 1. Single segmentation + transcription pass over all pages. Every
  // question is listed (not just toGrade) so answers map to the right number.
  const answers = await transcribeSubmission(imageUrls, examQuestions);
  const byNumber = new Map(answers.map((a) => [normalizeNumber(a.questionNumber), a]));

  // 2. Evaluate per question, in parallel (text-only — cheap and fast).
  await mapWithConcurrency(toGrade, EVALUATION_CONCURRENCY, async (question) => {
    try {
      const transcription =
        byNumber.get(normalizeNumber(question.number)) ?? blankTranscription();

      await gradeAnswer({
        submissionId,
        questionId: question.id,
        transcription,
      });
      await onItem?.(true);
    } catch (err) {
      await onItem?.(false, err instanceof Error ? err.message : String(err));
    }
  });
}
