"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileImage, FileText, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadSubmission } from "@/actions/submissions";

export type RosterStudentOption = {
  id: string;
  fullName: string;
  className: string | null;
};

export function SubmissionUploadForm({
  examId,
  rosterStudents = [],
}: {
  examId: string;
  rosterStudents?: RosterStudentOption[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [studentId, setStudentId] = useState("");
  const [studentRef, setStudentRef] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function addFiles(list: FileList | null) {
    if (!list) return;
    // Copy now: `list` is the input's live FileList, and clearing the input
    // below empties it before React runs the state updater.
    const added = Array.from(list);
    setFiles((prev) => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLastUploaded(null);

    const formData = new FormData();
    formData.set("examId", examId);
    formData.set("studentId", studentId);
    if (studentRef) formData.set("studentRef", studentRef);
    for (const file of files) formData.append("files", file);

    startTransition(async () => {
      const result = await uploadSubmission(formData);
      if (result.success) {
        // Reset for the next student — teachers upload a whole class in a row.
        setLastUploaded(result.submission.studentId);
        setStudentId("");
        setStudentRef("");
        setFiles([]);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {rosterStudents.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="studentRef">Elev från elevlistan</Label>
              <select
                id="studentRef"
                value={studentRef}
                onChange={(e) => {
                  const ref = e.target.value;
                  setStudentRef(ref);
                  const student = rosterStudents.find((s) => s.id === ref);
                  if (student) setStudentId(student.fullName);
                }}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">— Välj från elevlistan (valfritt) —</option>
                {rosterStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.fullName}
                    {s.className ? ` (${s.className})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="studentId">Elev (id eller namn)</Label>
            <Input
              id="studentId"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="t.ex. anna.a eller Elev 07"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="files">Lösningar (foton eller skannad PDF)</Label>
            <Input
              id="files"
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => addFiles(e.target.files)}
            />
            <p className="text-xs text-muted-foreground">
              Ordningen bevaras. PDF:er delas automatiskt upp i sidor. Max 30 sidor.
            </p>
          </div>

          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {file.type === "application/pdf" ? (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileImage className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{file.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-2 text-muted-foreground hover:text-foreground"
                    aria-label={`Ta bort ${file.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {lastUploaded && !error && (
            <p className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Inlämning för {lastUploaded} uppladdad. Fortsätt med nästa elev.
            </p>
          )}

          <Button type="submit" disabled={isPending || files.length === 0} className="w-full">
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Laddar upp …
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Ladda upp inlämning
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
