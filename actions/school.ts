"use server";

import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { profiles, schools } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";
import { audit } from "@/lib/audit";

const SettingsSchema = z.object({
  name: z.string().trim().min(1, "Skolans namn krävs.").max(200),
  orgNumber: z
    .string()
    .trim()
    .regex(/^\d{6}-?\d{4}$/, "Ogiltigt organisationsnummer (XXXXXX-XXXX).")
    .optional()
    .or(z.literal("")),
  ssoDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Ogiltig domän (t.ex. edu.kommunen.se).")
    .optional()
    .or(z.literal("")),
});

/** Admin-only: school name, org number and SSO auto-join domain. */
export async function updateSchoolSettings(
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  const teacher = await requireTeacher();
  if (teacher.role !== "admin") {
    return { success: false, error: "Endast administratörer kan ändra skolinställningar." };
  }

  const parsed = SettingsSchema.safeParse({
    name: formData.get("name"),
    orgNumber: formData.get("orgNumber") ?? "",
    ssoDomain: formData.get("ssoDomain") ?? "",
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  try {
    await db
      .update(schools)
      .set({
        name: parsed.data.name,
        orgNumber: parsed.data.orgNumber || null,
        ssoDomain: parsed.data.ssoDomain || null,
      })
      .where(eq(schools.id, teacher.schoolId));
  } catch {
    // Unique index on sso_domain.
    return { success: false, error: "Domänen används redan av en annan skola." };
  }

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "school.update_settings",
    entityType: "school",
    entityId: teacher.schoolId,
  });

  revalidatePath("/settings");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Role management — admins promote/demote colleagues
// ---------------------------------------------------------------------------

const RoleSchema = z.object({
  profileId: z.string().uuid(),
  role: z.enum(["admin", "teacher"]),
});

export async function setTeacherRole(rawInput: {
  profileId: string;
  role: "admin" | "teacher";
}): Promise<{ success: true } | { success: false; error: string }> {
  const teacher = await requireTeacher();
  if (teacher.role !== "admin") {
    return { success: false, error: "Endast administratörer kan ändra roller." };
  }

  const parsed = RoleSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: "Ogiltig förfrågan." };

  const target = await db.query.profiles.findFirst({
    where: and(
      eq(profiles.id, parsed.data.profileId),
      eq(profiles.schoolId, teacher.schoolId),
    ),
  });
  if (!target) return { success: false, error: "Användaren hittades inte." };
  if (target.role === parsed.data.role) return { success: true };

  // Never leave the school without an admin.
  if (target.role === "admin" && parsed.data.role === "teacher") {
    const [admins] = await db
      .select({ value: count() })
      .from(profiles)
      .where(and(eq(profiles.schoolId, teacher.schoolId), eq(profiles.role, "admin")));
    if (admins.value <= 1) {
      return { success: false, error: "Skolan måste ha minst en administratör." };
    }
  }

  await db
    .update(profiles)
    .set({ role: parsed.data.role })
    .where(eq(profiles.id, target.id));

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "school.set_role",
    entityType: "profile",
    entityId: target.id,
    metadata: { role: parsed.data.role },
  });

  revalidatePath("/settings");
  return { success: true };
}
