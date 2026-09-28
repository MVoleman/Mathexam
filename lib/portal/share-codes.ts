import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { shareCodes } from "@/db/schema";

/**
 * Portal share codes: a teacher generates a code for one submission's
 * formative report; the student/guardian views it at /portal/<code>.
 *
 * The code is the credential, so it is treated like a password: only a
 * salted SHA-256 hash is stored, codes expire, and they can be revoked.
 */

// Crockford-ish alphabet without ambiguous characters (0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 10;

export function generateShareCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  // Grouped for readability: XXXX-XXX-XXX
  return `${code.slice(0, 4)}-${code.slice(4, 7)}-${code.slice(7)}`;
}

export function hashShareCode(rawCode: string): string {
  const pepper = process.env.SHARE_CODE_PEPPER;
  if (!pepper) throw new Error("SHARE_CODE_PEPPER is not set.");
  const normalized = rawCode.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return createHash("sha256").update(`${normalized}:${pepper}`).digest("hex");
}

export type ShareCodeTarget =
  | { kind: "submission"; submissionId: string }
  | { kind: "student"; studentId: string };

/**
 * Resolves a raw code to its target, or null if invalid/expired/revoked.
 * Submission codes open one report; student codes open all of a roster
 * student's reports.
 */
export async function resolveShareCode(
  rawCode: string,
): Promise<ShareCodeTarget | null> {
  let codeHash: string;
  try {
    codeHash = hashShareCode(rawCode);
  } catch {
    return null;
  }

  const row = await db.query.shareCodes.findFirst({
    where: and(
      eq(shareCodes.codeHash, codeHash),
      isNull(shareCodes.revokedAt),
      gt(shareCodes.expiresAt, new Date()),
    ),
    columns: { submissionId: true, studentId: true },
  });

  if (!row) return null;
  if (row.submissionId) return { kind: "submission", submissionId: row.submissionId };
  if (row.studentId) return { kind: "student", studentId: row.studentId };
  return null;
}
