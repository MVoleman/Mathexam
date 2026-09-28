"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PortalCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const cleaned = code.trim().toUpperCase();
        if (cleaned) router.push(`/portal/${encodeURIComponent(cleaned)}`);
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="XXXX-XXX-XXX"
        aria-label="Delningskod"
        className="text-center font-mono uppercase tracking-widest"
      />
      <Button type="submit">Visa</Button>
    </form>
  );
}
