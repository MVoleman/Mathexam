"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { startBatchGrading, getGradingJobStatus } from "@/actions/batch-grading";
import type { GradingJob } from "@/db/schema";

const POLL_INTERVAL_MS = 2500;

type Props = {
  examId: string;
  initialJob: GradingJob | null;
  submissionCount: number;
  questionCount: number;
};

export function BatchGradingPanel({
  examId,
  initialJob,
  submissionCount,
  questionCount,
}: Props) {
  const router = useRouter();
  const [job, setJob] = useState<GradingJob | null>(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, startTransition] = useTransition();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    if (!isActive || !job) return;

    pollingRef.current = setInterval(async () => {
      const latest = await getGradingJobStatus(job.id);
      if (!latest) return;
      setJob(latest);
      if (latest.status === "completed" || latest.status === "failed") {
        if (pollingRef.current) clearInterval(pollingRef.current);
        router.refresh();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, isActive]);

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const result = await startBatchGrading(examId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const fresh = await getGradingJobStatus(result.jobId);
      setJob(fresh);
    });
  }

  const processed = (job?.completedItems ?? 0) + (job?.failedItems ?? 0);
  const progressPct =
    job && job.totalItems > 0 ? Math.round((processed / job.totalItems) * 100) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Batchrättning</CardTitle>
        <Button
          onClick={handleStart}
          disabled={isStarting || isActive || submissionCount === 0 || questionCount === 0}
          size="sm"
        >
          {isStarting || isActive ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {isActive ? "Rättar …" : "Starta rättning"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {submissionCount} inlämningar × {questionCount} frågor ={" "}
          {submissionCount * questionCount} svar att rätta.
        </p>

        {job && (
          <>
            <Progress value={progressPct} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {job.completedItems}/{job.totalItems} rättade
                {job.failedItems > 0 && ` (${job.failedItems} misslyckade)`}
              </span>
              {job.status === "completed" && job.failedItems === 0 && (
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Klar
                </span>
              )}
              {job.status === "completed" && job.failedItems > 0 && (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertTriangle className="h-4 w-4" /> Klar med fel
                </span>
              )}
              {job.status === "failed" && (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="h-4 w-4" /> Misslyckades
                </span>
              )}
            </div>
            {job.lastError && (
              <p className="text-xs text-destructive">Senaste fel: {job.lastError}</p>
            )}
          </>
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
