/**
 * Backfills ability progression for data created before it existed:
 *   1. links submissions without a roster student to one (by name, creating
 *      manual roster entries as upload does), and
 *   2. writes ability evidence for every moment-graded answer.
 * Idempotent: linked submissions are skipped and evidence is replaced.
 *
 * Usage: npx tsx --conditions=react-server scripts/backfill-progression.ts
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { exams, studentSubmissions } from "@/db/schema";
import { recordAbilityEvidence } from "@/lib/grading/evidence";
import { resolveStudentByName } from "@/lib/students";

async function main() {
  const unlinked = await db
    .select({ id: studentSubmissions.id, name: studentSubmissions.studentId, schoolId: exams.schoolId })
    .from(studentSubmissions)
    .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
    .where(isNull(studentSubmissions.studentRef));

  let linked = 0;
  for (const s of unlinked) {
    const resolved = await resolveStudentByName(s.schoolId, s.name);
    if (!resolved.ok) {
      console.warn(`Skipped "${s.name}": ${resolved.error}`);
      continue;
    }
    await db
      .update(studentSubmissions)
      .set({ studentRef: resolved.studentId })
      .where(eq(studentSubmissions.id, s.id));
    linked += 1;
    console.log(`Linked "${s.name}"${resolved.created ? " (new roster student)" : ""}`);
  }

  const results = await db.query.gradingResults.findMany({ with: { question: true } });
  let withEvidence = 0;
  for (const r of results) {
    if (!r.evaluation.rubricAssessment) continue;
    await recordAbilityEvidence(r.id, r.question, r.evaluation.rubricAssessment);
    withEvidence += 1;
  }

  console.log(
    `Linked ${linked}/${unlinked.length} submissions; evidence for ${withEvidence}/${results.length} answers ` +
      `(the rest were graded before moments).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
