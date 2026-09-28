"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Loader2, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import { createStudentShareCode } from "@/actions/portal";
import {
  addManualStudent,
  deleteStudent,
  disconnectGoogleClassroom,
  disconnectMicrosoftTeams,
  syncGoogleClassroomRoster,
  syncMicrosoftTeamsRoster,
  syncSS12000Roster,
  type RosterActionResult,
} from "@/actions/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function SyncControls({
  connected,
  connectHref,
  connectLabel,
  disconnectTitle,
  onSync,
  onDisconnect,
}: {
  connected: boolean;
  connectHref?: string;
  connectLabel?: string;
  disconnectTitle?: string;
  onSync: () => Promise<RosterActionResult>;
  onDisconnect?: () => Promise<RosterActionResult>;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!connected && connectHref) {
    return (
      <Button size="sm" asChild>
        {/* Full-page navigation — OAuth flow sets a state cookie. */}
        <a href={connectHref}>{connectLabel ?? "Anslut"}</a>
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const res = await onSync();
            if (!res.success) setError(res.error);
            else {
              setMessage(
                `Synkade ${res.sync?.coursesSeen ?? 0} kurser/sidor: ${res.sync?.studentsImported ?? 0} nya, ${res.sync?.studentsUpdated ?? 0} uppdaterade elever.`,
              );
              router.refresh();
            }
          });
        }}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        Synka elevlistor
      </Button>
      {onDisconnect && (
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          title={disconnectTitle ?? "Koppla bort"}
          onClick={() =>
            startTransition(async () => {
              await onDisconnect();
              router.refresh();
            })
          }
        >
          <Unplug className="h-4 w-4" />
        </Button>
      )}
      {message && <span className="text-sm text-muted-foreground">{message}</span>}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

export function GoogleClassroomControls({ connected }: { connected: boolean }) {
  return (
    <SyncControls
      connected={connected}
      connectHref="/api/integrations/google/connect"
      connectLabel="Anslut Google Classroom"
      disconnectTitle="Koppla bort Google Classroom"
      onSync={syncGoogleClassroomRoster}
      onDisconnect={disconnectGoogleClassroom}
    />
  );
}

export function MicrosoftTeamsControls({ connected }: { connected: boolean }) {
  return (
    <SyncControls
      connected={connected}
      connectHref="/api/integrations/microsoft/connect"
      connectLabel="Anslut Microsoft Teams"
      disconnectTitle="Koppla bort Microsoft Teams"
      onSync={syncMicrosoftTeamsRoster}
      onDisconnect={disconnectMicrosoftTeams}
    />
  );
}

/** SS 12000 is env-configured (no per-teacher OAuth) — sync only. */
export function SS12000Controls() {
  return <SyncControls connected onSync={syncSS12000Roster} />;
}

export function AddStudentForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const res = await addManualStudent(formData);
          if (!res.success) setError(res.error);
          else router.refresh();
        });
      }}
    >
      <Input name="fullName" placeholder="Elevens namn" required className="max-w-56" />
      <Input name="className" placeholder="Klass (t.ex. 9A)" className="max-w-36" />
      <Button size="sm" type="submit" variant="outline" disabled={isPending}>
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Plus className="mr-2 h-4 w-4" />
        )}
        Lägg till
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </form>
  );
}

/**
 * Per-student portal code: opens ALL of the student's reports. Shown once —
 * only the hash is stored server-side.
 */
export function StudentShareButton({ studentId }: { studentId: string }) {
  const [share, setShare] = useState<{ code: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (share) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-xs font-semibold">{share.code}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(share.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        size="sm"
        variant="ghost"
        title="Skapa portalkod (alla elevens rapporter)"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await createStudentShareCode(studentId);
            if (res.success) setShare({ code: res.code, url: res.url });
            else setError(res.error);
          });
        }}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Link2 className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

export function DeleteStudentButton({ studentId }: { studentId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteStudent(studentId);
          router.refresh();
        })
      }
    >
      <Trash2 className="h-4 w-4 text-muted-foreground" />
    </Button>
  );
}
