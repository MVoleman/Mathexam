import { serve } from "inngest/next";
import { inngest } from "@/lib/queue/inngest";
import { functions } from "@/lib/queue/functions";

/**
 * Inngest worker endpoint. Requests are signed with INNGEST_SIGNING_KEY —
 * that is why /api/inngest is exempt from the auth middleware.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});

// The grading engine and pdf rasterizer need the full Node.js runtime.
export const runtime = "nodejs";
// Give long model calls room on Vercel (Pro allows up to 300s).
export const maxDuration = 300;
