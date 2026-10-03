"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  extractQuestionsFromExam,
  saveQuestionDrafts,
  discardQuestionDraft,
} from "@/actions/questions";
import type { QuestionFields } from "@/lib/validations/question-schema";
import type { Question, QuestionDraft } from "@/db/schema";
import { getPack } from "@/lib/curriculum/packs";
import {
  LEVELS,
  formatLevelPoints,
  rubricOf,
  summarizeRubric,
  type RubricItem,
} from "@/lib/rubric";

type AbilityOption = { value: string; label: string };

/** Next free moment id ("m1", "m2", …) for a new row. */
function nextMomentId(rubric: RubricItem[]): string {
  const used = rubric.map((i) => Number(/^m(\d+)$/.exec(i.id)?.[1] ?? 0));
  return `m${Math.max(0, ...used) + 1}`;
}

function emptyFields(abilities: AbilityOption[]): QuestionFields {
  return {
    number: "",
    questionText: "",
    topic: "",
    correctAnswer: "",
    solutionSteps: "",
    rubric: [
      {
        id: "m1",
        description: "",
        level: "E",
        ability: abilities[0]?.value ?? "method",
        points: 1,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

type Props = {
  examId: string;
  hasPageImages: boolean;
  questions: Question[];
  /** AI drafts stored on the exam, awaiting review. */
  initialDrafts?: QuestionDraft[];
  /** Curriculum pack id of the exam — decides the ability/criteria options. */
  curriculum?: string;
};

export function QuestionManager({
  examId,
  hasPageImages,
  questions,
  initialDrafts = [],
  curriculum = "lgr22",
}: Props) {
  const abilityOptions: AbilityOption[] = getPack(curriculum).abilities.map((a) => ({
    value: a.code,
    label: a.label,
  }));
  const router = useRouter();
  // Drafts live in the DB; this holds them plus the teacher's unsaved edits.
  const [drafts, setDrafts] = useState<QuestionDraft[]>(initialDrafts);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [isSavingAll, startSaveAll] = useTransition();
  const [showNewForm, setShowNewForm] = useState(questions.length === 0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isExtracting, startExtraction] = useTransition();

  function handleExtract() {
    setExtractError(null);
    startExtraction(async () => {
      const result = await extractQuestionsFromExam(examId);
      if (result.success) {
        // The server returns every stored draft; keep local edits to old ones.
        setDrafts((prev) => {
          const local = new Map(prev.map((d) => [d.id, d]));
          return result.drafts.map((d) => local.get(d.id) ?? d);
        });
      } else {
        setExtractError(result.error);
      }
    });
  }

  async function saveDrafts(toSave: QuestionDraft[]): Promise<string | null> {
    const result = await saveQuestionDrafts(examId, toSave);
    if (!result.success) return result.error;
    const saved = new Set(result.savedIds);
    setDrafts((prev) => prev.filter((d) => !saved.has(d.id)));
    setDraftErrors((prev) => {
      const next = { ...prev };
      for (const id of saved) delete next[id];
      for (const f of result.failed) next[f.id] = f.error;
      return next;
    });
    if (saved.size > 0) router.refresh();
    return result.failed.length > 0 && toSave.length === 1 ? result.failed[0].error : null;
  }

  function handleSaveAll() {
    startSaveAll(async () => {
      const error = await saveDrafts(drafts);
      if (error) setExtractError(error);
    });
  }

  return (
    <div className="space-y-6">
      {/* AI extraction */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">AI-registrering</CardTitle>
          <Button onClick={handleExtract} disabled={isExtracting || !hasPageImages} size="sm">
            {isExtracting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {isExtracting ? "Läser provet …" : "Föreslå frågor från PDF:en"}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {hasPageImages
              ? "Gemini läser provets sidor, identifierar alla frågor och föreslår facit, poäng, nivå och förmågor/kriterier enligt provets kursplan. Du granskar varje förslag innan det sparas."
              : "Provet saknar sidbilder — ladda upp PDF:en på nytt för att använda AI-registrering."}
          </p>
          {extractError && (
            <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {extractError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* AI drafts pending review */}
      {drafts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              AI-förslag att granska ({drafts.length})
            </h2>
            <Button onClick={handleSaveAll} disabled={isSavingAll} size="sm">
              {isSavingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCheck className="mr-2 h-4 w-4" />
              )}
              Spara alla ({drafts.length})
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Förslagen är sparade på provet och finns kvar tills du sparar eller förkastar dem.
            Dina ändringar i formulären sparas när du sparar frågan.
          </p>
          {drafts.map((draft) => (
            <Card key={draft.id} className="border-dashed border-primary/50">
              <CardContent className="pt-6">
                {draftErrors[draft.id] && (
                  <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {draftErrors[draft.id]}
                  </p>
                )}
                <QuestionForm
                  initial={draft}
                  abilityOptions={abilityOptions}
                  submitLabel="Spara fråga"
                  onChange={(fields) =>
                    setDrafts((prev) =>
                      prev.map((d) => (d.id === draft.id ? { ...fields, id: draft.id } : d)),
                    )
                  }
                  onSubmit={(fields) => saveDrafts([{ ...fields, id: draft.id }])}
                  onCancel={async () => {
                    const res = await discardQuestionDraft(examId, draft.id);
                    if (res.success) setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
                    else setExtractError(res.error);
                  }}
                  cancelLabel="Förkasta"
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Existing questions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Registrerade frågor ({questions.length})
          </h2>
          {!showNewForm && (
            <Button onClick={() => setShowNewForm(true)} variant="outline" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Ny fråga
            </Button>
          )}
        </div>

        {questions.map((q) => (
          <ExistingQuestionCard key={q.id} question={q} abilityOptions={abilityOptions} />
        ))}

        {showNewForm && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ny fråga</CardTitle>
            </CardHeader>
            <CardContent>
              <QuestionForm
                initial={emptyFields(abilityOptions)}
                abilityOptions={abilityOptions}
                submitLabel="Lägg till fråga"
                onSubmit={async (fields) => {
                  const result = await createQuestion(examId, fields);
                  if (result.success) {
                    router.refresh();
                    return null;
                  }
                  return result.error;
                }}
                onCancel={questions.length > 0 ? () => setShowNewForm(false) : undefined}
                resetOnSuccess
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing question card (view / edit / delete)
// ---------------------------------------------------------------------------

function ExistingQuestionCard({
  question,
  abilityOptions,
}: {
  question: Question;
  abilityOptions: AbilityOption[];
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, startDeletion] = useTransition();

  function handleDelete() {
    if (!confirm(`Ta bort uppgift ${question.number}? Rättade svar raderas också.`)) return;
    startDeletion(async () => {
      const result = await deleteQuestion(question.id);
      if (result.success) router.refresh();
    });
  }

  if (isEditing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Redigera uppgift {question.number}</CardTitle>
        </CardHeader>
        <CardContent>
          <QuestionForm
            abilityOptions={abilityOptions}
            initial={{
              number: question.number,
              questionText: question.questionText,
              topic: question.topic,
              correctAnswer: question.correctAnswer,
              solutionSteps: question.solutionSteps ?? "",
              rubric: rubricOf(question),
            }}
            submitLabel="Spara ändringar"
            onSubmit={async (fields) => {
              const result = await updateQuestion(question.id, fields);
              if (result.success) {
                setIsEditing(false);
                router.refresh();
                return null;
              }
              return result.error;
            }}
            onCancel={() => setIsEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {question.number}. <span className="font-normal">{question.questionText}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Facit: {question.correctAnswer} · {question.topic}
          </p>
          <ul className="space-y-0.5 pt-1 text-xs">
            {rubricOf(question).map((item) => (
              <li key={item.id} className="flex gap-2">
                <span className="w-5 shrink-0 font-semibold">{item.level}</span>
                <span className="shrink-0 text-muted-foreground">
                  {abilityOptions.find((x) => x.value === item.ability)?.label ?? item.ability}{" "}
                  · {item.points}p
                </span>
                <span className="min-w-0">{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline" title="Poäng på E/C/A-nivå">
            {formatLevelPoints(summarizeRubric(rubricOf(question)).levelPoints)}
          </Badge>
          <Badge variant="secondary">{question.maxPoints}p</Badge>
          <Button onClick={() => setIsEditing(true)} variant="ghost" size="icon">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button onClick={handleDelete} variant="ghost" size="icon" disabled={isDeleting}>
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 text-destructive" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shared form
// ---------------------------------------------------------------------------

type FormProps = {
  initial: QuestionFields;
  abilityOptions: AbilityOption[];
  submitLabel: string;
  onSubmit: (fields: QuestionFields) => Promise<string | null>;
  onCancel?: () => void;
  cancelLabel?: string;
  resetOnSuccess?: boolean;
  /** Reports every edit, so a parent can save the current values in bulk. */
  onChange?: (fields: QuestionFields) => void;
};

function QuestionForm({
  initial,
  abilityOptions,
  submitLabel,
  onSubmit,
  onCancel,
  cancelLabel = "Avbryt",
  resetOnSuccess,
  onChange,
}: FormProps) {
  const [fields, setFields] = useState<QuestionFields>(initial);

  useEffect(() => {
    if (fields !== initial) onChange?.(fields);
    // Only edits should report; onChange is a fresh closure every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof QuestionFields>(key: K, value: QuestionFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function updateMoment(id: string, patch: Partial<RubricItem>) {
    setFields((prev) => ({
      ...prev,
      rubric: prev.rubric.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }

  function addMoment() {
    setFields((prev) => {
      const last = prev.rubric[prev.rubric.length - 1];
      return {
        ...prev,
        rubric: [
          ...prev.rubric,
          {
            id: nextMomentId(prev.rubric),
            description: "",
            level: last?.level ?? "E",
            ability: last?.ability ?? abilityOptions[0]?.value ?? "method",
            points: 1,
          },
        ],
      };
    });
  }

  function removeMoment(id: string) {
    setFields((prev) => ({ ...prev, rubric: prev.rubric.filter((i) => i.id !== id) }));
  }

  const summary = summarizeRubric(fields.rubric);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const submitError = await onSubmit(fields);
      if (submitError) setError(submitError);
      else if (resetOnSuccess) setFields(emptyFields(abilityOptions));
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
        <div className="space-y-2">
          <Label>Nummer</Label>
          <Input
            value={fields.number}
            onChange={(e) => set("number", e.target.value)}
            placeholder="1a"
          />
        </div>
        <div className="space-y-2">
          <Label>Område</Label>
          <Input
            value={fields.topic}
            onChange={(e) => set("topic", e.target.value)}
            placeholder="algebra"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Frågetext</Label>
        <Textarea
          value={fields.questionText}
          onChange={(e) => set("questionText", e.target.value)}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>Facit</Label>
        <Input
          value={fields.correctAnswer}
          onChange={(e) => set("correctAnswer", e.target.value)}
          placeholder="x = 5"
        />
      </div>

      <div className="space-y-2">
        <Label>Lösningssteg (valfritt)</Label>
        <Textarea
          value={fields.solutionSteps ?? ""}
          onChange={(e) => set("solutionSteps", e.target.value)}
          rows={2}
          placeholder="3x + 7 = 22 → 3x = 15 → x = 5"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Bedömningsanvisning</Label>
          <span className="text-xs text-muted-foreground">
            E/C/A: <span className="font-medium text-foreground">{formatLevelPoints(summary.levelPoints)}</span>{" "}
            · max {summary.maxPoints}p
          </span>
        </div>
        <div className="space-y-2">
          {fields.rubric.map((item) => (
            <div key={item.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1">
                  {LEVELS.map((level) => (
                    <Button
                      key={level}
                      type="button"
                      size="sm"
                      variant={item.level === level ? "default" : "outline"}
                      className="h-8 w-8 p-0"
                      onClick={() => updateMoment(item.id, { level })}
                      aria-label={`${level}-nivå`}
                    >
                      {level}
                    </Button>
                  ))}
                </div>
                <select
                  value={item.ability}
                  onChange={(e) => updateMoment(item.id, { ability: e.target.value })}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  aria-label="Förmåga"
                >
                  {abilityOptions.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <Input
                    value={String(item.points)}
                    onChange={(e) => updateMoment(item.id, { points: Number(e.target.value) || 0 })}
                    inputMode="numeric"
                    className="h-8 w-14"
                    aria-label="Poäng"
                  />
                  <span className="text-sm text-muted-foreground">p</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-8 w-8"
                  onClick={() => removeMoment(item.id)}
                  disabled={fields.rubric.length === 1}
                  aria-label="Ta bort moment"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                value={item.description}
                onChange={(e) => updateMoment(item.id, { description: e.target.value })}
                rows={2}
                placeholder="T.ex. Godtagbar ansats: tecknar ekvationen x + (x+1) + (x+2) = 72"
              />
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addMoment}>
          <Plus className="mr-2 h-4 w-4" />
          Lägg till moment
        </Button>
      </div>

      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
