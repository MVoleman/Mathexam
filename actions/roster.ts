"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { students } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";
import { audit } from "@/lib/audit";
import * as googleClassroom from "@/lib/integrations/google-classroom";
import * as microsoftTeams from "@/lib/integrations/microsoft-teams";
import * as ss12000 from "@/lib/integrations/ss12000";
import type { SyncResult } from "@/lib/integrations/types";

export type RosterActionResult =
  | { success: true; sync?: SyncResult }
  | { success: false; error: string };

// ---------------------------------------------------------------------------
// Google Classroom
// ---------------------------------------------------------------------------

export async function syncGoogleClassroomRoster(): Promise<RosterActionResult> {
  const teacher = await requireTeacher();
  try {
    const sync = await googleClassroom.syncRoster(teacher.id, teacher.schoolId);
    await audit({
      schoolId: teacher.schoolId,
      actorId: teacher.id,
      action: "roster.sync",
      entityType: "roster",
      metadata: { provider: "google_classroom", ...sync },
    });
    revalidatePath("/students");
    return { success: true, sync };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Synkroniseringen misslyckades.",
    };
  }
}

export async function disconnectGoogleClassroom(): Promise<RosterActionResult> {
  const teacher = await requireTeacher();
  await googleClassroom.disconnect(teacher.id);
  revalidatePath("/students");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Microsoft Teams
// ---------------------------------------------------------------------------

export async function syncMicrosoftTeamsRoster(): Promise<RosterActionResult> {
  const teacher = await requireTeacher();
  try {
    const sync = await microsoftTeams.syncRoster(teacher.id, teacher.schoolId);
    await audit({
      schoolId: teacher.schoolId,
      actorId: teacher.id,
      action: "roster.sync",
      entityType: "roster",
      metadata: { provider: "microsoft_teams", ...sync },
    });
    revalidatePath("/students");
    return { success: true, sync };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Synkroniseringen misslyckades.",
    };
  }
}

export async function disconnectMicrosoftTeams(): Promise<RosterActionResult> {
  const teacher = await requireTeacher();
  await microsoftTeams.disconnect(teacher.id);
  revalidatePath("/students");
  return { success: true };
}

// ---------------------------------------------------------------------------
// SS 12000 (Skolon / Skolfederation provisioning — env-configured hub)
// ---------------------------------------------------------------------------

export async function syncSS12000Roster(): Promise<RosterActionResult> {
  const teacher = await requireTeacher();
  try {
    const sync = await ss12000.syncRoster(teacher.schoolId);
    await audit({
      schoolId: teacher.schoolId,
      actorId: teacher.id,
      action: "roster.sync",
      entityType: "roster",
      metadata: { provider: "skolfederation", ...sync },
    });
    revalidatePath("/students");
    return { success: true, sync };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Synkroniseringen misslyckades.",
    };
  }
}

// ---------------------------------------------------------------------------
// Manual roster entries
// ---------------------------------------------------------------------------

const ManualStudentSchema = z.object({
  fullName: z.string().trim().min(1, "Namn krävs.").max(200),
  className: z.string().trim().max(100).optional(),
});

export async function addManualStudent(formData: FormData): Promise<RosterActionResult> {
  const teacher = await requireTeacher();
  const parsed = ManualStudentSchema.safeParse({
    fullName: formData.get("fullName"),
    className: formData.get("className") || undefined,
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  await db.insert(students).values({
    schoolId: teacher.schoolId,
    source: "manual",
    fullName: parsed.data.fullName,
    className: parsed.data.className ?? null,
  });

  revalidatePath("/students");
  return { success: true };
}

export async function deleteStudent(studentId: string): Promise<RosterActionResult> {
  const parsed = z.string().uuid().safeParse(studentId);
  if (!parsed.success) return { success: false, error: "Ogiltigt elev-id." };

  const teacher = await requireTeacher();
  const [deleted] = await db
    .delete(students)
    .where(and(eq(students.id, parsed.data), eq(students.schoolId, teacher.schoolId)))
    .returning({ id: students.id });
  if (!deleted) return { success: false, error: "Eleven hittades inte." };

  revalidatePath("/students");
  return { success: true };
}
