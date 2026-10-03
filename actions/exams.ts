"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { exams } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";

const points = z.coerce.number().int().min(0).max(1000);

const GradingLimitsSchema = z
  .object({
    E: points,
    C: points,
    A: points,
    cLevelMin: points.optional(),
    aLevelMin: points.optional(),
  })
  .refine((l) => l.E <= l.C && l.C <= l.A, "Gränserna måste stiga: E ≤ C ≤ A.");

/** Sets (or with null, clears) the exam's grade limits and level requirements. */
export async function setGradingLimits(
  examId: string,
  rawLimits: z.input<typeof GradingLimitsSchema> | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const id = z.string().uuid().safeParse(examId);
  if (!id.success) return { success: false, error: "Ogiltigt prov-id." };

  let limits = null;
  if (rawLimits) {
    const parsed = GradingLimitsSchema.safeParse(rawLimits);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
    limits = parsed.data;
  }

  const teacher = await requireTeacher();
  const updated = await db
    .update(exams)
    .set({ gradingLimits: limits })
    .where(and(eq(exams.id, id.data), eq(exams.schoolId, teacher.schoolId)))
    .returning({ id: exams.id });
  if (updated.length === 0) return { success: false, error: "Provet hittades inte." };

  revalidatePath(`/exams/${examId}`);
  revalidatePath(`/exams/${examId}/analytics`);
  return { success: true };
}
