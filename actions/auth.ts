"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { profiles, schools } from "@/db/schema";
import { createServerSupabase } from "@/lib/supabase/server";

export type AuthResult = { success: true } | { success: false; error: string };

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

const SignInSchema = z.object({
  email: z.string().email("Ogiltig e-postadress."),
  password: z.string().min(1, "Lösenord krävs."),
});

export async function signIn(formData: FormData): Promise<AuthResult> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const supabase = createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { success: false, error: "Fel e-post eller lösenord." };

  redirect("/");
}

// ---------------------------------------------------------------------------
// SSO sign-in (Skolfederation SAML via Supabase Auth) — see docs/SSO.md.
// The user enters their school email; we start the SAML flow for its domain.
// ---------------------------------------------------------------------------

const SsoSchema = z.object({
  email: z.string().email("Ange din skol-e-postadress."),
});

export async function signInWithSso(formData: FormData): Promise<AuthResult> {
  const parsed = SsoSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const domain = parsed.data.email.split("@")[1]?.toLowerCase();
  if (!domain) return { success: false, error: "Ogiltig e-postadress." };

  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.signInWithSSO({ domain });
  if (error || !data?.url) {
    return {
      success: false,
      error:
        "Ingen SSO-anslutning finns för din skolas domän ännu. Logga in med e-post och lösenord, eller be skolans administratör kontakta oss.",
    };
  }

  redirect(data.url);
}

// ---------------------------------------------------------------------------
// Sign up — creates the auth user, a school, and the teacher profile.
// First user of a school becomes its admin.
// ---------------------------------------------------------------------------

const SignUpSchema = z.object({
  email: z.string().email("Ogiltig e-postadress."),
  password: z.string().min(8, "Lösenordet måste vara minst 8 tecken."),
  fullName: z.string().trim().min(1, "Namn krävs."),
  schoolName: z.string().trim().min(1, "Skolans namn krävs."),
});

export async function signUp(formData: FormData): Promise<AuthResult> {
  const parsed = SignUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
    schoolName: formData.get("schoolName"),
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };
  const input = parsed.data;

  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { full_name: input.fullName } },
  });
  if (error || !data.user) {
    return { success: false, error: error?.message ?? "Registreringen misslyckades." };
  }

  // Idempotent: signUp can return an existing unconfirmed user.
  const existing = await db.query.profiles.findFirst({
    where: eq(profiles.id, data.user.id),
  });
  if (!existing) {
    const [school] = await db
      .insert(schools)
      .values({ name: input.schoolName })
      .returning();
    await db.insert(profiles).values({
      id: data.user.id,
      schoolId: school.id,
      email: input.email,
      fullName: input.fullName,
      role: "admin",
    });
  }

  // With email confirmation enabled there is no session yet.
  if (!data.session) return { success: true };

  redirect("/");
}

// ---------------------------------------------------------------------------
// Onboarding — fallback for confirmed users without a profile yet
// ---------------------------------------------------------------------------

/**
 * SSO auto-join: if the signed-in user's email domain matches a school's
 * sso_domain, create their teacher profile in that school. Returns true if
 * a profile now exists.
 */
export async function joinSchoolByDomain(): Promise<boolean> {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return false;

  const existing = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
    columns: { id: true },
  });
  if (existing) return true;

  const domain = user.email.split("@")[1]?.toLowerCase();
  if (!domain) return false;

  const school = await db.query.schools.findFirst({
    where: eq(schools.ssoDomain, domain),
    columns: { id: true },
  });
  if (!school) return false;

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email.split("@")[0];

  await db.insert(profiles).values({
    id: user.id,
    schoolId: school.id,
    email: user.email,
    fullName,
    role: "teacher",
  });
  return true;
}

const OnboardingSchema = z.object({
  fullName: z.string().trim().min(1, "Namn krävs."),
  schoolName: z.string().trim().min(1, "Skolans namn krävs."),
});

export async function completeOnboarding(formData: FormData): Promise<AuthResult> {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = OnboardingSchema.safeParse({
    fullName: formData.get("fullName"),
    schoolName: formData.get("schoolName"),
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  const existing = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  });
  if (!existing) {
    const [school] = await db
      .insert(schools)
      .values({ name: parsed.data.schoolName })
      .returning();
    await db.insert(profiles).values({
      id: user.id,
      schoolId: school.id,
      email: user.email ?? "",
      fullName: parsed.data.fullName,
      role: "admin",
    });
  }

  redirect("/");
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

export async function signOut(): Promise<void> {
  const supabase = createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
