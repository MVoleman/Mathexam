"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Link2, Loader2, ShieldOff } from "lucide-react";
import { createShareCode, revokeShareCodes } from "@/actions/portal";
import { Button } from "@/components/ui/button";

/**
 * Generates a portal share code for this submission's report and shows it
 * once (only the hash is stored server-side).
 */
export function ShareReportButton({ submissionId }: { submissionId: string }) {
  const [share, setShare] = useState<{ code: string; url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (share) {
    return (
      <div className="print:hidden flex flex-wrap items-center gap-2 rounded-md border p-2">
        <span className="font-mono text-sm font-semibold">{share.code}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(share.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
          Kopiera länk
        </Button>
        <span className="text-xs text-muted-foreground">
          Giltig till {new Date(share.expiresAt).toLocaleDateString("sv-SE")} — visas
          bara nu, spara den.
        </span>
      </div>
    );
  }

  return (
    <div className="print:hidden flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await createShareCode(submissionId);
            if (res.success) setShare(res);
            else setError(res.error);
          });
        }}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Link2 className="mr-2 h-4 w-4" />
        )}
        Dela med elev/vårdnadshavare
      </Button>
      <Button
        size="sm"
        variant="ghost"
        title="Återkalla alla aktiva delningskoder för denna rapport"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await revokeShareCodes(submissionId);
            if (!res.success) setError(res.error);
          });
        }}
      >
        <ShieldOff className="h-4 w-4" />
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
