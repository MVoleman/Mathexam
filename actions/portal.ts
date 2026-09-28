"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shareCodes, students } from "@/db/schema";
import { assertSubmissionInSchool, requireTeacher, TenancyError } from "@/lib/auth";
import { generateShareCode, hashShareCode } from "@/lib/portal/share-codes";
import { audit } from "@/lib/audit";

const DEFAULT_EXPIRY_DAYS = 60;

export type CreateShareCodeResult =
  | { success: true; code: string; url: string; expiresAt: string }
  | { success: false; error: string };

/**
 * Creates a portal share code for one submission's formative report.
 * The raw code is returned ONCE — only its hash is stored.
 */
export async function createShareCode(
  submissionId: string,
): Promise<CreateShareCodeResult> {
  const parsed = z.string().uuid().safeParse(submissionId);
  if (!parsed.success) return { success: false, error: "Ogiltigt inlämnings-id." };

  const teacher = await requireTeacher();
  try {
    await assertSubmissionInSchool(parsed.data, teacher.schoolId);
  } catch (err) {
    if (err instanceof TenancyError) {
      return { success: false, error: "Inlämningen hittades inte." };
    }
    throw err;
  }

  const code = generateShareCode();
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(shareCodes).values({
    submissionId: parsed.data,
    codeHash: hashShareCode(code),
    createdBy: teacher.id,
    expiresAt,
  });

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "share_code.create",
    entityType: "submission",
    entityId: parsed.data,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return {
    success: true,
    code,
    url: `${base}/portal/${code}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Creates a portal code tied to a ROSTER STUDENT — opens all of that
 * student's reports (current and future). Raw code returned once.
 */
export async function createStudentShareCode(
  studentId: string,
): Promise<CreateShareCodeResult> {
  const parsed = z.string().uuid().safeParse(studentId);
  if (!parsed.success) return { success: false, error: "Ogiltigt elev-id." };

  const teacher = await requireTeacher();
  const student = await db.query.students.findFirst({
    where: and(eq(students.id, parsed.data), eq(students.schoolId, teacher.schoolId)),
    columns: { id: true },
  });
  if (!student) return { success: false, error: "Eleven hittades inte." };

  const code = generateShareCode();
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(shareCodes).values({
    studentId: student.id,
    codeHash: hashShareCode(code),
    createdBy: teacher.id,
    expiresAt,
  });

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "share_code.create",
    entityType: "student",
    entityId: student.id,
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return {
    success: true,
    code,
    url: `${base}/portal/${code}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Revokes every active share code for a roster student. */
export async function revokeStudentShareCodes(
  studentId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = z.string().uuid().safeParse(studentId);
  if (!parsed.success) return { success: false, error: "Ogiltigt elev-id." };

  const teacher = await requireTeacher();
  const student = await db.query.students.findFirst({
    where: and(eq(students.id, parsed.data), eq(students.schoolId, teacher.schoolId)),
    columns: { id: true },
  });
  if (!student) return { success: false, error: "Eleven hittades inte." };

  await db
    .update(shareCodes)
    .set({ revokedAt: new Date() })
    .where(eq(shareCodes.studentId, student.id));

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "share_code.revoke",
    entityType: "student",
    entityId: student.id,
  });

  return { success: true };
}

/** Revokes every active share code for a submission. */
export async function revokeShareCodes(
  submissionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = z.string().uuid().safeParse(submissionId);
  if (!parsed.success) return { success: false, error: "Ogiltigt inlämnings-id." };

  const teacher = await requireTeacher();
  try {
    await assertSubmissionInSchool(parsed.data, teacher.schoolId);
  } catch (err) {
    if (err instanceof TenancyError) {
      return { success: false, error: "Inlämningen hittades inte." };
    }
    throw err;
  }

  await db
    .update(shareCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareCodes.submissionId, parsed.data)));

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "share_code.revoke",
    entityType: "submission",
    entityId: parsed.data,
  });

  return { success: true };
}
