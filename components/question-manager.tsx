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
import type { Lgr22Ability, GradeLevel } from "@/lib/validations/ai-schemas";
import { getPack } from "@/lib/curriculum/packs";

type AbilityOption = { value: string; label: string };

const DIFFICULTIES: GradeLevel[] = ["E", "C", "A"];

function emptyFields(abilities: AbilityOption[]): QuestionFields {
  return {
    number: "",
    questionText: "",
    topic: "",
    difficulty: "E",
    maxPoints: 1,
    correctAnswer: "",
    solutionSteps: "",
    lgr22Abilities: abilities.length > 0 ? [abilities[0].value] : [],
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
              difficulty: question.difficulty,
              maxPoints: question.maxPoints,
              correctAnswer: question.correctAnswer,
              solutionSteps: question.solutionSteps ?? "",
              lgr22Abilities: question.lgr22Abilities,
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
            Facit: {question.correctAnswer} · {question.topic} ·{" "}
            {question.lgr22Abilities
              .map((a) => abilityOptions.find((x) => x.value === a)?.label ?? a)
              .join(", ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline">{question.difficulty}</Badge>
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

  function toggleAbility(ability: Lgr22Ability) {
    setFields((prev) => ({
      ...prev,
      lgr22Abilities: prev.lgr22Abilities.includes(ability)
        ? prev.lgr22Abilities.filter((a) => a !== ability)
        : [...prev.lgr22Abilities, ability],
    }));
  }

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
      <div className="grid gap-4 sm:grid-cols-[6rem_1fr_6rem]">
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
        <div className="space-y-2">
          <Label>Maxpoäng</Label>
          <Input
            value={String(fields.maxPoints)}
            onChange={(e) => set("maxPoints", Number(e.target.value) || 0)}
            inputMode="numeric"
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Facit</Label>
          <Input
            value={fields.correctAnswer}
            onChange={(e) => set("correctAnswer", e.target.value)}
            placeholder="x = 5"
          />
        </div>
        <div className="space-y-2">
          <Label>Nivå</Label>
          <div className="flex gap-1">
            {DIFFICULTIES.map((d) => (
              <Button
                key={d}
                type="button"
                variant={fields.difficulty === d ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => set("difficulty", d)}
              >
                {d}
              </Button>
            ))}
          </div>
        </div>
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
        <Label>Förmågor / kriterier</Label>
        <div className="flex flex-wrap gap-1">
          {abilityOptions.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant={fields.lgr22Abilities.includes(value) ? "default" : "outline"}
              size="sm"
              onClick={() => toggleAbility(value)}
            >
              {label}
            </Button>
          ))}
        </div>
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
