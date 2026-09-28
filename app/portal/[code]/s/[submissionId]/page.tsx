import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { PortalReport } from "@/components/portal-report";
import { db } from "@/db";
import { students, studentSubmissions } from "@/db/schema";
import { resolveShareCode } from "@/lib/portal/share-codes";
import { getStudentReport } from "@/lib/queries";
import { auditInBackground } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provrapport — DeepGrader" };

/**
 * One report under a PER-STUDENT share code. The code must resolve to a
 * student AND the submission must belong to that student — a code never
 * opens another student's work.
 */
export default async function PortalStudentReportPage({
  params,
}: {
  params: { code: string; submissionId: string };
}) {
  const target = await resolveShareCode(params.code);
  if (!target || target.kind !== "student") notFound();

  const submission = await db.query.studentSubmissions.findFirst({
    where: and(
      eq(studentSubmissions.id, params.submissionId),
      eq(studentSubmissions.studentRef, target.studentId),
    ),
    columns: { id: true, examId: true },
  });
  if (!submission) notFound();

  const report = await getStudentReport(submission.examId, submission.id, null);
  if (!report) notFound();

  const student = await db.query.students.findFirst({
    where: eq(students.id, target.studentId),
    columns: { schoolId: true },
  });
  if (student) {
    auditInBackground({
      schoolId: student.schoolId,
      actorId: null,
      action: "portal.view",
      entityType: "submission",
      entityId: submission.id,
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href={`/portal/${encodeURIComponent(params.code)}`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Alla prov
      </Link>
      <PortalReport report={report} />
    </div>
  );
}
