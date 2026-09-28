"use client";

import { useState, useTransition } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { signIn, signInWithSso, signUp, type AuthResult } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "signin" | "signup";

export function AuthForm() {
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const action = mode === "signin" ? signIn : signUp;
      let result: AuthResult;
      try {
        result = await action(formData);
      } catch {
        // redirect() throws on success — let Next.js handle it.
        return;
      }
      if (!result.success) setError(result.error);
      else if (mode === "signup") {
        setInfo("Konto skapat. Bekräfta din e-postadress via länken vi skickade.");
      }
    });
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          <span className="text-xl font-semibold tracking-tight">DeepGrader</span>
        </div>
        <CardTitle className="text-lg">
          {mode === "signin" ? "Logga in" : "Skapa konto"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Namn</Label>
                <Input id="fullName" name="fullName" required autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="schoolName">Skola</Label>
                <Input id="schoolName" name="schoolName" required placeholder="t.ex. Björkskolan" />
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">E-post</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Lösenord</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "signin" ? "Logga in" : "Skapa konto"}
          </Button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "signin"
            ? "Ny skola? Skapa ett konto"
            : "Har du redan ett konto? Logga in"}
        </button>

        {mode === "signin" && <SsoSection />}
      </CardContent>
    </Card>
  );
}

/** Skolfederation SAML SSO — start the flow from the school email's domain. */
function SsoSection() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-4 border-t pt-4">
      <form
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            let result: AuthResult;
            try {
              result = await signInWithSso(formData);
            } catch {
              return; // redirect to the IdP
            }
            if (!result.success) setError(result.error);
          });
        }}
        className="space-y-2"
      >
        <Label htmlFor="sso-email" className="text-muted-foreground">
          Logga in med skolkonto (SSO)
        </Label>
        <div className="flex gap-2">
          <Input
            id="sso-email"
            name="email"
            type="email"
            placeholder="namn@kommunen.se"
            autoComplete="email"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            SSO
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </form>
    </div>
  );
}
