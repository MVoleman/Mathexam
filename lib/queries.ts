import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  evalRuns,
  exams,
  goldenItems,
  goldenSets,
  questions,
  studentSubmissions,
  gradingResults,
  gradingJobs,
  type Exam,
} from "@/db/schema";
import type { Lgr22Ability } from "@/lib/validations/ai-schemas";

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getDashboardStats(schoolId: string) {
  const [[examCount], [submissionCount], [pendingReview], [gradedCount]] =
    await Promise.all([
      db.select({ value: count() }).from(exams).where(eq(exams.schoolId, schoolId)),
      db
        .select({ value: count() })
        .from(studentSubmissions)
        .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
        .where(eq(exams.schoolId, schoolId)),
      db
        .select({ value: count() })
        .from(gradingResults)
        .innerJoin(
          studentSubmissions,
          eq(studentSubmissions.id, gradingResults.submissionId),
        )
        .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
        .where(
          and(eq(gradingResults.needsHumanReview, true), eq(exams.schoolId, schoolId)),
        ),
      db
        .select({ value: count() })
        .from(gradingResults)
        .innerJoin(
          studentSubmissions,
          eq(studentSubmissions.id, gradingResults.submissionId),
        )
        .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
        .where(eq(exams.schoolId, schoolId)),
    ]);

  return {
    exams: examCount.value,
    submissions: submissionCount.value,
    gradedAnswers: gradedCount.value,
    pendingReview: pendingReview.value,
  };
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

// Correlated subqueries below spell out "table"."column" by hand: Drizzle
// renders ${table.col} unqualified inside sql``, so an outer ${exams.id}
// would silently bind to the inner table's own "id" and count nothing.
export async function getExamsList(schoolId: string) {
  return db
    .select({
      exam: exams,
      submissionCount: sql<number>`(
        SELECT count(*)::int FROM ${studentSubmissions}
        WHERE "student_submissions"."exam_id" = "exams"."id"
      )`,
      questionCount: sql<number>`(
        SELECT count(*)::int FROM ${questions}
        WHERE "questions"."exam_id" = "exams"."id"
      )`,
    })
    .from(exams)
    .where(eq(exams.schoolId, schoolId))
    .orderBy(desc(exams.createdAt));
}

export async function getExamDetail(examId: string, schoolId: string) {
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, examId), eq(exams.schoolId, schoolId)),
  });
  if (!exam) return null;

  const [examQuestions, submissions, latestJob] = await Promise.all([
    db.query.questions.findMany({
      where: eq(questions.examId, examId),
      orderBy: asc(questions.number),
    }),
    db
      .select({
        id: studentSubmissions.id,
        studentId: studentSubmissions.studentId,
        imageCount: sql<number>`coalesce(array_length(${studentSubmissions.imageUrls}, 1), 0)`,
        gradedCount: sql<number>`(
          SELECT count(*)::int FROM ${gradingResults}
          WHERE "grading_results"."submission_id" = "student_submissions"."id"
        )`,
        needsReviewCount: sql<number>`(
          SELECT count(*)::int FROM ${gradingResults}
          WHERE "grading_results"."submission_id" = "student_submissions"."id"
            AND ${gradingResults.needsHumanReview} = true
        )`,
        totalPoints: sql<number>`coalesce((
          SELECT sum(${gradingResults.awardedPoints}) FROM ${gradingResults}
          WHERE "grading_results"."submission_id" = "student_submissions"."id"
        ), 0)`,
      })
      .from(studentSubmissions)
      .where(eq(studentSubmissions.examId, examId))
      .orderBy(asc(studentSubmissions.studentId)),
    db.query.gradingJobs.findFirst({
      where: eq(gradingJobs.examId, examId),
      orderBy: desc(gradingJobs.createdAt),
    }),
  ]);

  return { exam, questions: examQuestions, submissions, latestJob: latestJob ?? null };
}

// ---------------------------------------------------------------------------
// Review workflow
// ---------------------------------------------------------------------------

export async function getSubmissionForReview(submissionId: string, schoolId: string) {
  const submission = await db.query.studentSubmissions.findFirst({
    where: eq(studentSubmissions.id, submissionId),
    with: {
      exam: true,
      results: { with: { question: true } },
    },
  });
  if (!submission || submission.exam.schoolId !== schoolId) return null;

  submission.results.sort((a, b) =>
    a.question.number.localeCompare(b.question.number, "sv", { numeric: true }),
  );

  return submission;
}

// ---------------------------------------------------------------------------
// Class analytics
// ---------------------------------------------------------------------------

export type TopicStat = {
  topic: string;
  difficulty: string;
  avgPct: number;
  answers: number;
};
export type AbilityStat = { ability: Lgr22Ability; demonstratedRate: number };
export type PitfallStat = { pitfall: string; occurrences: number };
export type StudentTotal = { studentId: string; submissionId: string; total: number };

export async function getExamAnalytics(examId: string, schoolId: string) {
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, examId), eq(exams.schoolId, schoolId)),
  });
  if (!exam) return null;

  const topicStats = await db
    .select({
      topic: questions.topic,
      difficulty: questions.difficulty,
      avgPct: sql<number>`round(avg(${gradingResults.awardedPoints} / ${questions.maxPoints}) * 100)::int`,
      answers: count(gradingResults.id),
    })
    .from(gradingResults)
    .innerJoin(questions, eq(gradingResults.questionId, questions.id))
    .where(eq(questions.examId, examId))
    .groupBy(questions.topic, questions.difficulty)
    .orderBy(asc(questions.topic));

  const abilityRows = await db.execute(sql`
    SELECT a.value->>'ability' AS ability,
           round(avg(CASE WHEN (a.value->>'demonstrated')::boolean THEN 1.0 ELSE 0.0 END) * 100)::int AS rate
    FROM ${gradingResults} gr
    JOIN ${studentSubmissions} ss ON ss.id = gr.submission_id
    CROSS JOIN LATERAL jsonb_array_elements(gr.evaluation->'lgr22Assessment') AS a(value)
    WHERE ss.exam_id = ${examId}
    GROUP BY a.value->>'ability'
    ORDER BY rate ASC
  `);

  const pitfallRows = await db.execute(sql`
    SELECT p.value AS pitfall, count(*)::int AS occurrences
    FROM ${gradingResults} gr
    JOIN ${studentSubmissions} ss ON ss.id = gr.submission_id
    CROSS JOIN LATERAL jsonb_array_elements_text(gr.evaluation->'identifiedPitfalls') AS p(value)
    WHERE ss.exam_id = ${examId}
    GROUP BY p.value
    ORDER BY occurrences DESC
    LIMIT 10
  `);

  const studentTotals = await db
    .select({
      studentId: studentSubmissions.studentId,
      submissionId: studentSubmissions.id,
      total: sql<number>`coalesce(sum(${gradingResults.awardedPoints}), 0)`,
    })
    .from(studentSubmissions)
    .leftJoin(gradingResults, eq(gradingResults.submissionId, studentSubmissions.id))
    .where(eq(studentSubmissions.examId, examId))
    .groupBy(studentSubmissions.id, studentSubmissions.studentId)
    .orderBy(desc(sql`coalesce(sum(${gradingResults.awardedPoints}), 0)`));

  return {
    exam,
    topicStats: topicStats as TopicStat[],
    abilityStats: (abilityRows as unknown as { ability: Lgr22Ability; rate: number }[]).map(
      (r) => ({ ability: r.ability, demonstratedRate: Number(r.rate) }),
    ) as AbilityStat[],
    pitfalls: (pitfallRows as unknown as PitfallStat[]).map((r) => ({
      pitfall: r.pitfall,
      occurrences: Number(r.occurrences),
    })),
    studentTotals: (studentTotals as StudentTotal[]).map((r) => ({
      ...r,
      total: Number(r.total),
    })),
    gradeDistribution: computeGradeDistribution(
      studentTotals.map((r) => Number(r.total)),
      exam.gradingLimits,
    ),
  };
}

export type GradeBucket = { grade: "F" | "E" | "C" | "A"; students: number };

function computeGradeDistribution(
  totals: number[],
  limits: Exam["gradingLimits"],
): GradeBucket[] {
  const buckets: Record<GradeBucket["grade"], number> = { F: 0, E: 0, C: 0, A: 0 };
  for (const total of totals) {
    if (!limits) {
      buckets.F += 1;
      continue;
    }
    if (total >= limits.A) buckets.A += 1;
    else if (total >= limits.C) buckets.C += 1;
    else if (total >= limits.E) buckets.E += 1;
    else buckets.F += 1;
  }
  return (Object.entries(buckets) as [GradeBucket["grade"], number][]).map(
    ([grade, students]) => ({ grade, students }),
  );
}

// ---------------------------------------------------------------------------
// Golden-set evals
// ---------------------------------------------------------------------------

export async function getEvalOverview(schoolId: string) {
  const sets = await db
    .select({
      set: goldenSets,
      itemCount: sql<number>`(
        SELECT count(*)::int FROM ${goldenItems}
        WHERE "golden_items"."set_id" = "golden_sets"."id"
      )`,
    })
    .from(goldenSets)
    .where(or(eq(goldenSets.schoolId, schoolId), isNull(goldenSets.schoolId)))
    .orderBy(desc(goldenSets.createdAt));

  const setIds = sets.map((s) => s.set.id);
  const runs =
    setIds.length === 0
      ? []
      : await db.query.evalRuns.findMany({
          where: inArray(evalRuns.setId, setIds),
          orderBy: desc(evalRuns.createdAt),
          limit: 50,
        });

  return { sets, runs };
}

/** School-owned golden sets a review can capture into (not frozen). */
export async function getCapturableGoldenSets(schoolId: string) {
  return db.query.goldenSets.findMany({
    where: and(eq(goldenSets.schoolId, schoolId), eq(goldenSets.frozen, false)),
    orderBy: desc(goldenSets.createdAt),
  });
}

// ---------------------------------------------------------------------------
// Student report
// ---------------------------------------------------------------------------

export async function getStudentReport(
  examId: string,
  submissionId: string,
  /** Pass null only from the share-code portal, which authorizes by code. */
  schoolId: string | null,
) {
  const submission = await db.query.studentSubmissions.findFirst({
    where: and(
      eq(studentSubmissions.id, submissionId),
      eq(studentSubmissions.examId, examId),
    ),
    with: { exam: true, results: { with: { question: true } } },
  });
  if (!submission) return null;
  if (schoolId !== null && submission.exam.schoolId !== schoolId) return null;

  submission.results.sort((a, b) =>
    a.question.number.localeCompare(b.question.number, "sv", { numeric: true }),
  );

  const totalPoints = submission.results.reduce((s, r) => s + r.awardedPoints, 0);
  const maxPoints = submission.results.reduce((s, r) => s + r.question.maxPoints, 0);

  // Ability summary across all answers.
  const abilityMap = new Map<Lgr22Ability, { demonstrated: number; assessed: number }>();
  for (const result of submission.results) {
    for (const a of result.evaluation.lgr22Assessment) {
      const entry = abilityMap.get(a.ability) ?? { demonstrated: 0, assessed: 0 };
      entry.assessed += 1;
      if (a.demonstrated) entry.demonstrated += 1;
      abilityMap.set(a.ability, entry);
    }
  }

  const limits = submission.exam.gradingLimits;
  const grade = !limits
    ? null
    : totalPoints >= limits.A
      ? "A"
      : totalPoints >= limits.C
        ? "C"
        : totalPoints >= limits.E
          ? "E"
          : "F";

  return {
    submission,
    totalPoints,
    maxPoints,
    grade,
    abilities: [...abilityMap.entries()].map(([ability, v]) => ({
      ability,
      rate: v.assessed === 0 ? 0 : Math.round((v.demonstrated / v.assessed) * 100),
    })),
  };
}
