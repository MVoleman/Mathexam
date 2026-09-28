import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTeacher } from "@/lib/auth";
import { buildAuthUrl, isTeamsConfigured } from "@/lib/integrations/microsoft-teams";

/** Starts the Microsoft Teams OAuth flow (teacher must be signed in). */
export async function GET(request: Request) {
  const teacher = await getTeacher();
  if (!teacher) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!isTeamsConfigured()) {
    return NextResponse.redirect(new URL("/students?error=not_configured", request.url));
  }

  const state = randomBytes(16).toString("hex");
  cookies().set("ms_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
