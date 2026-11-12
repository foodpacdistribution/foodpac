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

type Box = { page: number; x0: number; y0: number; x1: number; y1: number };
type ImageData = { width: number; height: number; bitmap?: ImageBitmap; data?: Uint8ClampedArray | Uint8Array; kind?: number };

/**
 * Browser only: the product photo printed beside each line of goods (as goodsAnchors found
 * them), as a small JPEG data URL. Lines without a photo are left out.
 */
export async function readPdfPhotos(
  file: File,
  anchors: { name: string; page: number; top: number; bottom: number; nameRight: number }[],
): Promise<{ name: string; dataUrl: string }[]> {
  if (!anchors.length) return [];
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out: { name: string; dataUrl: string }[] = [];
  try {
    for (const pageNo of [...new Set(anchors.map((a) => a.page))]) {
      const page = await doc.getPage(pageNo + 1);
      const viewport = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      // Where each image is drawn: follow the transform stack up to each paint.
      const found: (Box & { obj: () => Promise<ImageData | null> })[] = [];
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        if (fn === pdfjs.OPS.save) stack.push(ctm);
        else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === pdfjs.OPS.transform) ctm = pdfjs.Util.transform(ctm, args);
        else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
          const m = pdfjs.Util.transform(viewport.transform, ctm);
          const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          const ref = args[0];
          const obj =
            fn === pdfjs.OPS.paintInlineImageXObject
              ? async () => ref as ImageData
              : () =>
                  new Promise<ImageData | null>((resolve) => {
                    const pool = String(ref).startsWith("g_") ? page.commonObjs : page.objs;
                    try {
                      pool.get(ref, (d: ImageData) => resolve(d ?? null));
                    } catch {
                      resolve(null);
                    }
                  });
          found.push({ page: pageNo, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), obj });
        }
      }
      for (const a of anchors.filter((x) => x.page === pageNo)) {
        // The photo beside the line: left of the price column, overlapping the line's rows the most.
        const overlap = (b: Box) => Math.min(b.y1, a.bottom + 12) - Math.max(b.y0, a.top - 12);
        const best = found
          .filter((b) => (b.x0 + b.x1) / 2 < a.nameRight && b.x1 - b.x0 < 260 && b.y1 - b.y0 < 260 && overlap(b) > 0)
          .sort((p, q) => overlap(q) - overlap(p))[0];
        if (!best) continue;
        const img = await best.obj();
        const dataUrl = img ? toJpeg(img) : null;
        if (dataUrl) out.push({ name: a.name, dataUrl });
      }
      page.cleanup();
    }
  } finally {
    void doc.destroy();
  }
  return out;
}

/** A pdf.js image as a small JPEG (240px at most), on white where it was transparent. */
function toJpeg(img: ImageData): string | null {
  const { width, height } = img;
  if (!width || !height) return null;
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  if (img.bitmap) sctx.drawImage(img.bitmap, 0, 0);
  else if (img.data) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    const d = img.data;
    // pdf.js kinds: 1 = 1-bit grey, 2 = RGB, 3 = RGBA.
    if (img.kind === 3) rgba.set(d.subarray(0, rgba.length));
    else if (img.kind === 2) {
      for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) {
        rgba[j] = d[i];
        rgba[j + 1] = d[i + 1];
        rgba[j + 2] = d[i + 2];
        rgba[j + 3] = 255;
      }
    }
    else return null;
    sctx.putImageData(new globalThis.ImageData(rgba, width, height), 0, 0);
  } else return null;
  const scale = Math.min(1, 240 / Math.max(width, height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.82);
}
