import { EventSchemas, Inngest } from "inngest";

/**
 * Inngest client. Payloads carry ROW IDS ONLY — never student images,
 * transcriptions or names (GDPR: only orchestration metadata leaves the app;
 * see docs/GDPR.md). Point INNGEST_BASE_URL at https://api.eu.inngest.com
 * for EU data residency.
 */
type Events = {
  "grading/job.created": { data: { jobId: string } };
  "exam/pdf.process": { data: { examId: string } };
  "evals/run.requested": { data: { setId: string; label: string | null } };
};

export const inngest = new Inngest({
  id: "deepgrader",
  schemas: new EventSchemas().fromRecord<Events>(),
  ...(process.env.INNGEST_BASE_URL ? { baseUrl: process.env.INNGEST_BASE_URL } : {}),
});

/** True when events should go through Inngest instead of running in-process. */
export const queueEnabled = () => Boolean(process.env.INNGEST_EVENT_KEY);
