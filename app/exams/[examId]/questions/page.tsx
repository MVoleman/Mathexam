import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuestionManager } from "@/components/question-manager";
import { db } from "@/db";
import { exams, questions } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function QuestionsPage({
  params,
}: {
  params: { examId: string };
}) {
  const teacher = await requireTeacher();
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, params.examId), eq(exams.schoolId, teacher.schoolId)),
  });
  if (!exam) notFound();

  const examQuestions = await db.query.questions.findMany({
    where: eq(questions.examId, exam.id),
    orderBy: asc(questions.number),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/exams/${exam.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Frågor</h1>
          <p className="text-sm text-muted-foreground">
            {exam.title} · {exam.course}
          </p>
        </div>
      </div>

      <QuestionManager
        examId={exam.id}
        hasPageImages={exam.pageImageUrls.length > 0}
        questions={examQuestions}
        initialDrafts={exam.questionDrafts}
        curriculum={exam.curriculum}
      />
    </div>
  );
}
