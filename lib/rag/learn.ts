import { eq } from "drizzle-orm";
import { db } from "@/db";
import { exams, gradingResults, questions, solutionReferences } from "@/db/schema";
import { embedText } from "@/lib/ai/models";
import { invalidateRagCache } from "@/lib/grading/engine";

/**
 * The learning flywheel: every teacher override becomes an embedded grading
 * precedent in the knowledge base. Future gradings of similar answers to the
 * same course/topic retrieve it and follow the teacher's judgement.
 *
 * Embedded with the same key shape as retrieval queries
 * (`${topic}: ${questionText}`) so precedents surface for their question.
 */
export async function capturePrecedentFromOverride(input: {
  resultId: string;
  awardedPoints: number;
  teacherComment?: string;
}): Promise<void> {
  const result = await db.query.gradingResults.findFirst({
    where: eq(gradingResults.id, input.resultId),
  });
  if (!result) return;

  const question = await db.query.questions.findFirst({
    where: eq(questions.id, result.questionId),
  });
  if (!question) return;

  const exam = await db.query.exams.findFirst({ where: eq(exams.id, question.examId) });
  if (!exam) return;

  const studentAnswer = result.transcription.transcribedText.trim();
  if (!studentAnswer) return; // blank answers teach nothing

  const partialCreditRules = [
    `Lärarbedömt prejudikat: elevsvaret nedan gav ${input.awardedPoints}/${question.maxPoints}p (AI:n föreslog ${result.evaluation.awardedPoints}p).`,
    input.teacherComment ? `Lärarens motivering: ${input.teacherComment}` : null,
    `Elevsvar: ${studentAnswer}`,
  ]
    .filter(Boolean)
    .join("\n");

  const embedding = await embedText(
    `${question.topic}: ${question.questionText}`,
    "RETRIEVAL_DOCUMENT",
  );

  await db.insert(solutionReferences).values({
    questionId: question.id,
    course: exam.course,
    topic: question.topic,
    correctSolution: question.solutionSteps ?? question.correctAnswer,
    commonPitfalls:
      result.evaluation.identifiedPitfalls.length > 0
        ? result.evaluation.identifiedPitfalls.join("; ")
        : null,
    partialCreditRules,
    embedding,
    source: "teacher_override",
  });

  invalidateRagCache(question.id);
}
