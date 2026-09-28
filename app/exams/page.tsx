import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getExamsList } from "@/lib/queries";
import { requireTeacher } from "@/lib/auth";
import type { Exam } from "@/db/schema";

export const dynamic = "force-dynamic";

const statusLabels: Record<Exam["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Utkast", variant: "outline" },
  processing: { label: "Bearbetas", variant: "secondary" },
  ready: { label: "Redo", variant: "secondary" },
  grading: { label: "Rättas", variant: "default" },
  graded: { label: "Rättad", variant: "default" },
  archived: { label: "Arkiverad", variant: "outline" },
};

export default async function ExamsPage() {
  const teacher = await requireTeacher();
  const rows = await getExamsList(teacher.schoolId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Prov</h1>
        <Button asChild>
          <Link href="/exams/new">Nytt prov</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Inga prov ännu. Ladda upp ditt första prov för att komma igång.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ exam, submissionCount, questionCount }) => {
            const status = statusLabels[exam.status];
            return (
              <Link key={exam.id} href={`/exams/${exam.id}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-medium leading-tight">{exam.title}</h2>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {exam.course} · {exam.gradeLevel}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {questionCount} frågor · {submissionCount} inlämningar
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
