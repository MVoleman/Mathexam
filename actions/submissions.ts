"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { exams, students, studentSubmissions, type StudentSubmission } from "@/db/schema";
import { pdfToPngBuffers } from "@/lib/pdf/rasterize";
import { SUBMISSIONS_BUCKET, uploadStorageObject } from "@/lib/storage";
import { assertSubmissionInSchool, requireTeacher, TenancyError } from "@/lib/auth";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_TOTAL_PAGES = 30;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type UploadSubmissionResult =
  | { success: true; submission: StudentSubmission }
  | { success: false; error: string };

/**
 * Uploads one student's solution: any mix of photos (PNG/JPEG/WebP) and
 * scanned PDFs. PDFs are rasterized server-side; everything lands as page
 * images in the `submissions` bucket, in the order the files were selected.
 */
export async function uploadSubmission(formData: FormData): Promise<UploadSubmissionResult> {
  const teacher = await requireTeacher();
  try {
    const meta = z
      .object({
        examId: z.string().uuid(),
        studentId: z.string().trim().min(1, "Elev-id krävs."),
        studentRef: z.string().uuid().optional(),
      })
      .safeParse({
        examId: formData.get("examId"),
        studentId: formData.get("studentId"),
        studentRef: formData.get("studentRef") ?? undefined,
      });
    if (!meta.success) return { success: false, error: meta.error.issues[0].message };

    // Optional roster link — must belong to the teacher's school.
    let studentRef: string | null = null;
    if (meta.data.studentRef) {
      const rosterStudent = await db.query.students.findFirst({
        where: and(
          eq(students.id, meta.data.studentRef),
          eq(students.schoolId, teacher.schoolId),
        ),
        columns: { id: true },
      });
      if (!rosterStudent) return { success: false, error: "Eleven hittades inte i elevlistan." };
      studentRef = rosterStudent.id;
    }

    const exam = await db.query.exams.findFirst({
      where: and(eq(exams.id, meta.data.examId), eq(exams.schoolId, teacher.schoolId)),
    });
    if (!exam) return { success: false, error: "Provet hittades inte." };

    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) return { success: false, error: "Inga filer bifogade." };

    // 1. Normalize every file to PNG page buffers, preserving order.
    const pages: { buffer: Buffer; contentType: string; ext: string }[] = [];
    for (const file of files) {
      if (file.size === 0) continue;
      if (file.size > MAX_FILE_BYTES) {
        return { success: false, error: `${file.name} är för stor (max 15 MB per fil).` };
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      if (file.type === "application/pdf") {
        const pngBuffers = await pdfToPngBuffers(buffer);
        for (const png of pngBuffers) {
          pages.push({ buffer: png, contentType: "image/png", ext: "png" });
        }
      } else if (IMAGE_TYPES.has(file.type)) {
        const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        pages.push({ buffer, contentType: file.type, ext });
      } else {
        return {
          success: false,
          error: `${file.name}: formatet stöds inte (PNG, JPEG, WebP eller PDF).`,
        };
      }

      if (pages.length > MAX_TOTAL_PAGES) {
        return { success: false, error: `Max ${MAX_TOTAL_PAGES} sidor per inlämning.` };
      }
    }
    if (pages.length === 0) return { success: false, error: "Filerna var tomma." };

    // 2. Upload all pages in parallel to the (private) submissions bucket.
    // The DB stores bucket-relative, school-prefixed paths; URLs are signed
    // on demand (review UI, AI calls, exports).
    const submissionKey = `${teacher.schoolId}/${meta.data.examId}/${randomUUID()}`;

    const imageUrls = await Promise.all(
      pages.map((page, i) =>
        uploadStorageObject({
          bucket: SUBMISSIONS_BUCKET,
          path: `${submissionKey}/page-${String(i + 1).padStart(3, "0")}.${page.ext}`,
          body: page.buffer,
          contentType: page.contentType,
        }),
      ),
    );

    // 3. Persist the submission.
    const [submission] = await db
      .insert(studentSubmissions)
      .values({ examId: meta.data.examId, studentId: meta.data.studentId, studentRef, imageUrls })
      .returning();

    revalidatePath(`/exams/${meta.data.examId}`);
    return { success: true, submission };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Uppladdningen misslyckades.";
    return { success: false, error: message };
  }
}

export async function deleteSubmission(
  submissionId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = z.string().uuid().safeParse(submissionId);
  if (!parsed.success) return { success: false, error: "Ogiltigt inlämnings-id." };

  const teacher = await requireTeacher();
  try {
    await assertSubmissionInSchool(parsed.data, teacher.schoolId);
  } catch (err) {
    if (err instanceof TenancyError) {
      return { success: false, error: "Inlämningen hittades inte." };
    }
    throw err;
  }

  const [deleted] = await db
    .delete(studentSubmissions)
    .where(eq(studentSubmissions.id, parsed.data))
    .returning({ examId: studentSubmissions.examId });

  if (!deleted) return { success: false, error: "Inlämningen hittades inte." };

  revalidatePath(`/exams/${deleted.examId}`);
  return { success: true };
}
