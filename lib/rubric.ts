import { z } from "zod";
import {
  GradeLevelSchema,
  Lgr22AbilitySchema,
  type AbilityAssessment,
  type GradeLevel,
  type RubricVerdict,
} from "@/lib/validations/ai-schemas";

export type { RubricVerdict };

/**
 * Bedömningsanvisning (scoring guide) as moments, in the style of the
 * national tests: each moment awards points at one level (E/C/A) for one
 * ability. A question's points per level, max points, difficulty and
 * abilities are all derived from its moments.
 */

export const LEVELS: GradeLevel[] = ["E", "C", "A"];

export const RubricItemSchema = z.object({
  id: z.string().min(1),
  description: z.string().trim().min(1, "Beskriv vad som krävs för momentet."),
  level: GradeLevelSchema,
  ability: Lgr22AbilitySchema,
  points: z.coerce.number().int().min(1, "Ett moment ger minst 1 poäng.").max(10),
});
export type RubricItem = z.infer<typeof RubricItemSchema>;

export type LevelPoints = Record<GradeLevel, number>;

export const emptyLevelPoints = (): LevelPoints => ({ E: 0, C: 0, A: 0 });

/** Derived question fields: points per level, max, highest level, abilities. */
export function summarizeRubric(rubric: RubricItem[]) {
  const levelPoints = emptyLevelPoints();
  for (const item of rubric) levelPoints[item.level] += item.points;
  const maxPoints = levelPoints.E + levelPoints.C + levelPoints.A;
  const difficulty: GradeLevel = levelPoints.A > 0 ? "A" : levelPoints.C > 0 ? "C" : "E";
  const abilities = [...new Set(rubric.map((i) => i.ability))];
  return { levelPoints, maxPoints, difficulty, abilities };
}

/** "1/1/0" — the national tests' E/C/A notation. */
export const formatLevelPoints = (p: LevelPoints) => `${p.E}/${p.C}/${p.A}`;

type QuestionLike = {
  rubric?: RubricItem[] | null;
  difficulty: GradeLevel;
  maxPoints: number;
  lgr22Abilities: string[];
};

/**
 * The question's moments. Questions saved before moments existed (and golden
 * snapshots) get one 1-point moment per point at the question's level, so
 * every grading path works with moments.
 */
export function rubricOf(q: QuestionLike): RubricItem[] {
  if (q.rubric && q.rubric.length > 0) return q.rubric;
  const abilities = q.lgr22Abilities.length > 0 ? q.lgr22Abilities : ["method"];
  return Array.from({ length: q.maxPoints }, (_, i) => ({
    id: `m${i + 1}`,
    description: "Poäng enligt facit och lösningssteg.",
    level: q.difficulty,
    ability: abilities[i % abilities.length],
    points: 1,
  }));
}

/**
 * Scores verdicts against the moments. Points come from the moments, never
 * from a model's own arithmetic; unknown ids are ignored, missing ones count
 * as not met.
 */
export function scoreRubric(rubric: RubricItem[], verdicts: RubricVerdict[]) {
  const byId = new Map(verdicts.map((v) => [v.itemId, v]));
  const levelPoints = emptyLevelPoints();
  const normalized: RubricVerdict[] = rubric.map((item) => {
    const v = byId.get(item.id);
    const met = v?.met ?? false;
    if (met) levelPoints[item.level] += item.points;
    return { itemId: item.id, met, evidence: v?.evidence ?? "" };
  });

  // Per-ability summary, kept in the stored evaluation for the review UI.
  const abilityAssessment: AbilityAssessment[] = [];
  for (const ability of new Set(rubric.map((i) => i.ability))) {
    const items = rubric.filter((i) => i.ability === ability);
    const metItems = items.filter((i) => normalized.find((v) => v.itemId === i.id)?.met);
    const highest = LEVELS.slice()
      .reverse()
      .find((l) => metItems.some((i) => i.level === l));
    abilityAssessment.push({
      ability,
      demonstrated: metItems.length > 0,
      level: highest ?? null,
      evidence: metItems.map((i) => normalized.find((v) => v.itemId === i.id)?.evidence).filter(Boolean).join(" ") ||
        "Inget moment för förmågan uppfyllt.",
    });
  }

  return {
    verdicts: normalized,
    points: levelPoints.E + levelPoints.C + levelPoints.A,
    levelPoints,
    abilityAssessment,
  };
}

/** One rubric line for prompts: "[m2] C · resonemang · 1p: …". */
export function rubricPromptLines(rubric: RubricItem[], abilityLabels: Record<string, string>) {
  return rubric
    .map(
      (i) =>
        `- [${i.id}] ${i.level}-nivå · ${abilityLabels[i.ability] ?? i.ability} (${i.ability}) · ${i.points}p: ${i.description}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Per-answer aggregation (analytics, student report, grades)
// ---------------------------------------------------------------------------

type ResultLike = {
  awardedPoints: number;
  evaluation: {
    rubricAssessment?: RubricVerdict[];
    lgr22Assessment: AbilityAssessment[];
  };
  question: QuestionLike;
};

/**
 * Points earned/available per ability. Moment-graded answers count each
 * moment's points under its own ability; older answers fall back to the
 * answer's points for every ability the grader marked as shown.
 */
export function abilityTotals(results: ResultLike[]) {
  const totals = new Map<string, { earned: number; available: number }>();
  const add = (ability: string, earned: number, available: number) => {
    const t = totals.get(ability) ?? { earned: 0, available: 0 };
    t.earned += earned;
    t.available += available;
    totals.set(ability, t);
  };

  for (const r of results) {
    const verdicts = r.evaluation.rubricAssessment;
    if (verdicts) {
      const met = new Set(verdicts.filter((v) => v.met).map((v) => v.itemId));
      for (const item of rubricOf(r.question)) {
        add(item.ability, met.has(item.id) ? item.points : 0, item.points);
      }
    } else {
      for (const a of r.evaluation.lgr22Assessment) {
        add(a.ability, a.demonstrated ? r.awardedPoints : 0, r.question.maxPoints);
      }
    }
  }
  return totals;
}

/** Points earned per level for one answer (older answers: at the question's level). */
export function answerLevelPoints(r: ResultLike): LevelPoints {
  const verdicts = r.evaluation.rubricAssessment;
  if (!verdicts) {
    const p = emptyLevelPoints();
    p[r.question.difficulty] = r.awardedPoints;
    return p;
  }
  return scoreRubric(rubricOf(r.question), verdicts).levelPoints;
}

// ---------------------------------------------------------------------------
// Grades with level requirements
// ---------------------------------------------------------------------------

export type GradingLimitsLike = {
  E: number;
  C: number;
  A: number;
  /** C also needs at least this many points on C or A level. */
  cLevelMin?: number;
  /** A also needs at least this many points on A level. */
  aLevelMin?: number;
};

export function gradeFor(
  total: number,
  levelPoints: LevelPoints,
  limits: GradingLimitsLike,
): "F" | "E" | "C" | "A" {
  const cOrA = levelPoints.C + levelPoints.A;
  if (total >= limits.A && levelPoints.A >= (limits.aLevelMin ?? 0) && cOrA >= (limits.cLevelMin ?? 0)) {
    return "A";
  }
  if (total >= limits.C && cOrA >= (limits.cLevelMin ?? 0)) return "C";
  if (total >= limits.E) return "E";
  return "F";
}

export function addLevelPoints(a: LevelPoints, b: LevelPoints): LevelPoints {
  return { E: a.E + b.E, C: a.C + b.C, A: a.A + b.A };
}
