"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { goldenSets } from "@/db/schema";
import { assertResultInSchool, requireTeacher, TenancyError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { captureGoldenItem, runEvalSet } from "@/lib/evals/runner";
import { inngest } from "@/lib/queue/inngest";

export type EvalActionResult = { success: true } | { success: false; error: string };

// ---------------------------------------------------------------------------
// Golden sets
// ---------------------------------------------------------------------------

const CreateSetSchema = z.object({
  name: z.string().trim().min(1, "Namn krävs.").max(200),
  description: z.string().trim().max(2000).optional(),
});

export async function createGoldenSet(formData: FormData): Promise<EvalActionResult> {
  const teacher = await requireTeacher();
  const parsed = CreateSetSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  await db.insert(goldenSets).values({
    schoolId: teacher.schoolId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
  });

  revalidatePath("/evals");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Capture a reviewed answer into a golden set (from the review panel)
// ---------------------------------------------------------------------------

const CaptureSchema = z.object({
  resultId: z.string().uuid(),
  setId: z.string().uuid(),
  consentConfirmed: z.literal(true, {
    errorMap: () => ({ message: "Samtycke måste bekräftas." }),
  }),
});

export async function addResultToGoldenSet(rawInput: {
  resultId: string;
  setId: string;
  consentConfirmed: boolean;
}): Promise<EvalActionResult> {
  const parsed = CaptureSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const teacher = await requireTeacher();
  try {
    await assertResultInSchool(parsed.data.resultId, teacher.schoolId);
  } catch (err) {
    if (err instanceof TenancyError) {
      return { success: false, error: "Resultatet hittades inte." };
    }
    throw err;
  }

  // Set must belong to the school (or be global — those are read-only here).
  const set = await db.query.goldenSets.findFirst({
    where: (gs, { and, eq }) =>
      and(eq(gs.id, parsed.data.setId), eq(gs.schoolId, teacher.schoolId)),
  });
  if (!set) return { success: false, error: "Guldkorpusen hittades inte." };

  const result = await captureGoldenItem({
    resultId: parsed.data.resultId,
    setId: parsed.data.setId,
    consentConfirmed: parsed.data.consentConfirmed,
  });
  if (!result.ok) return { success: false, error: result.error };

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "golden.capture",
    entityType: "result",
    entityId: parsed.data.resultId,
  });

  revalidatePath("/evals");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Start an eval run (queued via Inngest; falls back to in-process locally)
// ---------------------------------------------------------------------------

export async function startEvalRun(
  setId: string,
  label?: string,
): Promise<EvalActionResult> {
  const idParsed = z.string().uuid().safeParse(setId);
  if (!idParsed.success) return { success: false, error: "Ogiltigt korpus-id." };

  const teacher = await requireTeacher();
  // Own-school sets AND global sets (school_id null) may be run.
  const set = await db.query.goldenSets.findFirst({
    where: (gs, { and, eq, isNull, or }) =>
      and(
        eq(gs.id, idParsed.data),
        or(eq(gs.schoolId, teacher.schoolId), isNull(gs.schoolId)),
      ),
  });
  if (!set) return { success: false, error: "Guldkorpusen hittades inte." };

  if (process.env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: "evals/run.requested",
      data: { setId: idParsed.data, label: label ?? null },
    });
  } else {
    // Local/long-running Node: run in-process, fire-and-forget.
    void runEvalSet(idParsed.data, label).catch((err) =>
      console.error("Eval run failed:", err),
    );
  }

  revalidatePath("/evals");
  return { success: true };
}
