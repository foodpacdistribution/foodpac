import type { PdfPage } from "./pdf-table";

/** Browser only: extracts the positioned text of every page of a PDF with pdf.js. */
export async function readPdfPages(file: File): Promise<PdfPage[]> {
  // The legacy build also runs on older Safari/Chrome that office PCs and iPads may have.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfPage = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        // Into viewport space (y down, page rotation applied).
        const m = pdfjs.Util.transform(viewport.transform, item.transform);
        const h = Math.hypot(m[2], m[3]) || item.height || 10;
        items.push({ str: item.str, x: m[4], y: m[5], w: item.width * viewport.scale, h });
      }
      pages.push(items);
      page.cleanup();
    }
    return pages;
  } finally {
    void doc.destroy();
  }
}
