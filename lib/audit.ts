import "server-only";

import { db } from "@/db";
import { auditLogs, type NewAuditLog } from "@/db/schema";

/**
 * Audit trail of teacher access to student data (GDPR/TOM evidence).
 *
 * Rules:
 * - NEVER let audit failures break the user's action — log and move on.
 * - metadata holds small, identifier-free context only (counts, titles);
 *   no answer content, no student names beyond what the entity id implies.
 *
 * Wired into: submission review views, report views/PDF exports, share-code
 * lifecycle, GDPR export/erasure, grading starts, review decisions, roster
 * syncs and golden-set captures.
 */
export async function audit(entry: NewAuditLog): Promise<void> {
  try {
    await db.insert(auditLogs).values(entry);
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}

/** Fire-and-forget variant for read paths (pages) — never awaited. */
export function auditInBackground(entry: NewAuditLog): void {
  void audit(entry);
}
