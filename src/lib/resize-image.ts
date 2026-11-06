/**
 * Shrinks a picture in the browser before it's uploaded, so big exports from design apps or
 * cameras stay well under the 4 MB upload limit. Small enough files are sent untouched (keeps
 * PNG sharpness); anything else becomes a JPEG at most `maxSide` px on its longer side.
 * With `trimDarkBars`, black bands along the edges (a photo letterboxed into a frame, a phone
 * screenshot) are cut off first, so the product fills its tile instead of sitting between bars.
 */
export async function resizeImage(file: File, maxSide: number, quality = 0.86, opts: { trimDarkBars?: boolean } = {}): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const crop = opts.trimDarkBars ? findDarkBars(bitmap) : null;
    const sw = crop ? crop.width : bitmap.width;
    const sh = crop ? crop.height : bitmap.height;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    if (!crop && scale === 1 && file.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext("2d")!;
    // JPEG has no transparency: put see-through parts on white rather than black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, crop?.left ?? 0, crop?.top ?? 0, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // A format the browser can't draw: send as-is, the server checks it.
  }
}

/** Reads a small copy of the picture and returns the area inside any black bands, or null. */
function findDarkBars(bitmap: ImageBitmap) {
  const s = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const bars = darkBars(ctx.getImageData(0, 0, w, h).data, w, h);
  if (!bars) return null;
  const k = 1 / s;
  const left = Math.round(bars.left * k);
  const top = Math.round(bars.top * k);
  return {
    left,
    top,
    width: Math.min(bitmap.width - left, Math.round((w - bars.left - bars.right) * k)),
    height: Math.min(bitmap.height - top, Math.round((h - bars.top - bars.bottom) * k)),
  };
}

/**
 * How many rows/columns of solid black sit on each edge of an RGBA picture. A row counts when
 * nearly all of it is near-black, so a dark product touching the edge isn't mistaken for a bar.
 * Returns null when there's nothing worth trimming, or when trimming would leave too little.
 */
export function darkBars(data: Uint8ClampedArray, w: number, h: number) {
  const dark = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return data[i + 3] > 200 && Math.max(data[i], data[i + 1], data[i + 2]) < 32;
  };
  const rowDark = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (dark(x, y)) n++;
    return n >= w * 0.97;
  };
  const colDark = (x: number, y0: number, y1: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) if (dark(x, y)) n++;
    return n >= (y1 - y0) * 0.97;
  };
  let top = 0;
  while (top < h && rowDark(top)) top++;
  let bottom = 0;
  while (bottom < h - top && rowDark(h - 1 - bottom)) bottom++;
  let left = 0;
  while (left < w && colDark(left, top, h - bottom)) left++;
  let right = 0;
  while (right < w - left && colDark(w - 1 - right, top, h - bottom)) right++;
  // Ignore slivers (JPEG edges), and never cut into most of the picture (a mostly black photo).
  const minW = Math.max(2, w * 0.02);
  const minH = Math.max(2, h * 0.02);
  const res = { top: top >= minH ? top : 0, bottom: bottom >= minH ? bottom : 0, left: left >= minW ? left : 0, right: right >= minW ? right : 0 };
  if (!res.top && !res.bottom && !res.left && !res.right) return null;
  if (w - res.left - res.right < w * 0.4 || h - res.top - res.bottom < h * 0.4) return null;
  return res;
}
