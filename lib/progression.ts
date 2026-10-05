import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  abilityEvidence,
  exams,
  gradingResults,
  questions,
  students,
  studentSubmissions,
} from "@/db/schema";
import { getAbilityLabels } from "@/lib/curriculum/packs";
import type { GradeLevel } from "@/lib/validations/ai-schemas";

export type ExamPoint = {
  examId: string;
  submissionId: string;
  title: string;
  date: Date;
  earned: number;
  available: number;
};

export type EvidenceItem = {
  examTitle: string;
  submissionId: string;
  questionNumber: string;
  level: GradeLevel;
  points: number;
  met: boolean;
  description: string;
  evidence: string;
};

export type AbilityProgression = {
  ability: string;
  label: string;
  /** Per level: one point per exam that tested it, oldest first. */
  levels: Record<GradeLevel, { earned: number; available: number; exams: ExamPoint[] }>;
  evidence: EvidenceItem[];
};

/**
 * A student's ability progression across exams, per ability and level,
 * from the moment-level evidence. Levels are compared separately so exams
 * of different sizes stay comparable.
 */
export async function getStudentProgression(studentId: string, schoolId: string) {
  const student = await db.query.students.findFirst({
    where: and(eq(students.id, studentId), eq(students.schoolId, schoolId)),
  });
  if (!student) return null;

  const rows = await db
    .select({
      examId: exams.id,
      examTitle: exams.title,
      examDate: exams.createdAt,
      curriculum: exams.curriculum,
      submissionId: studentSubmissions.id,
      questionNumber: questions.number,
      ability: abilityEvidence.ability,
      level: abilityEvidence.level,
      points: abilityEvidence.points,
      met: abilityEvidence.met,
      description: abilityEvidence.description,
      evidence: abilityEvidence.evidence,
    })
    .from(abilityEvidence)
    .innerJoin(gradingResults, eq(gradingResults.id, abilityEvidence.resultId))
    .innerJoin(studentSubmissions, eq(studentSubmissions.id, gradingResults.submissionId))
    .innerJoin(exams, eq(exams.id, studentSubmissions.examId))
    .innerJoin(questions, eq(questions.id, gradingResults.questionId))
    .where(and(eq(studentSubmissions.studentRef, studentId), eq(exams.schoolId, schoolId)))
    .orderBy(asc(exams.createdAt), asc(questions.number));

  const labels: Record<string, string> = {};
  for (const r of rows) Object.assign(labels, getAbilityLabels(r.curriculum));

  const byAbility = new Map<string, AbilityProgression>();
  for (const r of rows) {
    let p = byAbility.get(r.ability);
    if (!p) {
      p = {
        ability: r.ability,
        label: labels[r.ability] ?? r.ability,
        levels: {
          E: { earned: 0, available: 0, exams: [] },
          C: { earned: 0, available: 0, exams: [] },
          A: { earned: 0, available: 0, exams: [] },
        },
        evidence: [],
      };
      byAbility.set(r.ability, p);
    }
    const level = p.levels[r.level];
    const earned = r.met ? r.points : 0;
    level.earned += earned;
    level.available += r.points;
    let exam = level.exams.find((e) => e.submissionId === r.submissionId);
    if (!exam) {
      exam = {
        examId: r.examId,
        submissionId: r.submissionId,
        title: r.examTitle,
        date: r.examDate,
        earned: 0,
        available: 0,
      };
      level.exams.push(exam);
    }
    exam.earned += earned;
    exam.available += r.points;
    p.evidence.push({
      examTitle: r.examTitle,
      submissionId: r.submissionId,
      questionNumber: r.questionNumber,
      level: r.level,
      points: r.points,
      met: r.met,
      description: r.description,
      evidence: r.evidence,
    });
  }

  const examCount = new Set(rows.map((r) => r.submissionId)).size;
  return {
    student,
    examCount,
    abilities: [...byAbility.values()].sort((a, b) => a.label.localeCompare(b.label, "sv")),
  };
}
