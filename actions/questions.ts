"use server";

import { generateObject } from "ai";
import { extractionModel } from "@/lib/ai/models";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { exams, questions, type Question } from "@/db/schema";
import {
  ExamExtractionSchema,
  type ExtractedQuestion,
} from "@/lib/validations/ai-schemas";
import {
  QuestionFieldsSchema,
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
    .values({
      examId: examIdParsed.data,
      ...fields.data,
      solutionSteps: fields.data.solutionSteps || null,
    })
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
    .set({ ...fields.data, solutionSteps: fields.data.solutionSteps || null })
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
// Drafts are returned for teacher review; nothing is saved until confirmed.
// ---------------------------------------------------------------------------

export async function extractQuestionsFromExam(
  examId: string,
): Promise<{ success: true; drafts: ExtractedQuestion[] } | { success: false; error: string }> {
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
                "- Read the printed max points if shown (e.g. \"(2/1/0)\" formats — sum them), otherwise estimate.",
                "- Assess difficulty (E/C/A) and which curriculum abilities/criteria it tests, using EXACTLY these codes:",
                abilityPromptBlock(getPack(exam.curriculum)),
                `- Solve the question yourself to produce the correct answer and concise solution steps in ${getPack(exam.curriculum).language === "sv" ? "Swedish" : "English"}.`,
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

    return { success: true, drafts: object.questions };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI-extraktionen misslyckades.";
    return { success: false, error: message };
  }
}
