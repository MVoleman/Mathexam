import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { boolean, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  TranscriptionResult,
  EvaluationResult,
} from "@/lib/validations/ai-schemas";
import type { QuestionFields } from "@/lib/validations/question-schema";
import type { RubricItem } from "@/lib/rubric";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Lgr22 / Gy-style grade levels used for question difficulty. */
export const difficultyEnum = pgEnum("difficulty", ["E", "C", "A"]);

/** Lifecycle of an exam inside the grading pipeline. */
export const examStatusEnum = pgEnum("exam_status", [
  "draft",
  "processing",
  "ready",
  "grading",
  "graded",
  "archived",
]);

/** Review state of a single graded answer. */
export const resultStatusEnum = pgEnum("result_status", [
  "ai_graded",
  "approved",
  "overridden",
]);

/** State of a batch grading job. */
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

/** Role of a user inside a school. */
export const memberRoleEnum = pgEnum("member_role", ["admin", "teacher"]);

/** Where a roster student record came from. */
export const rosterSourceEnum = pgEnum("roster_source", [
  "manual",
  "google_classroom",
  "microsoft_teams",
  "skolfederation",
]);

// ---------------------------------------------------------------------------
// schools (tenant root — every row of school data hangs off this)
// ---------------------------------------------------------------------------

export const schools = pgTable(
  "schools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Swedish organisationsnummer (huvudman), for DPA/procurement paperwork. */
    orgNumber: text("org_number"),
    /**
     * Email domain for SSO auto-join (e.g. "edu.goteborg.se"): users signing
     * in via SAML SSO with this domain join the school as teachers instead
     * of creating a new school. See docs/SSO.md.
     */
    ssoDomain: text("sso_domain"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("schools_sso_domain_uq")
      .on(table.ssoDomain)
      .where(sql`${table.ssoDomain} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// audit_logs (TOM: who accessed/changed which student data, when)
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    /** Acting teacher; null for system/worker events. */
    actorId: uuid("actor_id"),
    /** Dot-namespaced action, e.g. "submission.view", "gdpr.erase". */
    action: text("action").notNull(),
    /** "exam" | "submission" | "result" | "student" | "share_code" | ... */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    /** Small, identifier-free context (counts, titles) — never answer content. */
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_school_created_idx").on(table.schoolId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// profiles (1:1 with auth.users; carries school membership + role)
// ---------------------------------------------------------------------------

export const profiles = pgTable(
  "profiles",
  {
    /** Same UUID as auth.users.id (Supabase Auth). */
    id: uuid("id").primaryKey(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    role: memberRoleEnum("role").notNull().default("teacher"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("profiles_school_id_idx").on(table.schoolId)],
);

// ---------------------------------------------------------------------------
// Types for JSONB columns
// ---------------------------------------------------------------------------

export type GradingLimits = {
  /** Minimum total points for grade E, C and A respectively. */
  E: number;
  C: number;
  A: number;
  /** C (and A) also require at least this many points on C or A level. */
  cLevelMin?: number;
  /** A also requires at least this many points on A level. */
  aLevelMin?: number;
};

/** An AI-extracted question awaiting review; `id` is stable across edits. */
export type QuestionDraft = QuestionFields & { id: string };

// ---------------------------------------------------------------------------
// exams
// ---------------------------------------------------------------------------

export const exams = pgTable("exams", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => profiles.id, {
    onDelete: "set null",
  }),
  /** Curriculum pack id — "lgr22", "gy25", "ib-myp", "ib-dp" (lib/curriculum). */
  curriculum: text("curriculum").notNull().default("lgr22"),
  title: text("title").notNull(),
  course: text("course").notNull(),
  gradeLevel: text("grade_level").notNull(), // e.g. "åk 9", "Ma1c"
  /** Bucket-relative storage path of the original PDF (legacy rows: public URL). */
  pdfUrl: text("pdf_url"),
  /**
   * Bucket-relative storage paths of the rasterized exam pages (legacy rows:
   * public URLs). Signed on demand via lib/storage.ts.
   */
  pageImageUrls: text("page_image_urls").array().notNull().default([]),
  gradingLimits: jsonb("grading_limits").$type<GradingLimits>(),
  /** Show the preliminary grade in the student portal and PDF (teachers always see it). */
  showGradeToStudents: boolean("show_grade_to_students").notNull().default(false),
  /**
   * AI-extracted questions awaiting teacher review. Persisted so a reload or
   * navigation never forces a second (paid) extraction; each draft leaves
   * this list when it is saved as a question or discarded.
   */
  questionDrafts: jsonb("question_drafts").$type<QuestionDraft[]>().notNull().default([]),
  status: examStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("exams_school_id_idx").on(table.schoolId)]);

// ---------------------------------------------------------------------------
// questions
// ---------------------------------------------------------------------------

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    questionText: text("question_text").notNull(),
    number: text("number").notNull(), // "1", "2a", "2b" ...
    topic: text("topic").notNull(), // e.g. "algebra", "geometri"
    difficulty: difficultyEnum("difficulty").notNull(),
    maxPoints: integer("max_points").notNull(),
    correctAnswer: text("correct_answer").notNull(),
    solutionSteps: text("solution_steps"),
    /**
     * Ability CODES from the exam's curriculum pack (lib/curriculum/packs.ts).
     * Column name kept from the Lgr22-only era for migration compatibility.
     */
    lgr22Abilities: text("lgr22_abilities").array().notNull(),
    /**
     * Bedömningsanvisning as moments (lib/rubric.ts). difficulty, maxPoints
     * and lgr22Abilities above are derived from it on every save.
     */
    rubric: jsonb("rubric").$type<RubricItem[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("questions_exam_id_idx").on(table.examId)],
);

// ---------------------------------------------------------------------------
// student_submissions
// ---------------------------------------------------------------------------

export const studentSubmissions = pgTable(
  "student_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull(),
    /** Optional link to a synced roster student (Google Classroom etc.). */
    studentRef: uuid("student_ref").references(() => students.id, {
      onDelete: "set null",
    }),
    /**
     * Bucket-relative storage paths of the solution page images (legacy
     * rows: public URLs). Signed on demand via lib/storage.ts.
     */
    imageUrls: text("image_urls").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("student_submissions_exam_id_idx").on(table.examId)],
);

// ---------------------------------------------------------------------------
// solution_references (RAG knowledge base)
// ---------------------------------------------------------------------------

export const solutionReferences = pgTable(
  "solution_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id").references(() => questions.id, {
      onDelete: "set null",
    }),
    // Metadata columns for exact-match pre-filtering in hybrid search.
    course: text("course").notNull(),
    topic: text("topic").notNull(),
    correctSolution: text("correct_solution").notNull(),
    commonPitfalls: text("common_pitfalls"),
    partialCreditRules: text("partial_credit_rules"),
    /** "manual" (teacher-authored) or "teacher_override" (learning flywheel). */
    source: text("source").notNull().default("manual"),
    // 768 dims — gemini-embedding-001 MRL-truncated (see lib/ai/models.ts).
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // HNSW index for fast approximate cosine-similarity search.
    index("solution_references_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    // B-tree index supporting the metadata pre-filter.
    index("solution_references_course_topic_idx").on(table.course, table.topic),
  ],
);

// ---------------------------------------------------------------------------
// grading_results (one AI-graded answer, per submission × question)
// ---------------------------------------------------------------------------

export const gradingResults = pgTable(
  "grading_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => studentSubmissions.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    transcription: jsonb("transcription").$type<TranscriptionResult>().notNull(),
    evaluation: jsonb("evaluation").$type<EvaluationResult>().notNull(),
    /** Final points: AI's award, or the teacher's override. */
    awardedPoints: real("awarded_points").notNull(),
    /** Points from the independent second-opinion grader, when dual grading ran. */
    secondOpinionPoints: real("second_opinion_points"),
    status: resultStatusEnum("status").notNull().default("ai_graded"),
    needsHumanReview: boolean("needs_human_review").notNull().default(false),
    teacherComment: text("teacher_comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("grading_results_submission_question_uq").on(
      table.submissionId,
      table.questionId,
    ),
    index("grading_results_needs_review_idx").on(table.needsHumanReview),
  ],
);

// ---------------------------------------------------------------------------
// ability_evidence — one row per moment of a graded answer
// ---------------------------------------------------------------------------

/**
 * Snapshot of each moment's outcome when an answer is graded or corrected:
 * the basis of a student's ability progression across exams. Snapshotting
 * keeps history stable when a bedömningsanvisning is edited later; the
 * student comes from the submission (student_ref), so relinking a
 * submission needs no rewrite here.
 */
export const abilityEvidence = pgTable(
  "ability_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => gradingResults.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    ability: text("ability").notNull(),
    level: difficultyEnum("level").notNull(),
    points: integer("points").notNull(),
    met: boolean("met").notNull(),
    /** The moment's text at grading time, for drill-down. */
    description: text("description").notNull(),
    /** The grader's (or teacher's) evidence quote. */
    evidence: text("evidence").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ability_evidence_result_item_uq").on(table.resultId, table.itemId),
    index("ability_evidence_ability_idx").on(table.ability),
  ],
);

export type AbilityEvidence = typeof abilityEvidence.$inferSelect;

// ---------------------------------------------------------------------------
// grading_jobs (batch pipeline tracking)
// ---------------------------------------------------------------------------

export const gradingJobs = pgTable(
  "grading_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    status: jobStatusEnum("status").notNull().default("queued"),
    totalItems: integer("total_items").notNull().default(0),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("grading_jobs_exam_id_idx").on(table.examId)],
);

// ---------------------------------------------------------------------------
// students (roster — synced from Google Classroom / Teams, or manual)
// ---------------------------------------------------------------------------

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    source: rosterSourceEnum("source").notNull().default("manual"),
    /** Provider-side id (Google userId etc.); null for manual entries. */
    externalId: text("external_id"),
    fullName: text("full_name").notNull(),
    email: text("email"),
    /** Class/course label, e.g. "9A" or the Classroom course name. */
    className: text("class_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("students_school_id_idx").on(table.schoolId),
    uniqueIndex("students_school_source_external_uq")
      .on(table.schoolId, table.source, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// integration_connections (per-teacher OAuth tokens for roster providers)
// ---------------------------------------------------------------------------

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    /** "google_classroom" | "microsoft_teams" (see lib/integrations). */
    provider: text("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    /** Epoch ms when the access token expires. */
    expiryDate: timestamp("expiry_date", { withTimezone: true }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_connections_profile_provider_uq").on(
      table.profileId,
      table.provider,
    ),
  ],
);

// ---------------------------------------------------------------------------
// share_codes (student/guardian portal access to one submission's report)
// ---------------------------------------------------------------------------

export const shareCodes = pgTable(
  "share_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Exactly one of submissionId/studentId is set:
     * - submissionId → code opens ONE report (original behavior)
     * - studentId    → code opens ALL of a roster student's reports
     */
    submissionId: uuid("submission_id").references(() => studentSubmissions.id, {
      onDelete: "cascade",
    }),
    studentId: uuid("student_id").references(() => students.id, {
      onDelete: "cascade",
    }),
    /** SHA-256(code + SHARE_CODE_PEPPER) — raw codes are never stored. */
    codeHash: text("code_hash").notNull(),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("share_codes_code_hash_uq").on(table.codeHash),
    index("share_codes_submission_id_idx").on(table.submissionId),
  ],
);

// ---------------------------------------------------------------------------
// Golden-set evals (versioned corpus of consented teacher-graded answers)
// ---------------------------------------------------------------------------

export const goldenSets = pgTable("golden_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").references(() => schools.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  /** Frozen sets reject new items so eval runs stay comparable over time. */
  frozen: boolean("frozen").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GoldenQuestionSnapshot = {
  questionText: string;
  number: string;
  topic: string;
  difficulty: "E" | "C" | "A";
  maxPoints: number;
  correctAnswer: string;
  solutionSteps: string | null;
  abilities: string[];
  /** Moments at capture time (absent on items captured before moments). */
  rubric?: RubricItem[];
  course: string;
  curriculum: string;
};

export const goldenItems = pgTable(
  "golden_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => goldenSets.id, { onDelete: "cascade" }),
    /** Frozen copy of the question at capture time — survives question edits. */
    questionSnapshot: jsonb("question_snapshot")
      .$type<GoldenQuestionSnapshot>()
      .notNull(),
    /** The student's transcribed answer (no images, no student identity). */
    transcription: jsonb("transcription").$type<TranscriptionResult>().notNull(),
    /** Ground truth: what the teacher finally awarded. */
    teacherPoints: real("teacher_points").notNull(),
    teacherComment: text("teacher_comment"),
    /** Where it came from (result id at capture time; not a FK on purpose). */
    sourceResultId: uuid("source_result_id"),
    /** GDPR: item may only be captured with verified consent. */
    consentConfirmed: boolean("consent_confirmed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("golden_items_set_id_idx").on(table.setId)],
);

export type EvalRunConfig = {
  gradingModel: string;
  secondOpinionModel: string;
  dualGrading: string;
  label?: string;
};

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => goldenSets.id, { onDelete: "cascade" }),
    config: jsonb("config").$type<EvalRunConfig>().notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    totalItems: integer("total_items").notNull().default(0),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    /** Aggregates, filled when the run completes. */
    exactAgreementPct: real("exact_agreement_pct"),
    meanAbsError: real("mean_abs_error"),
    withinHalfPointPct: real("within_half_point_pct"),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("eval_runs_set_id_idx").on(table.setId)],
);

export const evalResults = pgTable(
  "eval_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => goldenItems.id, { onDelete: "cascade" }),
    aiPoints: real("ai_points").notNull(),
    teacherPoints: real("teacher_points").notNull(),
    absError: real("abs_error").notNull(),
    evaluation: jsonb("evaluation").$type<EvaluationResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("eval_results_run_item_uq").on(table.runId, table.itemId)],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const schoolsRelations = relations(schools, ({ many }) => ({
  profiles: many(profiles),
  exams: many(exams),
  students: many(students),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  school: one(schools, { fields: [profiles.schoolId], references: [schools.id] }),
}));

export const examsRelations = relations(exams, ({ one, many }) => ({
  school: one(schools, { fields: [exams.schoolId], references: [schools.id] }),
  questions: many(questions),
  submissions: many(studentSubmissions),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  school: one(schools, { fields: [students.schoolId], references: [schools.id] }),
  submissions: many(studentSubmissions),
}));

export const shareCodesRelations = relations(shareCodes, ({ one }) => ({
  submission: one(studentSubmissions, {
    fields: [shareCodes.submissionId],
    references: [studentSubmissions.id],
  }),
}));

export const goldenSetsRelations = relations(goldenSets, ({ many }) => ({
  items: many(goldenItems),
  runs: many(evalRuns),
}));

export const goldenItemsRelations = relations(goldenItems, ({ one }) => ({
  set: one(goldenSets, { fields: [goldenItems.setId], references: [goldenSets.id] }),
}));

export const evalRunsRelations = relations(evalRuns, ({ one, many }) => ({
  set: one(goldenSets, { fields: [evalRuns.setId], references: [goldenSets.id] }),
  results: many(evalResults),
}));

export const evalResultsRelations = relations(evalResults, ({ one }) => ({
  run: one(evalRuns, { fields: [evalResults.runId], references: [evalRuns.id] }),
  item: one(goldenItems, {
    fields: [evalResults.itemId],
    references: [goldenItems.id],
  }),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  exam: one(exams, { fields: [questions.examId], references: [exams.id] }),
  solutionReferences: many(solutionReferences),
}));

export const studentSubmissionsRelations = relations(studentSubmissions, ({ one, many }) => ({
  exam: one(exams, { fields: [studentSubmissions.examId], references: [exams.id] }),
  student: one(students, {
    fields: [studentSubmissions.studentRef],
    references: [students.id],
  }),
  results: many(gradingResults),
  shareCodes: many(shareCodes),
}));

export const abilityEvidenceRelations = relations(abilityEvidence, ({ one }) => ({
  result: one(gradingResults, {
    fields: [abilityEvidence.resultId],
    references: [gradingResults.id],
  }),
}));

export const gradingResultsRelations = relations(gradingResults, ({ one, many }) => ({
  evidence: many(abilityEvidence),
  submission: one(studentSubmissions, {
    fields: [gradingResults.submissionId],
    references: [studentSubmissions.id],
  }),
  question: one(questions, {
    fields: [gradingResults.questionId],
    references: [questions.id],
  }),
}));

export const gradingJobsRelations = relations(gradingJobs, ({ one }) => ({
  exam: one(exams, { fields: [gradingJobs.examId], references: [exams.id] }),
}));

export const solutionReferencesRelations = relations(solutionReferences, ({ one }) => ({
  question: one(questions, {
    fields: [solutionReferences.questionId],
    references: [questions.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Exam = typeof exams.$inferSelect;
export type NewExam = typeof exams.$inferInsert;
export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type StudentSubmission = typeof studentSubmissions.$inferSelect;
export type NewStudentSubmission = typeof studentSubmissions.$inferInsert;
export type SolutionReference = typeof solutionReferences.$inferSelect;
export type NewSolutionReference = typeof solutionReferences.$inferInsert;
export type GradingResult = typeof gradingResults.$inferSelect;
export type NewGradingResult = typeof gradingResults.$inferInsert;
export type GradingJob = typeof gradingJobs.$inferSelect;
export type NewGradingJob = typeof gradingJobs.$inferInsert;
export type School = typeof schools.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type ShareCode = typeof shareCodes.$inferSelect;
export type GoldenSet = typeof goldenSets.$inferSelect;
export type GoldenItem = typeof goldenItems.$inferSelect;
export type NewGoldenItem = typeof goldenItems.$inferInsert;
export type EvalRun = typeof evalRuns.$inferSelect;
export type EvalResult = typeof evalResults.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
