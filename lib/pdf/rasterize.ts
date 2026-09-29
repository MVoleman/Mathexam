/** 2.0 ≈ 144 DPI — enough detail for AI transcription of handwriting. */
export const PDF_RENDER_SCALE = 2.0;
export const MAX_PDF_PAGES = 40;

/**
 * Rasterizes a PDF buffer to one PNG buffer per page via `pdf-to-img`
 * (pure-JS pdfjs — no native binaries). Requires Node 20+ and
 * `serverComponentsExternalPackages: ["pdf-to-img"]` in next.config
 * (ESM-only package, hence the dynamic import).
 */
export async function pdfToPngBuffers(
  pdfBuffer: Buffer,
  { maxPages = MAX_PDF_PAGES, scale = PDF_RENDER_SCALE } = {},
): Promise<Buffer[]> {
  const { pdf } = await import("pdf-to-img");

  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
  const document = await pdf(dataUrl, { scale });

  if (document.length > maxPages) {
    throw new Error(`PDF:en har ${document.length} sidor — max ${maxPages} sidor stöds.`);
  }

  // pdf-to-img exposes no destroy(); the pdfjs document is freed by GC.
  const pageBuffers: Buffer[] = [];
  for await (const image of document) {
    pageBuffers.push(Buffer.from(image));
  }

  return pageBuffers;
}
