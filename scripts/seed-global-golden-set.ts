/**
 * Seeds the SHARED, anonymized global golden set (school_id = null) from
 * db/seeds/global-golden-set.json. Idempotent: skips if a global set with
 * the same name already exists.
 *
 * Usage: npm run seed:golden
 *
 * Every school can read global sets (RLS) and run evals against them —
 * this is what makes cross-school accuracy claims public and comparable.
 * Grow the corpus over time with REAL consented, anonymized items; freeze
 * a version before citing numbers publicly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { goldenItems, goldenSets, type GoldenQuestionSnapshot } from "@/db/schema";
import type { TranscriptionResult } from "@/lib/validations/ai-schemas";

type SeedFile = {
  name: string;
  description: string;
  items: {
    questionSnapshot: GoldenQuestionSnapshot;
    transcription: TranscriptionResult;
    teacherPoints: number;
    teacherComment: string | null;
  }[];
};

async function main() {
  const raw = readFileSync(
    join(process.cwd(), "db/seeds/global-golden-set.json"),
    "utf8",
  );
  const seed = JSON.parse(raw) as SeedFile;

  const existing = await db.query.goldenSets.findFirst({
    where: and(eq(goldenSets.name, seed.name), isNull(goldenSets.schoolId)),
  });
  if (existing) {
    console.log(`Global set "${seed.name}" already exists (${existing.id}) — skipping.`);
    process.exit(0);
  }

  const [set] = await db
    .insert(goldenSets)
    .values({
      schoolId: null,
      name: seed.name,
      description: seed.description,
      // Frozen from the start: v1 stays comparable; create v2 for additions.
      frozen: true,
    })
    .returning();

  await db.insert(goldenItems).values(
    seed.items.map((item) => ({
      setId: set.id,
      questionSnapshot: item.questionSnapshot,
      transcription: item.transcription,
      teacherPoints: item.teacherPoints,
      teacherComment: item.teacherComment,
      // Seed items are authored/anonymized — no consent subject exists.
      consentConfirmed: true,
    })),
  );

  console.log(`Seeded global golden set "${seed.name}" (${set.id}) with ${seed.items.length} items.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
