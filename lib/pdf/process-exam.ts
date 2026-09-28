import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { exams } from "@/db/schema";
import { pdfToPngBuffers } from "@/lib/pdf/rasterize";
import {
  EXAMS_BUCKET,
  PAGES_BUCKET,
  downloadStorageObject,
  uploadStorageObject,
} from "@/lib/storage";

/**
 * Rasterizes an exam PDF into one PNG per page and uploads them to the
 * (private) `exam_pages` bucket under the school's prefix. Returns
 * bucket-relative paths. Shared by the synchronous upload path (small PDFs)
 * and the Inngest rasterization worker (large PDFs / serverless).
 */
export async function rasterizeExamPdfToStorage(
  exam: { id: string; schoolId: string },
  pdfBuffer: Buffer,
): Promise<string[]> {
  const pageBuffers = await pdfToPngBuffers(pdfBuffer);

  return Promise.all(
    pageBuffers.map((pageBuffer, pageIndex) =>
      uploadStorageObject({
        bucket: PAGES_BUCKET,
        path: `${exam.schoolId}/${exam.id}/page-${String(pageIndex + 1).padStart(3, "0")}.png`,
        body: pageBuffer,
        contentType: "image/png",
        upsert: true,
      }),
    ),
  );
}

/**
 * Worker entry: downloads the exam's stored PDF, rasterizes it, and flips
 * the exam from "processing" to "ready". Used by the Inngest function.
 */
export async function processExamPdfFromStorage(examId: string): Promise<void> {
  const exam = await db.query.exams.findFirst({ where: eq(exams.id, examId) });
  if (!exam) throw new Error(`Exam ${examId} not found.`);
  if (!exam.pdfUrl) throw new Error(`Exam ${examId} has no stored PDF.`);

  const pdfBuffer = await downloadStorageObject(EXAMS_BUCKET, exam.pdfUrl);

  const pageImageUrls = await rasterizeExamPdfToStorage(
    { id: exam.id, schoolId: exam.schoolId },
    pdfBuffer,
  );

  await db
    .update(exams)
    .set({ pageImageUrls, status: "ready", updatedAt: new Date() })
    .where(eq(exams.id, examId));
}
