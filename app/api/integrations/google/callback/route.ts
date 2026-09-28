import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTeacher } from "@/lib/auth";
import { storeTokensFromCallback } from "@/lib/integrations/google-classroom";

/** Google OAuth callback: validates state, stores tokens, back to /students. */
export async function GET(request: Request) {
  const teacher = await getTeacher();
  if (!teacher) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = cookies().get("gc_oauth_state")?.value;
  cookies().delete("gc_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/students?error=oauth_state", request.url));
  }

  try {
    await storeTokensFromCallback({
      code,
      profileId: teacher.id,
      schoolId: teacher.schoolId,
    });
  } catch (err) {
    console.error("Google Classroom OAuth failed:", err);
    return NextResponse.redirect(new URL("/students?error=oauth_failed", request.url));
  }

  return NextResponse.redirect(new URL("/students?connected=1", request.url));
}
