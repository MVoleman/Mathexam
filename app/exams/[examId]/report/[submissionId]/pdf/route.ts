import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { getStudentReport } from "@/lib/queries";
import { renderStudentReportPdf } from "@/lib/pdf/report-document";
import { auditInBackground } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-rendered PDF of the student report (teacher-authenticated). */
export async function GET(
  _request: Request,
  { params }: { params: { examId: string; submissionId: string } },
) {
  const teacher = await requireTeacher();
  // The PDF is handed to the student, so it follows the exam's grade setting.
  const report = await getStudentReport(
    params.examId,
    params.submissionId,
    teacher.schoolId,
    { forStudent: true },
  );
  if (!report) return new NextResponse("Not found", { status: 404 });

  auditInBackground({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "report.export_pdf",
    entityType: "submission",
    entityId: report.submission.id,
  });

  const pdf = await renderStudentReportPdf(report);
  const filename = `rapport-${report.submission.studentId}.pdf`.replace(
    /[^a-zA-Z0-9._åäöÅÄÖ-]/g,
    "_",
  );

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
