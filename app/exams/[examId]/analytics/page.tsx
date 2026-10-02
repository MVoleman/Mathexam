import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getExamAnalytics } from "@/lib/queries";
import { requireTeacher } from "@/lib/auth";
import { getAbilityLabels } from "@/lib/curriculum/packs";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  params,
}: {
  params: { examId: string };
}) {
  const teacher = await requireTeacher();
  const analytics = await getExamAnalytics(params.examId, teacher.schoolId);
  if (!analytics) notFound();

  const { exam, topicStats, abilityStats, pitfalls, studentTotals, gradeDistribution } =
    analytics;
  const abilityLabels = getAbilityLabels(exam.curriculum);
  const maxBucket = Math.max(1, ...gradeDistribution.map((b) => b.students));

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/exams/${exam.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Klassanalys</h1>
          <p className="text-sm text-muted-foreground">{exam.title}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Betygsfördelning</CardTitle>
          </CardHeader>
          <CardContent>
            {!exam.gradingLimits ? (
              <p className="text-sm text-muted-foreground">
                Ange betygsgränser på provet för att se fördelningen.
              </p>
            ) : (
              <div className="flex h-40 items-end gap-4">
                {gradeDistribution.map((bucket) => (
                  <div key={bucket.grade} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-sm font-medium">{bucket.students}</span>
                    <div
                      className={`w-full rounded-t-md ${
                        bucket.grade === "F" ? "bg-destructive/60" : "bg-primary/70"
                      }`}
                      style={{ height: `${(bucket.students / maxBucket) * 100}%`, minHeight: 4 }}
                    />
                    <span className="text-sm text-muted-foreground">{bucket.grade}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Förmågor (Lgr22) — andel av poängen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {abilityStats.length === 0 && (
              <p className="text-sm text-muted-foreground">Inga rättade svar ännu.</p>
            )}
            {abilityStats.map((a) => (
              <div key={a.ability} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{abilityLabels[a.ability] ?? a.ability}</span>
                  <span className="text-muted-foreground">{a.pointsRate}%</span>
                </div>
                <Progress value={a.pointsRate} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultat per område</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topicStats.length === 0 && (
              <p className="text-sm text-muted-foreground">Inga rättade svar ännu.</p>
            )}
            {topicStats.map((t) => (
              <div key={`${t.topic}-${t.difficulty}`} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>
                    {t.topic} <Badge variant="outline">{t.difficulty}</Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {t.avgPct}% · {t.answers} svar
                  </span>
                </div>
                <Progress value={t.avgPct} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vanligaste fallgroparna</CardTitle>
          </CardHeader>
          <CardContent>
            {pitfalls.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Inga återkommande fallgropar identifierade.
              </p>
            ) : (
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {pitfalls.map((p) => (
                  <li key={p.pitfall}>
                    {p.pitfall}{" "}
                    <span className="text-muted-foreground">({p.occurrences} elever)</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Poäng per elev</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {studentTotals.map((s) => (
            <div key={s.submissionId} className="flex items-center justify-between border-b pb-2 text-sm last:border-0">
              <span>{s.studentId}</span>
              <div className="flex items-center gap-3">
                <span className="font-medium">{s.total}p</span>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/exams/${exam.id}/report/${s.submissionId}`}>Rapport</Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
