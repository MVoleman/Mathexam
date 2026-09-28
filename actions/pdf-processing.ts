"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { exams, type Exam } from "@/db/schema";
import { rasterizeExamPdfToStorage } from "@/lib/pdf/process-exam";
import { EXAMS_BUCKET, uploadStorageObject } from "@/lib/storage";
import { inngest, queueEnabled } from "@/lib/queue/inngest";
import { requireTeacher } from "@/lib/auth";

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ExamMetadataSchema = z.object({
  title: z.string().min(1, "Titel krävs"),
  course: z.string().min(1, "Kurs krävs"),
  gradeLevel: z.string().min(1, "Årskurs krävs"),
  curriculum: z.enum(["lgr22", "gy25", "ib-myp", "ib-dp"]).default("lgr22"),
});

export type UploadExamResult =
  | { success: true; exam: Exam; pageImageUrls: string[] }
  | { success: false; error: string };

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function uploadAndProcessExamPdf(formData: FormData): Promise<UploadExamResult> {
  const teacher = await requireTeacher();
  try {
    // 1. Validate metadata.
    const metadata = ExamMetadataSchema.safeParse({
      title: formData.get("title"),
      course: formData.get("course"),
      gradeLevel: formData.get("gradeLevel"),
      curriculum: formData.get("curriculum") ?? undefined,
    });
    if (!metadata.success) {
      return { success: false, error: metadata.error.issues[0].message };
    }

    // 2. Validate the file.
    const file = formData.get("pdf");
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: "Ingen PDF-fil bifogad." };
    }
    if (file.type !== "application/pdf") {
      return { success: false, error: "Filen måste vara en PDF." };
    }
    if (file.size > MAX_PDF_BYTES) {
      return { success: false, error: "PDF-filen är för stor (max 25 MB)." };
    }

    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    const examId = randomUUID();

    // 3. Upload the raw PDF to the (private) "exams" bucket.
    // The DB stores the bucket-relative path; URLs are signed on demand.
    const pdfUrl = await uploadStorageObject({
      bucket: EXAMS_BUCKET,
      path: `${teacher.schoolId}/${examId}/original.pdf`,
      body: pdfBuffer,
      contentType: "application/pdf",
    });

    // 4. Rasterize: queued on serverless deploys, inline otherwise.
    if (queueEnabled()) {
      const [exam] = await db
        .insert(exams)
        .values({
          id: examId,
          schoolId: teacher.schoolId,
          createdBy: teacher.id,
          curriculum: metadata.data.curriculum,
          title: metadata.data.title,
          course: metadata.data.course,
          gradeLevel: metadata.data.gradeLevel,
          pdfUrl,
          pageImageUrls: [],
          status: "processing",
        })
        .returning();

      await inngest.send({ name: "exam/pdf.process", data: { examId } });

      revalidatePath("/exams");
      return { success: true, exam, pageImageUrls: [] };
    }

    const pageImageUrls = await rasterizeExamPdfToStorage(
      { id: examId, schoolId: teacher.schoolId },
      pdfBuffer,
    );

    const [exam] = await db
      .insert(exams)
      .values({
        id: examId,
        schoolId: teacher.schoolId,
        createdBy: teacher.id,
        curriculum: metadata.data.curriculum,
        title: metadata.data.title,
        course: metadata.data.course,
        gradeLevel: metadata.data.gradeLevel,
        pdfUrl,
        pageImageUrls,
        // Rasterization happened synchronously above, so the exam is
        // immediately ready for question registration.
        status: "ready",
      })
      .returning();

    revalidatePath("/exams");

    return { success: true, exam, pageImageUrls };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Okänt fel vid PDF-bearbetning.";
    return { success: false, error: message };
  }
}
