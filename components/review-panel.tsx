"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FlaskConical, Loader2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveResult, overrideResult } from "@/actions/review";
import { addResultToGoldenSet } from "@/actions/evals";
import { getAbilityLabels } from "@/lib/curriculum/packs";
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

  function handleOverride() {
    setError(null);
    const parsed = Number(points.replace(",", "."));
    if (Number.isNaN(parsed)) {
      setError("Ange ett giltigt poängtal.");
      return;
    }
    startTransition(async () => {
      const res = await overrideResult({
        resultId: result.id,
        awardedPoints: parsed,
        teacherComment: comment || undefined,
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
              ({question.difficulty}-nivå, max {question.maxPoints}p)
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

        {evaluation.lgr22Assessment.length > 0 && (
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
                onClick={() => setIsEditing(false)}
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
