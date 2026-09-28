/**
 * CLI eval runner — run the golden set against the CURRENT pipeline config
 * and print agreement-with-teacher metrics (with deltas vs the previous run).
 *
 * Usage:
 *   npm run evals -- <golden-set-id> [label]
 *   GRADING_MODEL=claude-opus-4-8 npm run evals -- <set-id> "opus test"
 *
 * Run before merging any prompt or model change. A drop in agreement is a
 * regression — do not ship it.
 */
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { goldenSets } from "@/db/schema";
import { runEvalSet } from "@/lib/evals/runner";

async function main() {
  const [setIdArg, label] = process.argv.slice(2);

  let setId = setIdArg;
  if (!setId) {
    const latest = await db.query.goldenSets.findMany({
      orderBy: desc(goldenSets.createdAt),
      limit: 1,
    });
    if (latest.length === 0) {
      console.error("No golden sets exist. Create one in the app first (/evals).");
      process.exit(1);
    }
    setId = latest[0].id;
    console.log(`No set id given — using latest set "${latest[0].name}" (${setId}).`);
  }

  console.log("Running eval set… (models:", process.env.GRADING_MODEL ?? "default", ")");
  const run = await runEvalSet(setId, label);

  const fmt = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  const delta = (curr: number | null, prev: number | null | undefined) =>
    curr === null || prev === null || prev === undefined
      ? ""
      : ` (${curr - prev >= 0 ? "+" : ""}${(curr - prev).toFixed(1)} vs previous)`;

  console.log("\n=== Eval run", run.id, "===");
  console.log("Config:", JSON.stringify(run.config));
  console.log("Items:", run.completedItems, "ok,", run.failedItems, "failed");
  console.log(
    "Exact agreement:  ",
    fmt(run.exactAgreementPct) + "%",
    delta(run.exactAgreementPct, run.previous?.exactAgreementPct),
  );
  console.log(
    "Within ±0.5p:     ",
    fmt(run.withinHalfPointPct) + "%",
    delta(run.withinHalfPointPct, run.previous?.withinHalfPointPct),
  );
  console.log(
    "Mean abs error:   ",
    fmt(run.meanAbsError) + "p",
    delta(run.meanAbsError, run.previous?.meanAbsError),
  );
  if (run.failedItems > 0) console.log("Last error:", run.lastError);

  process.exit(run.failedItems > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
