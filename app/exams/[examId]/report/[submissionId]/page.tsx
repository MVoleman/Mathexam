import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PrintButton } from "@/components/print-button";
import { ShareReportButton } from "@/components/share-report-button";
import { getStudentReport } from "@/lib/queries";
import { requireTeacher } from "@/lib/auth";
import { getAbilityLabels } from "@/lib/curriculum/packs";
import { auditInBackground } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default async function StudentReportPage({
  params,
}: {
  params: { examId: string; submissionId: string };
}) {
  const teacher = await requireTeacher();
  const report = await getStudentReport(
    params.examId,
    params.submissionId,
    teacher.schoolId,
  );
  if (!report) notFound();

  const { submission, totalPoints, maxPoints, grade, abilities } = report;
  const abilityLabels = getAbilityLabels(submission.exam.curriculum);

  auditInBackground({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "report.view",
    entityType: "submission",
    entityId: submission.id,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/exams/${submission.examId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Tillbaka till provet
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <ShareReportButton submissionId={params.submissionId} />
          <Button asChild variant="outline" size="sm" className="print:hidden">
            <a
              href={`/exams/${params.examId}/report/${params.submissionId}/pdf`}
              download
            >
              Ladda ner PDF
            </a>
          </Button>
          <PrintButton />
        </div>
      </div>

      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Resultatrapport</h1>
        <p className="text-muted-foreground">
          {submission.exam.title} · {submission.exam.course}
        </p>
        <p className="text-lg font-medium">{submission.studentId}</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-around gap-6 py-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Totalpoäng</p>
            <p className="text-3xl font-semibold">
              {totalPoints}
              <span className="text-lg font-normal text-muted-foreground">/{maxPoints}</span>
            </p>
          </div>
          {grade && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Preliminärt betyg</p>
              <p className="text-3xl font-semibold">{grade}</p>
              {!submission.exam.showGradeToStudents && (
                <p className="text-xs text-muted-foreground">Visas inte för eleven</p>
              )}
            </div>
          )}
          <div className="min-w-52 flex-1 space-y-2">
            {abilities.map((a) => (
              <div key={a.ability} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{abilityLabels[a.ability] ?? a.ability}</span>
                  <span className="text-muted-foreground">{a.rate}%</span>
                </div>
                <Progress value={a.rate} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Återkoppling per uppgift</h2>
        {submission.results.map((result) => (
          <Card key={result.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Uppgift {result.question.number}</CardTitle>
                <Badge variant="outline">
                  {result.awardedPoints}/{result.question.maxPoints}p
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{result.question.questionText}</p>
              <p>{result.evaluation.formativeFeedback}</p>
              {result.teacherComment && (
                <p className="rounded-md bg-muted/50 p-2">
                  <span className="font-medium">Lärarens kommentar:</span>{" "}
                  {result.teacherComment}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="pb-8 text-center text-xs text-muted-foreground">
        Rapporten är AI-genererad och granskad av lärare. Bedömning enligt Lgr22.
      </p>
    </div>
  );
}
