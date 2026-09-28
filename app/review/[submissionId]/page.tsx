import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewPanel } from "@/components/review-panel";
import { getCapturableGoldenSets, getSubmissionForReview } from "@/lib/queries";
import { requireTeacher } from "@/lib/auth";
import { SUBMISSIONS_BUCKET, resolveStorageUrls } from "@/lib/storage";
import { auditInBackground } from "@/lib/audit";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: { submissionId: string };
}) {
  const teacher = await requireTeacher();
  const submission = await getSubmissionForReview(params.submissionId, teacher.schoolId);
  if (!submission) notFound();

  auditInBackground({
    schoolId: teacher.schoolId,
    actorId: teacher.id,
    action: "submission.view",
    entityType: "submission",
    entityId: submission.id,
  });

  // Private bucket — sign the page images for this render.
  const imageUrls = await resolveStorageUrls(SUBMISSIONS_BUCKET, submission.imageUrls);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/exams/${submission.examId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Granskning — {submission.studentId}
          </h1>
          <p className="text-sm text-muted-foreground">{submission.exam.title}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,2fr)_3fr]">
        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="text-base">Elevens inlämning</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[75vh] space-y-4 overflow-y-auto">
            {imageUrls.length === 0 && (
              <p className="text-sm text-muted-foreground">Inga bilder uppladdade.</p>
            )}
            {imageUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt={`Sida ${i + 1}`}
                className="w-full rounded-md border"
              />
            ))}
          </CardContent>
        </Card>

        <ReviewPanel
          results={submission.results}
          curriculum={submission.exam.curriculum}
          goldenSets={(await getCapturableGoldenSets(teacher.schoolId)).map((s) => ({
            id: s.id,
            name: s.name,
          }))}
        />
      </div>
    </div>
  );
}
