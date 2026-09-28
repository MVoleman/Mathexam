/**
 * Exports a golden set's items as seed-format JSON — the curation pipeline
 * for growing the GLOBAL golden set with real, consented items:
 *
 *   1. Teachers capture consented, reviewed answers into their school set.
 *   2. `npm run golden:export -- <set-id> > contribution.json`
 *   3. A maintainer manually curates items (checks anonymization! student
 *      identifiers must not appear in transcriptions or comments), merges
 *      them into db/seeds/global-golden-set.json as a NEW versioned set,
 *      and seeds it with `npm run seed:golden`.
 *
 * Items are exported WITHOUT ids, school references or source result ids —
 * only pedagogical content leaves the tenant.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { goldenItems, goldenSets } from "@/db/schema";

async function main() {
  const [setId] = process.argv.slice(2);
  if (!setId) {
    console.error("Usage: npm run golden:export -- <golden-set-id>");
    process.exit(1);
  }

  const set = await db.query.goldenSets.findFirst({
    where: eq(goldenSets.id, setId),
  });
  if (!set) {
    console.error(`Golden set ${setId} not found.`);
    process.exit(1);
  }

  const items = await db.query.goldenItems.findMany({
    where: eq(goldenItems.setId, setId),
    orderBy: asc(goldenItems.createdAt),
  });

  const notConsented = items.filter((i) => !i.consentConfirmed).length;
  if (notConsented > 0) {
    console.error(
      `Refusing to export: ${notConsented} item(s) lack consent confirmation.`,
    );
    process.exit(2);
  }

  const payload = {
    name: `${set.name} (contribution export)`,
    description: set.description ?? "",
    items: items.map((item) => ({
      questionSnapshot: item.questionSnapshot,
      transcription: item.transcription,
      teacherPoints: item.teacherPoints,
      teacherComment: item.teacherComment,
    })),
  };

  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
