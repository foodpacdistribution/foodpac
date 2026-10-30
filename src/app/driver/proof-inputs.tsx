"use client";

import { Camera, Eraser, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { btn, cx } from "@/components/ui";

/** Resizes a camera photo on the phone so uploads stay small (~100–300 KB). */
async function compressPhoto(file: File, maxSide = 1600, quality = 0.75): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ? new File([blob], "delivery.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // Unsupported format for canvas: send as-is, the server validates it.
  }
}

export function PhotoCapture({ value, onChange, required }: { value: File | null; onChange: (f: File | null) => void; required?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!value) return;
    const url = URL.createObjectURL(value);
    queueMicrotask(() => setPreview(url));
    return () => URL.revokeObjectURL(url);
  }, [value]);

  if (value && preview) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
        <img src={preview} alt="Delivery photo preview" className="max-h-56 w-full object-cover" />
        <button type="button" onClick={() => (onChange(null), setPreview(null))} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white" aria-label="Remove photo">
          <X className="size-4" />
        </button>
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{Math.round(value.size / 1024)} KB</span>
      </div>
    );
  }
  return (
    <label className={cx(btn("secondary", "lg", "w-full cursor-pointer rounded-xl border-dashed"), busy && "opacity-60")}>
      <Camera className="size-5" /> {busy ? "Processing…" : `Take photo${required ? " (required)" : ""}`}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          onChange(await compressPhoto(f));
          setBusy(false);
        }}
      />
    </label>
  );
}

/** Finger/stylus signature pad; reports a PNG after each stroke. */
export function SignaturePad({ onChange, required }: { onChange: (f: File | null) => void; required?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const export_ = () =>
    canvas.current!.toBlob((b) => b && onChange(new File([b], "signature.png", { type: "image/png" })), "image/png");

  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">Customer signature{required ? " *" : " (optional)"}</span>
        {!empty && (
          <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-slate-500">
            <Eraser className="size-3.5" /> Clear
          </button>
        )}
      </div>
      <div className="relative">
        <canvas
          ref={canvas}
          className="h-36 w-full touch-none rounded-xl border border-line bg-white"
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = canvas.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 0.1, y + 0.1);
            ctx.stroke();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={() => {
            if (!drawing.current) return;
            drawing.current = false;
            setEmpty(false);
            export_();
          }}
        />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-300">Sign here</span>}
        <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-dashed border-slate-200" />
      </div>
    </div>
  );
}
