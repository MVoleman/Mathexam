import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmissionUploadForm } from "@/components/submission-upload-form";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { exams, students } from "@/db/schema";
import { requireTeacher } from "@/lib/auth";

export default async function NewSubmissionPage({
  params,
}: {
  params: { examId: string };
}) {
  const teacher = await requireTeacher();
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, params.examId), eq(exams.schoolId, teacher.schoolId)),
  });
  if (!exam) notFound();

  const roster = await db.query.students.findMany({
    where: eq(students.schoolId, teacher.schoolId),
    columns: { id: true, fullName: true, className: true },
    orderBy: [asc(students.className), asc(students.fullName)],
  });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/exams/${exam.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ny inlämning</h1>
          <p className="text-sm text-muted-foreground">{exam.title}</p>
        </div>
      </div>
      <SubmissionUploadForm examId={exam.id} rosterStudents={roster} />
    </div>
  );
}
