"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gradeSubmissionAction } from "@/actions/grading";

/**
 * Deliberate full re-grade of one submission (e.g. after changing a
 * bedömningsanvisning). Batch grading never touches graded answers, so this
 * is the only path that overwrites them — hence the confirmation.
 */
export function RegradeButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (
      !confirm(
        "Rätta om alla svar i den här inlämningen?\n\nDina korrigeringar, godkännanden och kommentarer för inlämningen skrivs över av den nya AI-rättningen.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await gradeSubmissionAction(submissionId);
      if (!res.success) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={isPending} variant="outline" size="sm">
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RotateCcw className="mr-2 h-4 w-4" />
        )}
        {isPending ? "Rättar om …" : "Rätta om"}
      </Button>
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}
