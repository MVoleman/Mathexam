import { google } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { embed } from "ai";

/**
 * Central model configuration. Every model ID is env-overridable so model
 * churn is a config change, not a refactor.
 *
 * Defaults (verified July 2026):
 * - gemini-3.5-flash        — GA frontier Flash; top-tier OCR/vision, cheap & fast.
 * - gemini-3.1-pro-preview  — strongest Gemini reasoning; used where the model
 *                             must SOLVE math (question extraction).
 * - claude-sonnet-5-5       — current Sonnet; primary grader. (No sampling
 *                             params and no forced tool use: @ai-sdk/anthropic
 *                             uses native structured output for it.)
 * - gemini-embedding-001    — replaces text-embedding-004 (deprecated 2026-01-14);
 *                             MRL-truncated to 768 dims to match the pgvector schema.
 */
export const MODELS = {
  transcription: process.env.TRANSCRIPTION_MODEL ?? "gemini-3.5-flash",
  extraction: process.env.EXTRACTION_MODEL ?? "gemini-3.1-pro-preview",
  grading: process.env.GRADING_MODEL ?? "claude-sonnet-5-5",
  secondOpinion: process.env.SECOND_OPINION_MODEL ?? "gemini-3.5-flash",
  embedding: process.env.EMBEDDING_MODEL ?? "gemini-embedding-001",
} as const;

/**
 * Explicit base URL: @ai-sdk/anthropic otherwise reads ANTHROPIC_BASE_URL and
 * expects it to end in /v1, while Anthropic's own SDK and tooling set that
 * variable WITHOUT /v1 — an inherited value would send every call to a 404.
 */
const anthropic = createAnthropic({ baseURL: "https://api.anthropic.com/v1" });

export const transcriptionModel = () => google(MODELS.transcription);
export const extractionModel = () => google(MODELS.extraction);
export const gradingModel = () => anthropic(MODELS.grading);
/** Independent model family from the primary grader — that's the point. */
export const secondOpinionModel = () => google(MODELS.secondOpinion);

/** Must match the `vector(768)` column in db/schema.ts. */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Dual-grading policy:
 * - "off":  primary grader only.
 * - "risk": second opinion on partial-credit or low-confidence answers (default).
 * - "all":  second opinion on every answer (2× evaluation cost).
 */
export type DualGradingMode = "off" | "risk" | "all";
export const DUAL_GRADING: DualGradingMode =
  (process.env.DUAL_GRADING as DualGradingMode) ?? "risk";

export async function embedText(
  value: string,
  taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" = "RETRIEVAL_QUERY",
): Promise<number[]> {
  const { embedding } = await embed({
    model: google.textEmbeddingModel(MODELS.embedding),
    value,
    providerOptions: {
      google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
    },
  });
  return embedding;
}
