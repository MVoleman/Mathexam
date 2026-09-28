"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadAndProcessExamPdf } from "@/actions/pdf-processing";
import { curriculumOptions, DEFAULT_CURRICULUM } from "@/lib/curriculum/packs";

export function ExamUploadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await uploadAndProcessExamPdf(formData);
      if (result.success) {
        router.push(`/exams/${result.exam.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form action={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">Titel</Label>
            <Input id="title" name="title" placeholder="Prov: Algebra & ekvationer" required />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="course">Kurs</Label>
              <Input id="course" name="course" placeholder="Matematik åk 9" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gradeLevel">Årskurs</Label>
              <Input id="gradeLevel" name="gradeLevel" placeholder="åk 9" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="curriculum">Kursplan</Label>
            <select
              id="curriculum"
              name="curriculum"
              defaultValue={DEFAULT_CURRICULUM}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {curriculumOptions().map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pdf">Prov (PDF, max 25 MB)</Label>
            <Input id="pdf" name="pdf" type="file" accept="application/pdf" required />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Laddar upp & bearbetar …
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Ladda upp prov
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
