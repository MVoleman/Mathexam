import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateGoldenSetForm, RunEvalButton } from "@/components/eval-panel";
import { requireTeacher } from "@/lib/auth";
import { getEvalOverview } from "@/lib/queries";
import type { EvalRun } from "@/db/schema";

export const dynamic = "force-dynamic";

const fmtPct = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}%`);
const fmtPts = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}p`);

function Delta({ curr, prev }: { curr: number | null; prev: number | null }) {
  if (curr === null || prev === null) return null;
  const d = curr - prev;
  if (Math.abs(d) < 0.05) return <span className="text-muted-foreground"> ±0</span>;
  return (
    <span className={d > 0 ? "text-green-600" : "text-destructive"}>
      {" "}
      {d > 0 ? "+" : ""}
      {d.toFixed(1)}
    </span>
  );
}

const runStatusLabel: Record<EvalRun["status"], string> = {
  queued: "Köad",
  running: "Kör…",
  completed: "Klar",
  failed: "Misslyckad",
};

export default async function EvalsPage() {
  const teacher = await requireTeacher();
  const { sets, runs } = await getEvalOverview(teacher.schoolId);

  const runsBySet = new Map<string, typeof runs>();
  for (const run of runs) {
    const list = runsBySet.get(run.setId) ?? [];
    list.push(run);
    runsBySet.set(run.setId, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Utvärderingar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guldkorpus av lärargranskade svar. Varje prompt- eller modelländring körs
          mot korpusen och rapporterar överensstämmelse med lärarens poäng — en
          försämring är en regression.
        </p>
      </div>

      <CreateGoldenSetForm />

      {sets.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Inga guldkorpusar ännu. Skapa en ovan och lägg sedan till granskade svar
            från granskningsvyn ("Spara som guldsvar").
          </CardContent>
        </Card>
      )}

      {sets.map(({ set, itemCount }) => {
        const setRuns = runsBySet.get(set.id) ?? [];
        return (
          <Card key={set.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">
                  {set.name}{" "}
                  {set.schoolId === null && <Badge variant="outline">Global</Badge>}
                  {set.frozen && <Badge variant="secondary">Fryst</Badge>}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {itemCount} guldsvar
                  {set.description ? ` · ${set.description}` : ""}
                </p>
              </div>
              <RunEvalButton setId={set.id} disabled={itemCount === 0} />
            </CardHeader>
            <CardContent>
              {setRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground">Inga körningar ännu.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Datum</th>
                        <th className="py-2 pr-4 font-medium">Modell</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                        <th className="py-2 pr-4 font-medium">Exakt träff</th>
                        <th className="py-2 pr-4 font-medium">Inom ±0,5p</th>
                        <th className="py-2 pr-4 font-medium">Medelfel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {setRuns.map((run, i) => {
                        const prev = setRuns[i + 1] ?? null;
                        return (
                          <tr key={run.id} className="border-b last:border-0">
                            <td className="py-2 pr-4">
                              {run.createdAt.toLocaleString("sv-SE", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs">
                              {run.config.gradingModel}
                              {run.config.label ? ` (${run.config.label})` : ""}
                            </td>
                            <td className="py-2 pr-4">
                              {runStatusLabel[run.status]}
                              {run.failedItems > 0 && (
                                <span className="text-destructive">
                                  {" "}
                                  ({run.failedItems} fel)
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-4">
                              {fmtPct(run.exactAgreementPct)}
                              <Delta
                                curr={run.exactAgreementPct}
                                prev={prev?.exactAgreementPct ?? null}
                              />
                            </td>
                            <td className="py-2 pr-4">
                              {fmtPct(run.withinHalfPointPct)}
                              <Delta
                                curr={run.withinHalfPointPct}
                                prev={prev?.withinHalfPointPct ?? null}
                              />
                            </td>
                            <td className="py-2 pr-4">{fmtPts(run.meanAbsError)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
