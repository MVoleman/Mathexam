import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { abilityEvidence, type Question } from "@/db/schema";
import { rubricOf, type RubricVerdict } from "@/lib/rubric";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Replaces a graded answer's ability evidence with one row per moment,
 * snapshotting the moment as it is now. Answers without per-moment
 * verdicts (graded before moments existed) get no evidence.
 */
export async function recordAbilityEvidence(
  resultId: string,
  question: Pick<Question, "rubric" | "difficulty" | "maxPoints" | "lgr22Abilities">,
  verdicts: RubricVerdict[] | undefined,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.delete(abilityEvidence).where(eq(abilityEvidence.resultId, resultId));
  if (!verdicts) return;

  const byId = new Map(verdicts.map((v) => [v.itemId, v]));
  const rows = rubricOf(question).map((item) => ({
    resultId,
    itemId: item.id,
    ability: item.ability,
    level: item.level,
    points: item.points,
    met: byId.get(item.id)?.met ?? false,
    description: item.description,
    evidence: byId.get(item.id)?.evidence ?? "",
  }));
  if (rows.length > 0) await tx.insert(abilityEvidence).values(rows);
}
