"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FlaskConical, Loader2, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveResult, overrideResult } from "@/actions/review";
import { addResultToGoldenSet } from "@/actions/evals";
import { getAbilityLabels } from "@/lib/curriculum/packs";
import { formatLevelPoints, rubricOf, scoreRubric, summarizeRubric } from "@/lib/rubric";
import type { GradingResult, Question } from "@/db/schema";

type ResultWithQuestion = GradingResult & { question: Question };
export type GoldenSetOption = { id: string; name: string };

export function ReviewPanel({
  results,
  goldenSets = [],
  curriculum = "lgr22",
}: {
  results: ResultWithQuestion[];
  goldenSets?: GoldenSetOption[];
  curriculum?: string;
}) {
  if (results.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Inga rättade svar ännu — starta batchrättningen från provsidan.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {results.map((result) => (
        <ResultCard
          key={result.id}
          result={result}
          goldenSets={goldenSets}
          curriculum={curriculum}
        />
      ))}
    </div>
  );
}

function ResultCard({
  result,
  goldenSets,
  curriculum,
}: {
  result: ResultWithQuestion;
  goldenSets: GoldenSetOption[];
  curriculum: string;
}) {
  const abilityLabels = getAbilityLabels(curriculum);
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [points, setPoints] = useState(String(result.awardedPoints));
  const [comment, setComment] = useState(result.teacherComment ?? "");
  const initialAbilities = result.evaluation.lgr22Assessment.map(({ ability, demonstrated }) => ({
    ability,
    demonstrated,
  }));
  const [abilities, setAbilities] = useState(initialAbilities);
  // Moment-graded answers are corrected per moment; older ones by points.
  const rubric = rubricOf(result.question);
  const initialMoments = result.evaluation.rubricAssessment?.map(({ itemId, met }) => ({ itemId, met }));
  const [moments, setMoments] = useState(initialMoments);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { question, transcription, evaluation } = result;

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveResult(result.id);
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  }

  const momentPoints = moments
    ? scoreRubric(
        rubric,
        moments.map((m) => ({ ...m, evidence: "" })),
      ).points
    : 0;

  function handleOverride() {
    setError(null);
    const parsed = Number(points.replace(",", "."));
    if (Number.isNaN(parsed)) {
      setError("Ange ett giltigt poängtal.");
      return;
    }
    startTransition(async () => {
      const abilitiesChanged =
        JSON.stringify(abilities) !== JSON.stringify(initialAbilities);
      const res = await overrideResult({
        resultId: result.id,
        awardedPoints: moments ? momentPoints : parsed,
        teacherComment: comment || undefined,
        ...(moments
          ? { rubric: moments }
          : { abilities: abilitiesChanged ? abilities : undefined }),
      });
      if (!res.success) setError(res.error);
      else {
        setIsEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <Card className={result.needsHumanReview ? "border-amber-400" : undefined}>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">
            Uppgift {question.number}{" "}
            <span className="font-normal text-muted-foreground">
              (E/C/A {formatLevelPoints(summarizeRubric(rubric).levelPoints)}, max{" "}
              {question.maxPoints}p)
            </span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            {result.needsHumanReview && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Granska
              </Badge>
            )}
            {result.status === "approved" && <Badge>Godkänd</Badge>}
            {result.status === "overridden" && <Badge variant="secondary">Korrigerad</Badge>}
            {result.secondOpinionPoints !== null && (
              <Badge
                variant="outline"
                title="Oberoende andrabedömning av en annan AI-modell"
              >
                2:a bedömning: {result.secondOpinionPoints}p
              </Badge>
            )}
            <Badge variant="outline" className="text-base">
              {result.awardedPoints}/{question.maxPoints}p
            </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{question.questionText}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transkription (säkerhet {(transcription.confidence * 100).toFixed(0)}%)
          </h3>
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-sm">
            {transcription.isBlank ? "— blankt svar —" : transcription.transcribedText}
          </p>
          {transcription.uncertainSegments.length > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Osäkra passager: {transcription.uncertainSegments.join("; ")}
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AI:ns motivering
          </h3>
          <p className="text-sm">{evaluation.reasoning}</p>
        </section>

        {evaluation.rubricAssessment && !isEditing && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Bedömningsanvisning
            </h3>
            <ul className="space-y-1.5">
              {rubric.map((item) => {
                const verdict = evaluation.rubricAssessment?.find((v) => v.itemId === item.id);
                return (
                  <li key={item.id} className="flex gap-2 text-sm">
                    <span className={verdict?.met ? "text-emerald-600" : "text-destructive"}>
                      {verdict?.met ? "✓" : "✗"}
                    </span>
                    <span className="w-5 shrink-0 font-semibold">{item.level}</span>
                    <span className="min-w-0">
                      {item.description}{" "}
                      <span className="text-muted-foreground">
                        ({abilityLabels[item.ability] ?? item.ability}, {item.points}p)
                      </span>
                      {verdict?.evidence && (
                        <span className="block text-xs text-muted-foreground">{verdict.evidence}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!evaluation.rubricAssessment && evaluation.lgr22Assessment.length > 0 && (
          <section className="flex flex-wrap gap-2">
            {evaluation.lgr22Assessment.map((a) => (
              <Badge
                key={a.ability}
                variant={a.demonstrated ? "default" : "outline"}
                title={a.evidence}
              >
                {abilityLabels[a.ability] ?? a.ability}
                {a.demonstrated && a.level ? ` (${a.level})` : ""}
              </Badge>
            ))}
          </section>
        )}

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Formativ återkoppling till eleven
          </h3>
          <p className="rounded-md border-l-2 border-primary/40 bg-muted/30 p-3 text-sm italic">
            {evaluation.formativeFeedback}
          </p>
        </section>

        {result.teacherComment && !isEditing && (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lärarkommentar
            </h3>
            <p className="text-sm">{result.teacherComment}</p>
          </section>
        )}

        {isEditing ? (
          <div className="space-y-3 rounded-md border p-4">
            {moments ? (
              <div className="space-y-2">
                <Label>Uppfyllda moment</Label>
                <ul className="space-y-1.5">
                  {rubric.map((item) => {
                    const met = moments.find((m) => m.itemId === item.id)?.met ?? false;
                    return (
                      <li key={item.id}>
                        <label className="flex cursor-pointer gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={met}
                            onChange={(e) =>
                              setMoments((prev) => [
                                ...(prev ?? []).filter((m) => m.itemId !== item.id),
                                { itemId: item.id, met: e.target.checked },
                              ])
                            }
                            className="mt-0.5"
                          />
                          <span className="w-5 shrink-0 font-semibold">{item.level}</span>
                          <span>
                            {item.description}{" "}
                            <span className="text-muted-foreground">
                              ({abilityLabels[item.ability] ?? item.ability}, {item.points}p)
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-sm">
                  Poäng: <span className="font-semibold">{momentPoints}</span>/{question.maxPoints}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor={`points-${result.id}`}>
                    Poäng (0–{question.maxPoints})
                  </Label>
                  <Input
                    id={`points-${result.id}`}
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    inputMode="decimal"
                    className="max-w-28"
                  />
                </div>
                <AbilityEditor
                  abilities={abilities}
                  onChange={setAbilities}
                  abilityLabels={abilityLabels}
                />
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor={`comment-${result.id}`}>Kommentar (valfri)</Label>
              <Textarea
                id={`comment-${result.id}`}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleOverride} disabled={isPending} size="sm">
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Spara korrigering
              </Button>
              <Button
                onClick={() => {
                  setIsEditing(false);
                  setAbilities(initialAbilities);
                  setMoments(initialMoments);
                }}
                variant="ghost"
                size="sm"
                disabled={isPending}
              >
                Avbryt
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              onClick={handleApprove}
              disabled={isPending || result.status === "approved"}
              size="sm"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Godkänn
            </Button>
            <Button onClick={() => setIsEditing(true)} variant="outline" size="sm">
              <Pencil className="mr-2 h-4 w-4" />
              Korrigera
            </Button>
          </div>
        )}

        {(result.status === "approved" || result.status === "overridden") &&
          goldenSets.length > 0 && (
            <GoldenCapture resultId={result.id} goldenSets={goldenSets} />
          )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Per-ability verdict in the correction form: click toggles shown/not shown,
 * × drops an ability that doesn't apply, and abilities the AI missed can be
 * added from the curriculum. Ability stats weight each verdict by points.
 */
function AbilityEditor({
  abilities,
  onChange,
  abilityLabels,
}: {
  abilities: { ability: string; demonstrated: boolean }[];
  onChange: (next: { ability: string; demonstrated: boolean }[]) => void;
  abilityLabels: Record<string, string>;
}) {
  const addable = Object.keys(abilityLabels).filter(
    (code) => !abilities.some((a) => a.ability === code),
  );

  return (
    <div className="space-y-2">
      <Label>Förmågor</Label>
      <div className="flex flex-wrap items-center gap-2">
        {abilities.map((a) => (
          <span
            key={a.ability}
            className={`inline-flex items-center rounded-full border text-xs ${
              a.demonstrated
                ? "border-primary bg-primary text-primary-foreground"
                : "border-destructive/50 text-destructive"
            }`}
          >
            <button
              type="button"
              className="py-1 pl-2.5 pr-1"
              title={a.demonstrated ? "Visad — klicka för ej visad" : "Ej visad — klicka för visad"}
              onClick={() =>
                onChange(
                  abilities.map((x) =>
                    x.ability === a.ability ? { ...x, demonstrated: !x.demonstrated } : x,
                  ),
                )
              }
            >
              {a.demonstrated ? "✓" : "✗"} {abilityLabels[a.ability] ?? a.ability}
            </button>
            <button
              type="button"
              className="py-1 pl-0.5 pr-2 opacity-70 hover:opacity-100"
              aria-label={`Ta bort ${abilityLabels[a.ability] ?? a.ability}`}
              onClick={() => onChange(abilities.filter((x) => x.ability !== a.ability))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {addable.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onChange([...abilities, { ability: e.target.value, demonstrated: false }]);
              }
            }}
            className="h-7 rounded-full border bg-background px-2 text-xs text-muted-foreground"
            aria-label="Lägg till förmåga"
          >
            <option value="">+ Lägg till förmåga</option>
            {addable.map((code) => (
              <option key={code} value={code}>
                {abilityLabels[code]}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Klicka för att växla visad/ej visad. En förmåga som inte visats räknas som 0 poäng i
        förmågeprofilen för den här uppgiften.
      </p>
    </div>
  );
}

/**
 * Golden-set capture: turns this teacher-verified grading into a versioned
 * eval example. Requires explicit consent confirmation (GDPR) — the item
 * stores the anonymized transcription + question snapshot only.
 */
function GoldenCapture({
  resultId,
  goldenSets,
}: {
  resultId: string;
  goldenSets: GoldenSetOption[];
}) {
  const [setId, setSetId] = useState(goldenSets[0]?.id ?? "");
  const [consent, setConsent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (saved) {
    return (
      <p className="text-sm text-muted-foreground">
        ✓ Sparad som guldsvar — körs i nästa utvärdering.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        <select
          value={setId}
          onChange={(e) => setSetId(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          aria-label="Guldkorpus"
        >
          {goldenSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending || !consent || !setId}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await addResultToGoldenSet({
                resultId,
                setId,
                consentConfirmed: consent,
              });
              if (!res.success) setError(res.error);
              else setSaved(true);
            });
          }}
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Spara som guldsvar
        </Button>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5"
        />
        Jag bekräftar att samtycke finns för att spara detta avidentifierade svar i
        utvärderingskorpusen.
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
