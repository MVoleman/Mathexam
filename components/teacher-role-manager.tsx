"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, ShieldMinus } from "lucide-react";
import { setTeacherRole } from "@/actions/school";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type TeacherRow = {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "teacher";
};

export function TeacherRoleManager({
  teachers,
  currentUserId,
}: {
  teachers: TeacherRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(target: TeacherRow) {
    setError(null);
    setPendingId(target.id);
    startTransition(async () => {
      const res = await setTeacherRole({
        profileId: target.id,
        role: target.role === "admin" ? "teacher" : "admin",
      });
      setPendingId(null);
      if (!res.success) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Namn</th>
            <th className="py-2 pr-4 font-medium">E-post</th>
            <th className="py-2 pr-4 font-medium">Roll</th>
            <th className="py-2 pr-4" />
          </tr>
        </thead>
        <tbody>
          {teachers.map((t) => (
            <tr key={t.id} className="border-b last:border-0">
              <td className="py-2 pr-4">
                {t.fullName}
                {t.id === currentUserId && (
                  <span className="text-muted-foreground"> (du)</span>
                )}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{t.email}</td>
              <td className="py-2 pr-4">
                <Badge variant={t.role === "admin" ? "default" : "outline"}>
                  {t.role === "admin" ? "Administratör" : "Lärare"}
                </Badge>
              </td>
              <td className="py-2 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  title={
                    t.role === "admin"
                      ? "Gör till lärare"
                      : "Gör till administratör"
                  }
                  onClick={() => toggle(t)}
                >
                  {isPending && pendingId === t.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : t.role === "admin" ? (
                    <ShieldMinus className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
