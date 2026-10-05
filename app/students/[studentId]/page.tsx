import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireTeacher } from "@/lib/auth";
import { auditInBackground } from "@/lib/audit";
import { getStudentProgression, type ExamPoint } from "@/lib/progression";
import { LEVELS } from "@/lib/rubric";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" });

/** Square per exam: green when every point at the level was earned, amber partly, red none. */
function ExamChip({ exam }: { exam: ExamPoint }) {
  const share = exam.available === 0 ? 0 : exam.earned / exam.available;
  const tone =
    share >= 1
      ? "bg-emerald-500"
      : share > 0
        ? "bg-amber-400"
        : "bg-destructive/70";
  return (
    <span
      className={`inline-block h-4 w-4 rounded-sm ${tone}`}
      title={`${exam.title} (${dateFmt.format(exam.date)}): ${exam.earned}/${exam.available}p`}
    />
  );
}

export default async function StudentProgressionPage({
  params,
}: {
  params: { studentId: string };
}) {
  const teacher = await requireTeacher();
  const data = await getStudentProgression(params.studentId, teacher.schoolId);
  if (!data) notFound();

  auditInBackground({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "student.progression_view",
    entityType: "student",
    entityId: data.student.id,
  });

  const { student, abilities, examCount } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/students">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{student.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {student.className ? `${student.className} · ` : ""}
            Förmågeprogression från {examCount} prov
          </p>
        </div>
      </div>

      {abilities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Inga momentbedömda svar ännu. Progressionen fylls på när elevens inlämningar rättas.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Förmågor per nivå</CardTitle>
              <p className="text-sm text-muted-foreground">
                En ruta per prov, äldst till vänster:{" "}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500" /> alla poäng
                </span>
                ,{" "}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-amber-400" /> delvis
                </span>
                ,{" "}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-destructive/70" /> inga
                </span>
                . Siffran är poäng uppnådda av möjliga på nivån, över alla prov.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Förmåga</th>
                    {LEVELS.map((l) => (
                      <th key={l} className="py-2 pr-4 font-medium">
                        {l}-nivå
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {abilities.map((a) => (
                    <tr key={a.ability} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{a.label}</td>
                      {LEVELS.map((l) => {
                        const level = a.levels[l];
                        return (
                          <td key={l} className="py-3 pr-4 align-top">
                            {level.available === 0 ? (
                              <span className="text-muted-foreground">Ej prövad</span>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex flex-wrap gap-1">
                                  {level.exams.map((e) => (
                                    <ExamChip key={e.submissionId} exam={e} />
                                  ))}
                                </div>
                                <span className="text-xs text-muted-foreground">
                                  {level.earned}/{level.available}p
                                </span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Belägg</CardTitle>
              <p className="text-sm text-muted-foreground">
                Varje moment eleven bedömts mot, med citat ur lösningen.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {abilities.map((a) => (
                <details key={a.ability} className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium">
                    {a.label}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({a.evidence.filter((e) => e.met).length} av {a.evidence.length} moment
                      uppfyllda)
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {a.evidence.map((e, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className={e.met ? "text-emerald-600" : "text-destructive"}>
                          {e.met ? "✓" : "✗"}
                        </span>
                        <span className="w-5 shrink-0 font-semibold">{e.level}</span>
                        <span className="min-w-0">
                          {e.description}{" "}
                          <Link
                            href={`/review/${e.submissionId}`}
                            className="text-muted-foreground underline-offset-2 hover:underline"
                          >
                            ({e.examTitle}, uppgift {e.questionNumber})
                          </Link>
                          {e.evidence && (
                            <span className="block text-xs text-muted-foreground">
                              {e.evidence}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
