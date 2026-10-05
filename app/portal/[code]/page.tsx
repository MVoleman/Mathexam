import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { BarChart3, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalReport } from "@/components/portal-report";
import { db } from "@/db";
import { students, studentSubmissions } from "@/db/schema";
import { resolveShareCode } from "@/lib/portal/share-codes";
import { getStudentReport } from "@/lib/queries";
import { auditInBackground } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Provrapport — DeepGrader" };

/**
 * Public student/guardian portal. The share code IS the credential:
 * resolved server-side against a salted hash, with expiry and revocation.
 *
 * Submission codes render one formative report; student codes render an
 * overview of all the roster student's graded submissions.
 */
export default async function PortalPage({ params }: { params: { code: string } }) {
  const target = await resolveShareCode(params.code);
  if (!target) notFound();

  // --- Single-report code (original behavior) -----------------------------
  if (target.kind === "submission") {
    const submission = await db.query.studentSubmissions.findFirst({
      where: eq(studentSubmissions.id, target.submissionId),
      columns: { id: true, examId: true },
      with: { exam: { columns: { schoolId: true } } },
    });
    if (!submission) notFound();

    const report = await getStudentReport(submission.examId, submission.id, null, { forStudent: true });
    if (!report) notFound();

    auditInBackground({
      schoolId: submission.exam.schoolId,
      actorId: null,
      action: "portal.view",
      entityType: "submission",
      entityId: submission.id,
    });

    return (
      <div className="mx-auto max-w-3xl">
        <PortalReport report={report} />
      </div>
    );
  }

  // --- Per-student code: overview of all graded submissions ---------------
  const student = await db.query.students.findFirst({
    where: eq(students.id, target.studentId),
  });
  if (!student) notFound();

  const submissions = await db.query.studentSubmissions.findMany({
    where: eq(studentSubmissions.studentRef, student.id),
    with: { exam: true },
    orderBy: desc(studentSubmissions.createdAt),
  });

  auditInBackground({
    schoolId: student.schoolId,
    actorId: null,
    action: "portal.view",
    entityType: "student",
    entityId: student.id,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-2 border-b pb-4">
        <BarChart3 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Provrapporter — {student.fullName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {student.className ?? ""} Formativa rapporter för genomförda prov.
          </p>
        </div>
      </header>

      {submissions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Inga provresultat ännu.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prov</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {submissions.map((submission) => (
              <Link
                key={submission.id}
                href={`/portal/${encodeURIComponent(params.code)}/s/${submission.id}`}
                className="flex items-center justify-between py-3 text-sm hover:bg-muted/40"
              >
                <span>
                  <span className="font-medium">{submission.exam.title}</span>{" "}
                  <span className="text-muted-foreground">
                    · {submission.exam.course}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">
                    {submission.createdAt.toLocaleDateString("sv-SE")}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <footer className="border-t pt-4 text-center text-xs text-muted-foreground">
        Rapporterna är granskade av läraren. Frågor? Kontakta skolan.
      </footer>
    </div>
  );
}
