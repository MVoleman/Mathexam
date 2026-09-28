import { BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getAbilityLabels } from "@/lib/curriculum/packs";
import type { getStudentReport } from "@/lib/queries";

type Report = NonNullable<Awaited<ReturnType<typeof getStudentReport>>>;

/**
 * Formative report body shared by the portal pages (single-report codes and
 * per-student codes). Shows feedback + abilities only — no AI internals.
 */
export function PortalReport({ report }: { report: Report }) {
  const { submission: sub, totalPoints, maxPoints, grade, abilities } = report;
  const abilityLabels = getAbilityLabels(sub.exam.curriculum);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2 border-b pb-4">
        <BarChart3 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{sub.exam.title}</h1>
          <p className="text-sm text-muted-foreground">
            {sub.exam.course} · {sub.exam.gradeLevel} · Formativ rapport
          </p>
        </div>
      </header>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Resultat</CardTitle>
          <div className="flex items-center gap-2">
            {grade && <Badge className="text-base">{grade}</Badge>}
            <Badge variant="outline" className="text-base">
              {totalPoints}/{maxPoints}p
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {abilities.map((a) => (
            <div key={a.ability} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{abilityLabels[a.ability] ?? a.ability}</span>
                <span className="text-muted-foreground">{a.rate}%</span>
              </div>
              <Progress value={a.rate} />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {sub.results.map((result) => (
          <Card key={result.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Uppgift {result.question.number}</CardTitle>
              <Badge variant="outline">
                {result.awardedPoints}/{result.question.maxPoints}p
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {result.question.questionText}
              </p>
              <p className="rounded-md border-l-2 border-primary/40 bg-muted/30 p-3 text-sm">
                {result.evaluation.formativeFeedback}
              </p>
              {result.teacherComment && (
                <p className="text-sm">
                  <span className="font-medium">Lärarens kommentar: </span>
                  {result.teacherComment}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <footer className="border-t pt-4 text-center text-xs text-muted-foreground">
        Rapporten är granskad av läraren. Frågor? Kontakta skolan.
      </footer>
    </div>
  );
}
