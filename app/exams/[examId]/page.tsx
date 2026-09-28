import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, BarChart3, FileText, ListPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BatchGradingPanel } from "@/components/batch-grading-panel";
import { getExamDetail } from "@/lib/queries";
import { requireTeacher } from "@/lib/auth";
import { EXAMS_BUCKET, resolveStorageUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function ExamDetailPage({
  params,
}: {
  params: { examId: string };
}) {
  const teacher = await requireTeacher();
  const detail = await getExamDetail(params.examId, teacher.schoolId);
  if (!detail) notFound();

  const { exam, questions, submissions, latestJob } = detail;
  const maxTotal = questions.reduce((s, q) => s + q.maxPoints, 0);
  const pdfUrl = exam.pdfUrl
    ? await resolveStorageUrl(EXAMS_BUCKET, exam.pdfUrl)
    : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{exam.title}</h1>
          <p className="text-sm text-muted-foreground">
            {exam.course} · {exam.gradeLevel} · {questions.length} frågor · max {maxTotal}p
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/exams/${exam.id}/questions`}>
              <ListPlus className="mr-2 h-4 w-4" />
              Hantera frågor
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/exams/${exam.id}/analytics`}>
              <BarChart3 className="mr-2 h-4 w-4" />
              Klassanalys
            </Link>
          </Button>
          {pdfUrl && (
            <Button asChild variant="outline">
              <a href={pdfUrl} target="_blank" rel="noreferrer">
                <FileText className="mr-2 h-4 w-4" />
                Original-PDF
              </a>
            </Button>
          )}
        </div>
      </div>

      <BatchGradingPanel
        examId={exam.id}
        initialJob={latestJob}
        submissionCount={submissions.length}
        questionCount={questions.length}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Frågor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {questions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Inga frågor registrerade ännu.
              </p>
            )}
            {questions.map((q) => (
              <div key={q.id} className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {q.number}. <span className="font-normal">{q.questionText}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {q.topic} · {q.lgr22Abilities.join(", ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Badge variant="outline">{q.difficulty}</Badge>
                  <Badge variant="secondary">{q.maxPoints}p</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Inlämningar</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link href={`/exams/${exam.id}/submissions/new`}>Ny inlämning</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {submissions.length === 0 && (
              <p className="text-sm text-muted-foreground">Inga inlämningar ännu.</p>
            )}
            {submissions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium">{s.studentId}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.imageCount} sidor · {s.gradedCount}/{questions.length} rättade ·{" "}
                    {s.totalPoints}p
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {s.needsReviewCount > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {s.needsReviewCount}
                    </Badge>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/review/${s.id}`}>Granska</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/exams/${exam.id}/report/${s.id}`}>Rapport</Link>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
