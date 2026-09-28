import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, profiles } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Admin-only CSV export of the school's full audit trail — the artifact a
 * huvudman asks for in a compliance review (docs/GDPR.md).
 */
export async function GET() {
  const teacher = await requireTeacher();
  if (teacher.role !== "admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const rows = await db
    .select({ log: auditLogs, actorName: profiles.fullName })
    .from(auditLogs)
    .leftJoin(profiles, eq(profiles.id, auditLogs.actorId))
    .where(eq(auditLogs.schoolId, teacher.schoolId))
    .orderBy(desc(auditLogs.createdAt));

  const header = "timestamp,actor,action,entity_type,entity_id,metadata";
  const lines = rows.map(({ log, actorName }) =>
    [
      csvField(log.createdAt.toISOString()),
      csvField(actorName ?? "System/Portal"),
      csvField(log.action),
      csvField(log.entityType),
      csvField(log.entityId),
      csvField(log.metadata ? JSON.stringify(log.metadata) : ""),
    ].join(","),
  );
  // BOM so Excel opens UTF-8 (Swedish characters) correctly.
  const csv = "﻿" + [header, ...lines].join("\r\n") + "\r\n";

  await audit({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "audit.export",
    entityType: "school",
    entityId: teacher.schoolId,
    metadata: { rows: rows.length },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="atkomstlogg-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
