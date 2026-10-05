import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { students } from "@/db/schema";

export type ResolveStudentResult =
  | { ok: true; studentId: string; created: boolean }
  | { ok: false; error: string };

/**
 * The roster student a submission belongs to, so progression can follow the
 * student across exams. Matches the school's roster by name (case- and
 * whitespace-insensitive) and creates a manual roster entry when there is no
 * match. Two roster students with the same name must be chosen explicitly.
 */
export async function resolveStudentByName(
  schoolId: string,
  name: string,
): Promise<ResolveStudentResult> {
  const normalized = name.trim().replace(/\s+/g, " ");
  const matches = await db
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.schoolId, schoolId),
        sql`lower(regexp_replace(trim(${students.fullName}), '\\s+', ' ', 'g')) = lower(${normalized})`,
      ),
    )
    .limit(2);

  if (matches.length > 1) {
    return {
      ok: false,
      error: `Flera elever i elevlistan heter "${normalized}". Välj rätt elev i listan.`,
    };
  }
  if (matches.length === 1) return { ok: true, studentId: matches[0].id, created: false };

  const [created] = await db
    .insert(students)
    .values({ schoolId, fullName: normalized, source: "manual" })
    .returning({ id: students.id });
  return { ok: true, studentId: created.id, created: true };
}
