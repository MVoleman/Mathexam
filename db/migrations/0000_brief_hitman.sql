CREATE TYPE "public"."difficulty" AS ENUM('E', 'C', 'A');--> statement-breakpoint
CREATE TYPE "public"."exam_status" AS ENUM('draft', 'processing', 'ready', 'grading', 'graded', 'archived');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('admin', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."result_status" AS ENUM('ai_graded', 'approved', 'overridden');--> statement-breakpoint
CREATE TYPE "public"."roster_source" AS ENUM('manual', 'google_classroom', 'microsoft_teams', 'skolfederation');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ai_points" real NOT NULL,
	"teacher_points" real NOT NULL,
	"abs_error" real NOT NULL,
	"evaluation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"exact_agreement_pct" real,
	"mean_abs_error" real,
	"within_half_point_pct" real,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"created_by" uuid,
	"curriculum" text DEFAULT 'lgr22' NOT NULL,
	"title" text NOT NULL,
	"course" text NOT NULL,
	"grade_level" text NOT NULL,
	"pdf_url" text,
	"page_image_urls" text[] DEFAULT '{}' NOT NULL,
	"grading_limits" jsonb,
	"status" "exam_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "golden_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"set_id" uuid NOT NULL,
	"question_snapshot" jsonb NOT NULL,
	"transcription" jsonb NOT NULL,
	"teacher_points" real NOT NULL,
	"teacher_comment" text,
	"source_result_id" uuid,
	"consent_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "golden_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"transcription" jsonb NOT NULL,
	"evaluation" jsonb NOT NULL,
	"awarded_points" real NOT NULL,
	"second_opinion_points" real,
	"status" "result_status" DEFAULT 'ai_graded' NOT NULL,
	"needs_human_review" boolean DEFAULT false NOT NULL,
	"teacher_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expiry_date" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "member_role" DEFAULT 'teacher' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"question_text" text NOT NULL,
	"number" text NOT NULL,
	"topic" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"max_points" integer NOT NULL,
	"correct_answer" text NOT NULL,
	"solution_steps" text,
	"lgr22_abilities" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"org_number" text,
	"sso_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid,
	"student_id" uuid,
	"code_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solution_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid,
	"course" text NOT NULL,
	"topic" text NOT NULL,
	"correct_solution" text NOT NULL,
	"common_pitfalls" text,
	"partial_credit_rules" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"student_ref" uuid,
	"image_urls" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"source" "roster_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"full_name" text NOT NULL,
	"email" text,
	"class_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_item_id_golden_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."golden_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_set_id_golden_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."golden_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_items" ADD CONSTRAINT "golden_items_set_id_golden_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."golden_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_sets" ADD CONSTRAINT "golden_sets_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_jobs" ADD CONSTRAINT "grading_jobs_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_results" ADD CONSTRAINT "grading_results_submission_id_student_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."student_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_results" ADD CONSTRAINT "grading_results_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_codes" ADD CONSTRAINT "share_codes_submission_id_student_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."student_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_codes" ADD CONSTRAINT "share_codes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_codes" ADD CONSTRAINT "share_codes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution_references" ADD CONSTRAINT "solution_references_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_submissions" ADD CONSTRAINT "student_submissions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_submissions" ADD CONSTRAINT "student_submissions_student_ref_students_id_fk" FOREIGN KEY ("student_ref") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_school_created_idx" ON "audit_logs" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_results_run_item_uq" ON "eval_results" USING btree ("run_id","item_id");--> statement-breakpoint
CREATE INDEX "eval_runs_set_id_idx" ON "eval_runs" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "exams_school_id_idx" ON "exams" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "golden_items_set_id_idx" ON "golden_items" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "grading_jobs_exam_id_idx" ON "grading_jobs" USING btree ("exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_results_submission_question_uq" ON "grading_results" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "grading_results_needs_review_idx" ON "grading_results" USING btree ("needs_human_review");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_profile_provider_uq" ON "integration_connections" USING btree ("profile_id","provider");--> statement-breakpoint
CREATE INDEX "profiles_school_id_idx" ON "profiles" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "questions_exam_id_idx" ON "questions" USING btree ("exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_sso_domain_uq" ON "schools" USING btree ("sso_domain") WHERE "schools"."sso_domain" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "share_codes_code_hash_uq" ON "share_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "share_codes_submission_id_idx" ON "share_codes" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "solution_references_embedding_hnsw_idx" ON "solution_references" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "solution_references_course_topic_idx" ON "solution_references" USING btree ("course","topic");--> statement-breakpoint
CREATE INDEX "student_submissions_exam_id_idx" ON "student_submissions" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "students_school_id_idx" ON "students" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_school_source_external_uq" ON "students" USING btree ("school_id","source","external_id") WHERE "students"."external_id" IS NOT NULL;