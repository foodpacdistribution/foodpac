"use client";

import { Camera, Check, Eraser, Image as ImageIcon, PenLine, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { btn, cx, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";

/** Resizes a camera photo on the phone so uploads stay small (~100–300 KB). */
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.75): Promise<File> {
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
  const tr = useT();
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
        <img src={preview} alt={tr("Delivery photo preview")} className="max-h-56 w-full object-cover" />
        <button type="button" onClick={() => (onChange(null), setPreview(null))} className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/60 text-white" aria-label={tr("Remove photo")}>
          <X className="size-4" />
        </button>
        <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">{Math.round(value.size / 1024)} {" "}{tr("KB")}</span>
      </div>
    );
  }
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    onChange(await compressPhoto(f));
    setBusy(false);
  };
  // The camera straight away, or a photo already on the phone (taken earlier, or sent by the customer).
  return (
    <div className={cx("grid grid-cols-2 gap-2", busy && "opacity-60")}>
      <label className={btn("secondary", "lg", "h-auto min-h-12 w-full cursor-pointer gap-1.5 rounded-xl border-dashed px-2 py-2 text-center text-sm leading-tight whitespace-normal [&>svg]:shrink-0")}>
        {busy ? <Spinner className="size-5" /> : <Camera className="size-5" />} {busy ? tr("Processing…") : tr(required ? "Take photo (required)" : "Take photo")}
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
      </label>
      <label className={btn("secondary", "lg", "h-auto min-h-12 w-full cursor-pointer gap-1.5 rounded-xl border-dashed px-2 py-2 text-center text-sm leading-tight whitespace-normal [&>svg]:shrink-0")}>
        <ImageIcon className="size-5" /> {tr("Choose from album")}
        <input type="file" accept="image/*" className="sr-only" onChange={pick} />
      </label>
    </div>
  );
}

type Pt = { x: number; y: number; w: number };
type Stroke = Pt[];

const INK = "#0f172a";

/** Line width from speed (px/ms): quick strokes thin out a little, like a pen. */
const widthFor = (speed: number, pressure: number, pen: boolean) => {
  const base = Math.min(3.6, Math.max(1.6, 3.4 - speed * 1.1));
  return pen && pressure > 0 ? base * (0.6 + pressure * 0.8) : base;
};

/** Smooth stroke: quadratic curves through the midpoints between samples. */
function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, scale = 1, dx = 0, dy = 0) {
  if (!s.length) return;
  const X = (p: Pt) => p.x * scale + dx;
  const Y = (p: Pt) => p.y * scale + dy;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.length === 1) {
    ctx.beginPath();
    ctx.arc(X(s[0]), Y(s[0]), (s[0].w * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1];
    const b = s[i];
    const prevMid = i === 1 ? a : { x: (s[i - 2].x + a.x) / 2, y: (s[i - 2].y + a.y) / 2 };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.lineWidth = ((a.w + b.w) / 2) * scale;
    ctx.beginPath();
    ctx.moveTo(prevMid.x * scale + dx, prevMid.y * scale + dy);
    ctx.quadraticCurveTo(X(a), Y(a), mid.x * scale + dx, mid.y * scale + dy);
    if (i === s.length - 1) ctx.lineTo(X(b), Y(b));
    ctx.stroke();
  }
}

function inkStats(strokes: Stroke[]) {
  let len = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes)
    s.forEach((p, i) => {
      if (i) len += Math.hypot(p.x - s[i - 1].x, p.y - s[i - 1].y);
      minX = Math.min(minX, p.x - p.w);
      minY = Math.min(minY, p.y - p.w);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.w);
    });
  return { len, minX, minY, maxX, maxY };
}

/** "2026-11-02 15:42:10 +10:00": local time with its UTC offset, so the record is unambiguous. */
function stampTime(d = new Date()) {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/**
 * The saved proof: the signature on white, scaled to fit, with a footer naming who signed,
 * the order, the time and the GPS accuracy. The server keeps a SHA-256 of these exact bytes.
 */
async function renderProof(strokes: Stroke[], lines: [string, string]) {
  const W = 1000, SIG_H = 320, FOOT_H = 96, PAD = 36;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = SIG_H + FOOT_H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  const b = inkStats(strokes);
  const scale = Math.min((W - PAD * 2) / (b.maxX - b.minX), (SIG_H - PAD * 2) / (b.maxY - b.minY), 3);
  const dx = (W - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
  const dy = (SIG_H - (b.maxY - b.minY) * scale) / 2 - b.minY * scale;
  strokes.forEach((s) => drawStroke(ctx, s, scale, dx, dy));
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, SIG_H - 0.5);
  ctx.lineTo(W - PAD, SIG_H - 0.5);
  ctx.stroke();
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 26px system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(lines[0], PAD, SIG_H + 38, W - PAD * 2);
  ctx.fillStyle = "#64748b";
  ctx.font = "20px system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
  ctx.fillText(lines[1], PAD, SIG_H + 72, W - PAD * 2);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  return blob ? new File([blob], "signature.png", { type: "image/png" }) : null;
}

/**
 * Customer signature. Tapping opens a full-screen pad (more room, works sideways); the
 * finished signature is stamped with the order, time and GPS (and the receiver's name, if the
 * driver entered one) before upload. The customer only signs: no name to type.
 */
export function SignaturePad({
  onChange,
  required,
  signer,
  reference,
  accuracyM,
}: {
  onChange: (f: File | null) => void;
  required?: boolean;
  /** "Received by", if entered: added to the stamp. */
  signer: string;
  reference: string;
  accuracyM: number | null;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<Stroke[] | null>(null);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // The stamp names the receiver when one was entered, so re-stamp if it changes after signing.
  const stamp = useRef({ tr, reference, accuracyM });
  useEffect(() => {
    stamp.current = { tr, reference, accuracyM };
  });
  useEffect(() => {
    if (!strokes) return;
    let stale = false;
    const t = setTimeout(async () => {
      const { tr: t_, reference: ref, accuracyM: acc } = stamp.current;
      const file = await renderProof(strokes, [
        signer.trim() ? t_("Signed by {name}", { name: signer.trim() }) : t_("Customer signature"),
        [ref, stampTime(), acc !== null ? `GPS ±${Math.round(acc)} m` : t_("GPS not available")].join("  ·  "),
      ]);
      if (stale || !file) return;
      setPreview(URL.createObjectURL(file));
      onChange(file);
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [strokes, signer, onChange]);

  const clear = () => {
    setStrokes(null);
    setPreview(null);
    onChange(null);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-600">{tr("Customer signature")}{required ? " *" : tr(" (optional)")}</span>
        {preview && (
          <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-slate-500">
            <Eraser className="size-3.5" /> {tr("Clear")}
          </button>
        )}
      </div>
      {preview ? (
        <button type="button" onClick={() => setOpen(true)} className="block w-full overflow-hidden rounded-xl border border-emerald-300 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={preview} alt={tr("Customer signature")} className="w-full" />
          <span className="flex items-center justify-center gap-1.5 border-t border-line bg-emerald-50 py-1.5 text-xs font-medium text-emerald-800">
            <Check className="size-3.5" /> {tr("Signed · tap to sign again")}
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={btn("secondary", "lg", "h-28 w-full flex-col gap-1 rounded-xl border-dashed")}>
          <PenLine className="size-6" />
          <span>{tr("Tap for the customer to sign")}</span>
        </button>
      )}
      {open && (
        <SignatureScreen
          reference={reference}
          onCancel={() => setOpen(false)}
          onDone={(s) => {
            setStrokes(s);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SignatureScreen({
  reference,
  onCancel,
  onDone,
}: {
  reference: string;
  onCancel: () => void;
  onDone: (strokes: Stroke[]) => void;
}) {
  const tr = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Its own modal dialog, so it sits above the delivery sheet and fills the screen.
  useEffect(() => {
    const d = dialog.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);

  // Size the canvas to its box (and again on rotation), then redraw what's there.
  useEffect(() => {
    const c = canvas.current!;
    const redraw = () => {
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * ratio);
      c.height = Math.round(c.clientHeight * ratio);
      const ctx = c.getContext("2d")!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      strokes.current.forEach((s) => drawStroke(ctx, s));
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const repaint = () => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    strokes.current.forEach((s) => drawStroke(ctx, s));
  };

  const add = (e: PointerEvent | React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const now = e.timeStamp;
    const prev = last.current;
    const speed = prev ? Math.hypot(x - prev.x, y - prev.y) / Math.max(1, now - prev.t) : 0;
    const s = strokes.current[strokes.current.length - 1];
    const w = widthFor(speed, e.pressure, e.pointerType === "pen");
    // Ease the width so it doesn't jump between samples.
    s.push({ x, y, w: s.length ? s[s.length - 1].w * 0.6 + w * 0.4 : w });
    last.current = { x, y, t: now };
  };

  const undo = () => {
    strokes.current.pop();
    setCount(strokes.current.length);
    repaint();
  };
  const clear = () => {
    strokes.current = [];
    setCount(0);
    repaint();
  };

  const finish = () => {
    setError(null);
    const st = inkStats(strokes.current);
    if (!strokes.current.length || st.len < 60 || st.maxX - st.minX < 40) return setError(tr("That's too short for a signature. Please sign again."));
    onDone(strokes.current.map((s) => [...s]));
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => (e.preventDefault(), onCancel())}
      onClose={(e) => e.stopPropagation()}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-white p-0 text-slate-900 backdrop:bg-black/40"
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <button type="button" onClick={onCancel} className={btn("ghost", "icon")} aria-label={tr("Cancel")}>
            <X className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{tr("Customer signature")}</p>
            <p className="truncate text-xs text-slate-500">{reference}</p>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-slate-50 p-3">
          <canvas
            ref={canvas}
            className="size-full touch-none rounded-xl border border-line bg-white"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setError(null);
              strokes.current.push([]);
              last.current = null;
              add(e);
              const ctx = canvas.current!.getContext("2d")!;
              drawStroke(ctx, strokes.current[strokes.current.length - 1]);
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const s = strokes.current[strokes.current.length - 1];
              // Coalesced events keep fast strokes smooth on phones that sample above frame rate.
              const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
              for (const ev of events.length ? events : [e.nativeEvent]) add(ev);
              const ctx = canvas.current!.getContext("2d")!;
              drawStroke(ctx, s.slice(-Math.max(3, events.length + 2)));
            }}
            onPointerUp={() => setCount(strokes.current.length)}
            onPointerCancel={() => setCount(strokes.current.length)}
          />
          {count === 0 && (
            <span className="pointer-events-none absolute inset-0 grid place-items-center text-lg text-slate-300">{tr("Sign here")}</span>
          )}
          <span className="pointer-events-none absolute right-10 bottom-14 left-10 border-b-2 border-dashed border-slate-200" />
          <span className="pointer-events-none absolute bottom-[3.75rem] left-10 text-2xl text-slate-300">×</span>
        </div>
        {error && <p className="px-4 pb-1 text-sm font-medium text-red-600">{error}</p>}
        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <button type="button" onClick={undo} disabled={!count} className={btn("secondary")}>
            <Undo2 className="size-4" /> {tr("Undo")}
          </button>
          <button type="button" onClick={clear} disabled={!count} className={btn("ghost")}>
            <Eraser className="size-4" /> {tr("Clear")}
          </button>
          <p className="hidden flex-1 text-center text-xs text-slate-400 sm:block">{tr("Turn the phone sideways for more room.")}</p>
          <button type="button" onClick={finish} disabled={!count} className={cx(btn("success", "lg"), "ml-auto min-w-32")}>
            <Check className="size-5" /> {tr("Done")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
