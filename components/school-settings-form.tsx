"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { updateSchoolSettings } from "@/actions/school";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SchoolSettingsForm({
  initial,
}: {
  initial: { name: string; orgNumber: string | null; ssoDomain: string | null };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const res = await updateSchoolSettings(formData);
          if (!res.success) setError(res.error);
          else {
            setSaved(true);
            router.refresh();
          }
        });
      }}
      className="max-w-lg space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="name">Skolans namn</Label>
        <Input id="name" name="name" defaultValue={initial.name} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="orgNumber">Organisationsnummer (huvudman)</Label>
        <Input
          id="orgNumber"
          name="orgNumber"
          defaultValue={initial.orgNumber ?? ""}
          placeholder="212000-1355"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ssoDomain">SSO-domän (automatisk anslutning)</Label>
        <Input
          id="ssoDomain"
          name="ssoDomain"
          defaultValue={initial.ssoDomain ?? ""}
          placeholder="edu.kommunen.se"
        />
        <p className="text-xs text-muted-foreground">
          Lärare som loggar in via SSO med denna e-postdomän ansluts automatiskt
          till skolan. Kräver att domänens SAML-anslutning är registrerad (se
          docs/SSO.md).
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Sparat.</p>}

      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Spara
      </Button>
    </form>
  );
}
