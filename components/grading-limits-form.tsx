"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { setGradingLimits, setShowGradeToStudents } from "@/actions/exams";
import type { GradingLimits } from "@/db/schema";
import { formatLevelPoints, type LevelPoints } from "@/lib/rubric";

type Field = "E" | "C" | "A" | "cLevelMin" | "aLevelMin";

/**
 * Betygsgränser in the national tests' form: a total per grade, plus a
 * minimum of points on C/A level for C and on A level for A.
 */
export function GradingLimitsForm({
  examId,
  limits,
  examLevelPoints,
  showGradeToStudents,
}: {
  examId: string;
  limits: GradingLimits | null;
  /** The exam's available points per level, for orientation. */
  examLevelPoints: LevelPoints;
  showGradeToStudents: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<Field, string>>({
    E: limits?.E?.toString() ?? "",
    C: limits?.C?.toString() ?? "",
    A: limits?.A?.toString() ?? "",
    cLevelMin: limits?.cLevelMin?.toString() ?? "",
    aLevelMin: limits?.aLevelMin?.toString() ?? "",
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showGrade, setShowGrade] = useState(showGradeToStudents);

  function toggleShowGrade(show: boolean) {
    setShowGrade(show);
    setMessage(null);
    startTransition(async () => {
      const res = await setShowGradeToStudents(examId, show);
      if (!res.success) {
        setShowGrade(!show);
        setMessage({ ok: false, text: res.error });
      } else router.refresh();
    });
  }

  const input = (field: Field, label: string) => (
    <Input
      value={values[field]}
      onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
      inputMode="numeric"
      className="h-8 w-16"
      aria-label={label}
    />
  );

  function save(clear = false) {
    setMessage(null);
    const toNumber = (v: string) => (v.trim() === "" ? undefined : Number(v));
    startTransition(async () => {
      const res = await setGradingLimits(
        examId,
        clear
          ? null
          : {
              E: toNumber(values.E) ?? 0,
              C: toNumber(values.C) ?? 0,
              A: toNumber(values.A) ?? 0,
              cLevelMin: toNumber(values.cLevelMin),
              aLevelMin: toNumber(values.aLevelMin),
            },
      );
      if (!res.success) setMessage({ ok: false, text: res.error });
      else {
        setMessage({ ok: true, text: clear ? "Gränserna borttagna." : "Gränserna sparade." });
        if (clear) setValues({ E: "", C: "", A: "", cLevelMin: "", aLevelMin: "" });
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Betygsgränser</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Provet ger {formatLevelPoints(examLevelPoints)} poäng på E/C/A-nivå. Nivåkraven är
          valfria. Når eleven C-gränsen men inte C-nivåkravet blir betyget D; når eleven
          A-gränsen men inte A-nivåkravet blir det B.
        </p>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 font-semibold">E</span> minst {input("E", "Gräns för E")} p
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 font-semibold">C</span> minst {input("C", "Gräns för C")} p, varav
            minst {input("cLevelMin", "C-krav: poäng på C/A-nivå")} p på C- eller A-nivå
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 font-semibold">A</span> minst {input("A", "Gräns för A")} p, varav
            minst {input("aLevelMin", "A-krav: poäng på A-nivå")} p på A-nivå
          </div>
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={showGrade}
            onChange={(e) => toggleShowGrade(e.target.checked)}
            disabled={isPending}
            className="mt-0.5"
          />
          <span>
            Visa preliminärt betyg för eleven
            <span className="block text-xs text-muted-foreground">
              Gäller elevportalen och PDF-rapporten. Du ser alltid betyget.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => save()} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Spara gränser
          </Button>
          {limits && (
            <Button size="sm" variant="ghost" onClick={() => save(true)} disabled={isPending}>
              Ta bort
            </Button>
          )}
          {message && (
            <span className={message.ok ? "text-emerald-600" : "text-destructive"}>
              {message.text}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
