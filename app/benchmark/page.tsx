import { desc, eq, isNull, sql } from "drizzle-orm";
import { BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { evalRuns, goldenItems, goldenSets } from "@/db/schema";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Noggrannhetsbenchmark — DeepGrader",
  description:
    "Öppna siffror: hur väl DeepGraders AI-bedömning överensstämmer med lärares poängsättning på en delad, avidentifierad guldkorpus.",
};

const fmtPct = (v: number | null) => (v === null ? "–" : `${v.toFixed(1)}%`);
const fmtPts = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}p`);

/**
 * PUBLIC page: the accuracy benchmark. Shows the latest completed eval run
 * for each GLOBAL golden set (school_id is null — shared, anonymized items
 * only). This is the marketable, regression-proof accuracy claim.
 */
export default async function BenchmarkPage() {
  const sets = await db
    .select({
      set: goldenSets,
      itemCount: sql<number>`(
        SELECT count(*)::int FROM ${goldenItems}
        WHERE "golden_items"."set_id" = "golden_sets"."id"
      )`,
    })
    .from(goldenSets)
    .where(isNull(goldenSets.schoolId))
    .orderBy(desc(goldenSets.createdAt));

  const latestRuns = await Promise.all(
    sets.map(({ set }) =>
      db.query.evalRuns.findFirst({
        where: (r, { and }) => and(eq(r.setId, set.id), eq(r.status, "completed")),
        orderBy: desc(evalRuns.createdAt),
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-2 border-b pb-4">
        <BarChart3 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            DeepGrader — noggrannhetsbenchmark
          </h1>
          <p className="text-sm text-muted-foreground">
            Överensstämmelse mellan AI-bedömning och lärares poängsättning.
          </p>
        </div>
      </header>

      {sets.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Benchmarken är inte publicerad ännu.
          </CardContent>
        </Card>
      )}

      {sets.map(({ set, itemCount }, i) => {
        const run = latestRuns[i];
        return (
          <Card key={set.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {set.name} <Badge variant="outline">{itemCount} elevsvar</Badge>
                {set.frozen && <Badge variant="secondary">Fryst version</Badge>}
              </CardTitle>
              {set.description && (
                <p className="text-sm text-muted-foreground">{set.description}</p>
              )}
            </CardHeader>
            <CardContent>
              {!run ? (
                <p className="text-sm text-muted-foreground">
                  Ingen publicerad körning ännu.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-2xl font-semibold">
                      {fmtPct(run.exactAgreementPct)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Exakt samma poäng som läraren
                    </p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">
                      {fmtPct(run.withinHalfPointPct)}
                    </p>
                    <p className="text-xs text-muted-foreground">Inom ±0,5 poäng</p>
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">{fmtPts(run.meanAbsError)}</p>
                    <p className="text-xs text-muted-foreground">
                      Genomsnittligt poängfel
                    </p>
                  </div>
                  <p className="col-span-full text-xs text-muted-foreground">
                    Senast körd{" "}
                    {run.createdAt.toLocaleDateString("sv-SE")} · bedömningsmodell{" "}
                    <span className="font-mono">{run.config.gradingModel}</span>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metod</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Korpusen består av avidentifierade, transkriberade elevsvar där en
            lärare satt den slutliga poängen (med samtycke där svaren kommer från
            verkliga prov). AI:n bedömer varje svar utan att se lärarens poäng,
            med samma pipeline som i produkten. Frysta versioner ändras aldrig —
            siffror mellan körningar är därför jämförbara över tid och mellan
            modellversioner.
          </p>
          <p>
            Varje prompt- eller modelländring körs mot korpusen innan den släpps;
            en försämring behandlas som en regression. Ingen slutgiltig poäng
            sätts i produkten utan lärargranskning.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
