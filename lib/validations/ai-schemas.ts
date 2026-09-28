import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Ability CODE from the exam's curriculum pack (lib/curriculum/packs.ts) —
 * e.g. "method" (Lgr22), "modeling" (Gy25), "criterion_b" (IB MYP).
 * The valid codes are injected into each prompt. Name kept from the
 * Lgr22-only era to avoid a repo-wide rename.
 */
export const Lgr22AbilitySchema = z
  .string()
  .describe("Ability code — MUST be one of the codes listed in the prompt.");
export type Lgr22Ability = z.infer<typeof Lgr22AbilitySchema>;

export const GradeLevelSchema = z.enum(["E", "C", "A"]);
export type GradeLevel = z.infer<typeof GradeLevelSchema>;

// ---------------------------------------------------------------------------
// Step 1 — transcribeAnswer (Gemini 1.5 Pro, generateObject)
// ---------------------------------------------------------------------------

export const TranscriptionResultSchema = z.object({
  /** Verbatim transcription of the student's handwritten work, in plain text. */
  transcribedText: z
    .string()
    .describe("Full transcription of the student's handwritten answer, preserving all steps in order."),
  /** LaTeX rendering of the mathematical content. */
  latex: z
    .string()
    .describe("The mathematical content of the answer expressed in LaTeX."),
  /** Overall OCR confidence, 0–1. */
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in the transcription accuracy, 0 (illegible) to 1 (certain)."),
  /** Whether the answer is legible enough to be graded at all. */
  isLegible: z
    .boolean()
    .describe("False if the handwriting is too unclear to grade reliably."),
  /** Passages the model could not read with certainty. */
  uncertainSegments: z
    .array(z.string())
    .describe("Verbatim segments where the transcription is uncertain. Empty if none."),
  /** True if the page appears blank / the question was skipped. */
  isBlank: z.boolean().describe("True if the student left the answer blank."),
});
export type TranscriptionResult = z.infer<typeof TranscriptionResultSchema>;

/**
 * One-pass segmentation: all answers on a submission, transcribed and keyed
 * to their question numbers in a single multimodal call (O(pages) instead of
 * O(pages × questions)).
 */
export const AnswerTranscriptionSchema = TranscriptionResultSchema.extend({
  questionNumber: z
    .string()
    .describe('The exam question this answer belongs to, exactly as numbered, e.g. "2a".'),
});
export type AnswerTranscription = z.infer<typeof AnswerTranscriptionSchema>;

export const SubmissionTranscriptionSchema = z.object({
  answers: z
    .array(AnswerTranscriptionSchema)
    .describe("One entry per exam question — include blank/skipped questions with isBlank=true."),
});
export type SubmissionTranscription = z.infer<typeof SubmissionTranscriptionSchema>;

// ---------------------------------------------------------------------------
// Step 2 — evaluateAnswer (primary grader, generateObject)
// ---------------------------------------------------------------------------

export const AbilityAssessmentSchema = z.object({
  ability: Lgr22AbilitySchema,
  demonstrated: z
    .boolean()
    .describe("Whether the student demonstrated this ability in the answer."),
  level: GradeLevelSchema.nullable().describe(
    "Highest quality level (E/C/A) at which the ability was demonstrated, or null if not demonstrated.",
  ),
  evidence: z
    .string()
    .describe("Short quote or observation from the student's work supporting the judgement."),
});
export type AbilityAssessment = z.infer<typeof AbilityAssessmentSchema>;

export const EvaluationResultSchema = z.object({
  /** Points awarded, respecting the question's max points and partial-credit rules. */
  awardedPoints: z
    .number()
    .min(0)
    .describe("Points awarded. Must not exceed the question's max points."),
  maxPoints: z.number().int().positive().describe("The question's maximum points, echoed back."),
  /** Per-ability Lgr22 assessment. */
  lgr22Assessment: z
    .array(AbilityAssessmentSchema)
    .describe("Assessment for each Lgr22 ability relevant to the question."),
  /** Step-by-step grading rationale (teacher-facing). */
  reasoning: z
    .string()
    .describe("Teacher-facing explanation of how the score was determined, referencing the rubric."),
  /** Formative, student-facing feedback in Swedish. */
  formativeFeedback: z
    .string()
    .describe("Constructive, encouraging feedback addressed to the student, written in Swedish."),
  /** Pitfalls from the knowledge base the student actually fell into. */
  identifiedPitfalls: z
    .array(z.string())
    .describe("Common pitfalls from the reference material observed in this answer. Empty if none."),
  /** Grader self-reported confidence, 0–1. */
  confidence: z.number().min(0).max(1),
  /** Escalate to a human when the model is unsure or transcription was weak. */
  needsHumanReview: z
    .boolean()
    .describe("True if a teacher should verify this grading manually."),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// ---------------------------------------------------------------------------
// Question extraction from exam pages (Gemini 1.5 Pro, generateObject)
// ---------------------------------------------------------------------------

export const ExtractedQuestionSchema = z.object({
  number: z.string().describe('Question number as printed, e.g. "1", "2a".'),
  questionText: z.string().describe("The full question text, verbatim."),
  topic: z
    .string()
    .describe('Math topic in Swedish, lowercase, e.g. "algebra", "geometri", "statistik".'),
  difficulty: GradeLevelSchema.describe("Assessed difficulty level per Lgr22: E, C or A."),
  maxPoints: z
    .number()
    .int()
    .min(1)
    .describe("Maximum points as printed on the exam, or a reasonable estimate."),
  correctAnswer: z.string().describe("The correct final answer."),
  solutionSteps: z.string().describe("A concise correct solution, step by step."),
  lgr22Abilities: z
    .array(Lgr22AbilitySchema)
    .min(1)
    .describe(
      "Which curriculum abilities the question primarily assesses — use the ability CODES listed in the prompt.",
    ),
});
export type ExtractedQuestion = z.infer<typeof ExtractedQuestionSchema>;

export const ExamExtractionSchema = z.object({
  questions: z
    .array(ExtractedQuestionSchema)
    .describe("Every question found on the exam pages, in order."),
});
export type ExamExtraction = z.infer<typeof ExamExtractionSchema>;
