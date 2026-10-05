CREATE TABLE "ability_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"ability" text NOT NULL,
	"level" "difficulty" NOT NULL,
	"points" integer NOT NULL,
	"met" boolean NOT NULL,
	"description" text NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ability_evidence" ADD CONSTRAINT "ability_evidence_result_id_grading_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."grading_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ability_evidence_result_item_uq" ON "ability_evidence" USING btree ("result_id","item_id");--> statement-breakpoint
CREATE INDEX "ability_evidence_ability_idx" ON "ability_evidence" USING btree ("ability");--> statement-breakpoint
-- Server-only: the app reads evidence through the service role (lib/progression.ts).
-- RLS on with no policies denies anon/authenticated access, like share_codes.
ALTER TABLE "ability_evidence" ENABLE ROW LEVEL SECURITY;
