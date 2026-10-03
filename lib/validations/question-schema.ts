import { z } from "zod";
import { RubricItemSchema, rubricOf, summarizeRubric } from "@/lib/rubric";

/** Teacher-entered (or AI-drafted) question fields, shared by form and server action. */
export const QuestionFieldsSchema = z.object({
  number: z.string().trim().min(1, "Frågenummer krävs."),
  questionText: z.string().trim().min(1, "Frågetext krävs."),
  topic: z.string().trim().min(1, "Område krävs.").toLowerCase(),
  correctAnswer: z.string().trim().min(1, "Facit krävs."),
  solutionSteps: z.string().trim().optional(),
  rubric: z
    .array(RubricItemSchema)
    .min(1, "Lägg till minst ett moment i bedömningsanvisningen.")
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, "Moment-id måste vara unika."),
});
export type QuestionFields = z.infer<typeof QuestionFieldsSchema>;

/** DB columns for a validated question: the fields plus what the moments imply. */
export function questionColumns(fields: QuestionFields) {
  const { maxPoints, difficulty, abilities } = summarizeRubric(fields.rubric);
  return {
    ...fields,
    solutionSteps: fields.solutionSteps || null,
    maxPoints,
    difficulty,
    lgr22Abilities: abilities,
  };
}

/**
 * Drafts stored before moments existed carry difficulty/maxPoints/abilities
 * instead of a rubric; turn them into moments so no paid extraction is lost.
 */
export function normalizeDraft<T extends { id: string }>(
  draft: T & Partial<QuestionFields> & {
    difficulty?: "E" | "C" | "A";
    maxPoints?: number;
    lgr22Abilities?: string[];
  },
): QuestionFields & { id: string } {
  const rubric =
    draft.rubric && draft.rubric.length > 0
      ? draft.rubric
      : rubricOf({
          difficulty: draft.difficulty ?? "E",
          maxPoints: Math.max(1, draft.maxPoints ?? 1),
          lgr22Abilities: draft.lgr22Abilities ?? [],
        });
  return {
    id: draft.id,
    number: draft.number ?? "",
    questionText: draft.questionText ?? "",
    topic: draft.topic ?? "",
    correctAnswer: draft.correctAnswer ?? "",
    solutionSteps: draft.solutionSteps ?? "",
    rubric,
  };
}
