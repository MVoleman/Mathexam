import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Storage hardening layer.
 *
 * The DB stores BUCKET-RELATIVE PATHS with a per-school prefix
 * (`<schoolId>/<examId>/…`), buckets are PRIVATE, and short-lived signed
 * URLs are minted on demand — for the review UI, for AI model calls, and
 * for data exports.
 *
 * Legacy compatibility: rows written before hardening contain full public
 * URLs. Every helper detects `http(s)://` refs and passes them through
 * (resolve) or parses the path out of them (delete/download), so old data
 * keeps working without a migration.
 */

export const EXAMS_BUCKET = "exams";
export const PAGES_BUCKET = "exam_pages";
export const SUBMISSIONS_BUCKET = "submissions";

/** Long enough for a grading batch or a review session; short enough to leak safely. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export function isLegacyPublicUrl(ref: string): boolean {
  return /^https?:\/\//.test(ref);
}

/** Bucket-relative path for a ref (parses legacy public URLs). */
export function storagePathFromRef(ref: string, bucket: string): string | null {
  if (!isLegacyPublicUrl(ref)) return ref;
  const marker = `/object/public/${bucket}/`;
  const idx = ref.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(ref.slice(idx + marker.length));
}

/** Signed URL for one stored ref (legacy public URLs pass through). */
export async function resolveStorageUrl(bucket: string, ref: string): Promise<string> {
  if (isLegacyPublicUrl(ref)) return ref;

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(ref, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    throw new Error(`Kunde inte signera lagringslänk (${bucket}/${ref}): ${error?.message}`);
  }
  return data.signedUrl;
}

export async function resolveStorageUrls(
  bucket: string,
  refs: string[],
): Promise<string[]> {
  return Promise.all(refs.map((ref) => resolveStorageUrl(bucket, ref)));
}

/** Downloads a stored object as a Buffer (works for both refs and legacy URLs). */
export async function downloadStorageObject(bucket: string, ref: string): Promise<Buffer> {
  if (isLegacyPublicUrl(ref)) {
    const response = await fetch(ref);
    if (!response.ok) throw new Error(`Nedladdning misslyckades (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(bucket).download(ref);
  if (error || !data) {
    throw new Error(`Nedladdning misslyckades (${bucket}/${ref}): ${error?.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/** Uploads a buffer and returns the bucket-relative path. */
export async function uploadStorageObject(input: {
  bucket: string;
  path: string;
  body: Buffer;
  contentType: string;
  upsert?: boolean;
}): Promise<string> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(input.bucket)
    .upload(input.path, input.body, {
      contentType: input.contentType,
      upsert: input.upsert ?? false,
    });
  if (error) {
    throw new Error(`Uppladdning misslyckades (${input.bucket}/${input.path}): ${error.message}`);
  }
  return input.path;
}

/** Removes objects by refs (paths or legacy URLs). */
export async function removeStorageObjects(bucket: string, refs: string[]): Promise<void> {
  const paths = refs
    .map((ref) => storagePathFromRef(ref, bucket))
    .filter((p): p is string => p !== null);
  if (paths.length === 0) return;

  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw new Error(`Radering misslyckades: ${error.message}`);
}
