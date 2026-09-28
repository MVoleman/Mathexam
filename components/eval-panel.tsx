"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Plus } from "lucide-react";
import { createGoldenSet, startEvalRun } from "@/actions/evals";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateGoldenSetForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createGoldenSet(formData);
      if (!result.success) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ny guldkorpus</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Namn</Label>
            <Input id="name" name="name" required placeholder="t.ex. Åk 9 algebra v1" />
          </div>
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="description">Beskrivning (valfri)</Label>
            <Input id="description" name="description" />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Skapa
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function RunEvalButton({ setId, disabled }: { setId: string; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await startEvalRun(setId);
            if (!result.success) setError(result.error);
            else router.refresh();
          });
        }}
      >
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Play className="mr-2 h-4 w-4" />
        )}
        Kör utvärdering
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
