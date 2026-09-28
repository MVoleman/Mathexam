import { z } from "zod";
import { GradeLevelSchema, Lgr22AbilitySchema } from "@/lib/validations/ai-schemas";

/** Teacher-entered (or AI-drafted) question fields, shared by form and server action. */
export const QuestionFieldsSchema = z.object({
  number: z.string().trim().min(1, "Frågenummer krävs."),
  questionText: z.string().trim().min(1, "Frågetext krävs."),
  topic: z.string().trim().min(1, "Område krävs.").toLowerCase(),
  difficulty: GradeLevelSchema,
  maxPoints: z.coerce.number().int().min(1, "Minst 1 poäng.").max(50),
  correctAnswer: z.string().trim().min(1, "Facit krävs."),
  solutionSteps: z.string().trim().optional(),
  lgr22Abilities: z.array(Lgr22AbilitySchema).min(1, "Välj minst en förmåga."),
});
export type QuestionFields = z.infer<typeof QuestionFieldsSchema>;
