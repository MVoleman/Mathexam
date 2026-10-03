"use server";

import { randomUUID } from "node:crypto";
import { generateObject } from "ai";
import { extractionModel } from "@/lib/ai/models";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { exams, questions, type Question, type QuestionDraft } from "@/db/schema";
import { ExamExtractionSchema } from "@/lib/validations/ai-schemas";
import {
  QuestionFieldsSchema,
  normalizeDraft,
  questionColumns,
  type QuestionFields,
} from "@/lib/validations/question-schema";
import { requireTeacher } from "@/lib/auth";
import { abilityPromptBlock, getPack } from "@/lib/curriculum/packs";
import { PAGES_BUCKET, resolveStorageUrls } from "@/lib/storage";

/** The question's exam, iff the question belongs to the teacher's school. */
async function findQuestionInSchool(questionId: string, schoolId: string) {
  const question = await db.query.questions.findFirst({
    where: eq(questions.id, questionId),
    with: { exam: { columns: { schoolId: true } } },
  });
  if (!question || question.exam.schoolId !== schoolId) return null;
  return question;
}

export type QuestionActionResult =
  | { success: true; question: Question }
  | { success: false; error: string };

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createQuestion(
  examId: string,
  rawFields: QuestionFields,
): Promise<QuestionActionResult> {
  const examIdParsed = z.string().uuid().safeParse(examId);
  if (!examIdParsed.success) return { success: false, error: "Ogiltigt prov-id." };

  const fields = QuestionFieldsSchema.safeParse(rawFields);
  if (!fields.success) return { success: false, error: fields.error.issues[0].message };

  const teacher = await requireTeacher();
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, examIdParsed.data), eq(exams.schoolId, teacher.schoolId)),
  });
  if (!exam) return { success: false, error: "Provet hittades inte." };

  const [question] = await db
    .insert(questions)
    .values({ examId: examIdParsed.data, ...questionColumns(fields.data) })
    .returning();

  revalidatePath(`/exams/${examId}`);
  revalidatePath(`/exams/${examId}/questions`);
  return { success: true, question };
}

export async function updateQuestion(
  questionId: string,
  rawFields: QuestionFields,
): Promise<QuestionActionResult> {
  const idParsed = z.string().uuid().safeParse(questionId);
  if (!idParsed.success) return { success: false, error: "Ogiltigt fråge-id." };

  const fields = QuestionFieldsSchema.safeParse(rawFields);
  if (!fields.success) return { success: false, error: fields.error.issues[0].message };

  const teacher = await requireTeacher();
  const owned = await findQuestionInSchool(idParsed.data, teacher.schoolId);
  if (!owned) return { success: false, error: "Frågan hittades inte." };

  const [question] = await db
    .update(questions)
    .set(questionColumns(fields.data))
    .where(eq(questions.id, idParsed.data))
    .returning();

  if (!question) return { success: false, error: "Frågan hittades inte." };

  revalidatePath(`/exams/${question.examId}`);
  revalidatePath(`/exams/${question.examId}/questions`);
  return { success: true, question };
}

export async function deleteQuestion(
  questionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const idParsed = z.string().uuid().safeParse(questionId);
  if (!idParsed.success) return { success: false, error: "Ogiltigt fråge-id." };

  const teacher = await requireTeacher();
  const owned = await findQuestionInSchool(idParsed.data, teacher.schoolId);
  if (!owned) return { success: false, error: "Frågan hittades inte." };

  const [deleted] = await db
    .delete(questions)
    .where(eq(questions.id, idParsed.data))
    .returning({ examId: questions.examId });

  if (!deleted) return { success: false, error: "Frågan hittades inte." };

  revalidatePath(`/exams/${deleted.examId}`);
  revalidatePath(`/exams/${deleted.examId}/questions`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// AI extraction — reads the exam's page images and drafts all questions.
// Drafts are stored on the exam (exams.question_drafts) until the teacher
// saves or discards each one, so a reload never costs a second extraction.
// ---------------------------------------------------------------------------

export async function extractQuestionsFromExam(
  examId: string,
): Promise<{ success: true; drafts: QuestionDraft[] } | { success: false; error: string }> {
  const idParsed = z.string().uuid().safeParse(examId);
  if (!idParsed.success) return { success: false, error: "Ogiltigt prov-id." };

  const teacher = await requireTeacher();
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, idParsed.data), eq(exams.schoolId, teacher.schoolId)),
  });
  if (!exam) return { success: false, error: "Provet hittades inte." };
  if (exam.pageImageUrls.length === 0) {
    return {
      success: false,
      error: "Provet saknar sidbilder — ladda upp PDF:en på nytt.",
    };
  }

  try {
    // Private bucket — sign page-image URLs for the model call.
    const pageImageUrls = await resolveStorageUrls(PAGES_BUCKET, exam.pageImageUrls);

    const { object } = await generateObject({
      model: extractionModel(),
      schema: ExamExtractionSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `These are the pages of a math exam ("${exam.title}", ${exam.course}, ${exam.gradeLevel}), assessed under the "${getPack(exam.curriculum).label}" curriculum.`,
                "Extract EVERY question, in order. For each question:",
                "- Copy the question text verbatim (translate nothing).",
                '- Use the printed sub-numbering ("1", "2a", "2b" ...).',
                `- Solve the question yourself to produce the correct answer and concise solution steps in ${getPack(exam.curriculum).language === "sv" ? "Swedish" : "English"}.`,
                "- Write a bedömningsanvisning as moments, one per point (or one per group of points for the same criterion):",
                '  * Read the printed points per level, e.g. "(2/1/0)" = 2 E points, 1 C point, 0 A points. The moments\' points per level MUST add up to it. If nothing is printed, estimate.',
                "  * Each moment states what the student must show, in the style of Skolverket's bedömningsanvisningar: E moments reward a godtagbar ansats or simple method; C moments a complete, correct solution or a well-founded reasoning; A moments a general, well-structured and precise solution or reasoning. Refer to concrete values from your solution.",
                "  * Higher-level moments typically build on the lower ones (\"Med i övrigt godtagbar lösning med korrekt svar …\").",
                "  * Give each moment the ONE ability/criterion it assesses, using EXACTLY these codes:",
                abilityPromptBlock(getPack(exam.curriculum)),
                `  * Write the moments in ${getPack(exam.curriculum).language === "sv" ? "Swedish" : "English"}.`,
              ].join("\n"),
            },
            ...pageImageUrls.map((url) => ({
              type: "image" as const,
              image: new URL(url),
            })),
          ],
        },
      ],
    });

    if (object.questions.length === 0) {
      return { success: false, error: "Inga frågor kunde identifieras på sidorna." };
    }

    const newDrafts: QuestionDraft[] = object.questions.map((q) => ({
      id: randomUUID(),
      number: q.number,
      questionText: q.questionText,
      topic: q.topic,
      correctAnswer: q.correctAnswer,
      solutionSteps: q.solutionSteps ?? "",
      rubric: q.rubric.map((item, i) => ({ ...item, id: `m${i + 1}` })),
    }));
    // Append (not replace): drafts from an earlier run stay until handled.
    const [updated] = await db
      .update(exams)
      .set({
        questionDrafts: sql`${exams.questionDrafts} || ${JSON.stringify(newDrafts)}::jsonb`,
      })
      .where(eq(exams.id, exam.id))
      .returning({ questionDrafts: exams.questionDrafts });

    revalidatePath(`/exams/${examId}/questions`);
    return { success: true, drafts: updated.questionDrafts.map(normalizeDraft) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI-extraktionen misslyckades.";
    return { success: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Draft review — save (one or many) or discard stored AI drafts
// ---------------------------------------------------------------------------

/**
 * Removes the given draft ids from the exam's stored drafts. The ids go in as
 * one JSON parameter: Drizzle would spread a JS array into separate params.
 */
function withoutDrafts(ids: string[]) {
  return sql`(
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb)
    FROM jsonb_array_elements(${exams.questionDrafts}) AS d
    WHERE NOT (${JSON.stringify(ids)}::jsonb @> to_jsonb(d->>'id'))
  )`;
}

export type SaveDraftsResult =
  | {
      success: true;
      savedIds: string[];
      /** Drafts that failed validation stay stored, with the reason. */
      failed: { id: string; error: string }[];
    }
  | { success: false; error: string };

/**
 * Saves drafts as questions, with the teacher's edits. Valid drafts are
 * inserted and removed from the stored list in one transaction; invalid
 * ones are reported and kept.
 */
export async function saveQuestionDrafts(
  examId: string,
  drafts: QuestionDraft[],
): Promise<SaveDraftsResult> {
  const examIdParsed = z.string().uuid().safeParse(examId);
  if (!examIdParsed.success) return { success: false, error: "Ogiltigt prov-id." };

  const teacher = await requireTeacher();
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, examIdParsed.data), eq(exams.schoolId, teacher.schoolId)),
    columns: { id: true },
  });
  if (!exam) return { success: false, error: "Provet hittades inte." };

  const valid: { id: string; fields: QuestionFields }[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const draft of drafts) {
    const parsed = QuestionFieldsSchema.safeParse(draft);
    if (parsed.success) valid.push({ id: draft.id, fields: parsed.data });
    else failed.push({ id: draft.id, error: parsed.error.issues[0].message });
  }

  if (valid.length > 0) {
    await db.transaction(async (tx) => {
      await tx.insert(questions).values(
        valid.map(({ fields }) => ({ examId: exam.id, ...questionColumns(fields) })),
      );
      await tx
        .update(exams)
        .set({ questionDrafts: withoutDrafts(valid.map((v) => v.id)) })
        .where(eq(exams.id, exam.id));
    });
  }

  revalidatePath(`/exams/${examId}`);
  revalidatePath(`/exams/${examId}/questions`);
  return { success: true, savedIds: valid.map((v) => v.id), failed };
}

export async function discardQuestionDraft(
  examId: string,
  draftId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const ids = z.object({ examId: z.string().uuid(), draftId: z.string().uuid() }).safeParse({
    examId,
    draftId,
  });
  if (!ids.success) return { success: false, error: "Ogiltigt id." };

  const teacher = await requireTeacher();
  const result = await db
    .update(exams)
    .set({ questionDrafts: withoutDrafts([ids.data.draftId]) })
    .where(and(eq(exams.id, ids.data.examId), eq(exams.schoolId, teacher.schoolId)))
    .returning({ id: exams.id });
  if (result.length === 0) return { success: false, error: "Provet hittades inte." };

  revalidatePath(`/exams/${examId}/questions`);
  return { success: true };
}
