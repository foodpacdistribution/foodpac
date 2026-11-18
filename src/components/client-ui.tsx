"use client";

import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { useLinkStatus } from "next/link";
import { createContext, useActionState, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "./i18n";
import { btn, cx, Spinner } from "./ui";

const KeptPending = createContext(false);

/**
 * Like useActionState for a form, but a failed save keeps what was typed. (React clears a form
 * after its action runs, error or not; this submits by hand and clears it only on success.)
 * Render the form with <KeptForm form={form}>.
 */
export function useKeptForm<R>(fn: (prev: R | undefined, form: FormData) => Promise<R>) {
  const [state, dispatch, actionPending] = useActionState<R | undefined, FormData>(fn, undefined);
  const [submitting, start] = useTransition();
  const submitted = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && (state as { ok?: boolean }).ok) submitted.current?.reset();
  }, [state]);
  const form = {
    pending: actionPending || submitting,
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submitted.current = e.currentTarget;
      const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
      start(() => dispatch(fd));
    },
  };
  return [state, form] as const;
}

export function KeptForm({
  form,
  ...rest
}: { form: ReturnType<typeof useKeptForm>[1] } & Omit<React.FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit">) {
  return (
    <KeptPending value={form.pending}>
      <form onSubmit={form.onSubmit} {...rest} />
    </KeptPending>
  );
}

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  ...rest
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: Parameters<typeof btn>[0];
  size?: Parameters<typeof btn>[1];
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const status = useFormStatus();
  const kept = useContext(KeptPending);
  const pending = status.pending || kept;
  const tr = useT();
  return (
    <button type="submit" disabled={pending || rest.disabled} className={btn(variant, size, className)} {...rest}>
      {pending ? (
        <>
          <Spinner className="size-3.5" />
          {tr(pendingText ?? "Saving…")}
        </>
      ) : (
        children
      )}
    </button>
  );
}

const isPhone = () => window.matchMedia("(max-width: 639px)").matches;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A window over the page: centred on larger screens, a sheet from the bottom edge on phones,
 * which can be dragged down to close. Closing animates away (Esc, ✕, a tap outside, or the
 * parent closing it), with what was in it kept on screen until it's gone.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Shown while open and while closing; what it showed last, so closing doesn't blank it first.
  const [shown, setShown] = useState(open);
  const [kept, setKept] = useState({ title, children });
  if (open && !shown) setShown(true);
  if (open && (kept.title !== title || kept.children !== children)) setKept({ title, children });
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      d.style.transform = "";
      d.style.transition = "";
      if (!d.open) d.showModal();
      return;
    }
    if (!d.open) return;
    if (reducedMotion()) return d.close();
    // From wherever a drag left it, down and out (phones), or a quick fade and shrink.
    const phone = isPhone();
    const from = d.style.transform || "translateY(0)";
    const anim = d.animate(phone ? [{ transform: from }, { transform: "translateY(100%)" }] : [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.97)" }], {
      duration: phone ? 220 : 130,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    try {
      d.animate({ opacity: [1, 0] }, { duration: phone ? 220 : 130, pseudoElement: "::backdrop", fill: "forwards" });
    } catch {
      // Older browsers can't animate the backdrop; it just goes with the window.
    }
    anim.onfinish = () => {
      d.close();
      anim.cancel();
    };
  }, [open]);

  const dragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPhone() || (e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (ref.current) ref.current.style.transition = "none";
  };
  const dragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g || !ref.current) return;
    g.dy = Math.max(0, e.clientY - g.y);
    ref.current.style.transform = `translateY(${g.dy}px)`;
  };
  const dragEnd = () => {
    const g = drag.current;
    drag.current = null;
    const d = ref.current;
    if (!g || !d) return;
    // Far enough, or flicked: close. Otherwise spring back.
    if (g.dy > 110 || g.dy / (performance.now() - g.t) > 0.6) return onClose();
    d.style.transition = "transform 260ms cubic-bezier(0.32, 0.72, 0, 1)";
    d.style.transform = "";
  };

  return (
    <dialog
      ref={ref}
      onClose={() => {
        setShown(false);
        onClose();
      }}
      onCancel={(e) => {
        // Esc: animate away like the other ways of closing.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        // The animation replays each time showModal() makes the dialog visible. On phones it's a
        // sheet that slides up from the bottom edge, within thumb reach; elsewhere a centred window.
        "m-auto w-[calc(100%-2rem)] animate-pop rounded-2xl border border-line bg-white p-0 text-slate-900 shadow-pop",
        "max-sm:mx-0 max-sm:mt-auto max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:animate-sheet max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {shown && (
        <div className="max-sm:pb-[env(safe-area-inset-bottom)]">
          {/* The top of the sheet is its handle: drag it down to close (phones). */}
          <div onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} className="max-sm:touch-none max-sm:select-none">
            <span aria-hidden className="mx-auto mt-2 block h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5 max-sm:pt-2">
              <h2 className="text-base font-semibold">{open ? title : kept.title}</h2>
              <button type="button" onClick={onClose} className={btn("ghost", "icon")} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="max-h-[75dvh] overflow-y-auto overscroll-contain px-5 py-4 max-sm:max-h-[82dvh]">{open ? children : kept.children}</div>
        </div>
      )}
    </dialog>
  );
}

/**
 * Put inside a <Link>: a small spinner while that link's page is loading (only when it wasn't
 * prefetched). Always rendered, so the link never shifts.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return <Spinner className={cx("size-3.5 transition-opacity", pending ? "opacity-100" : "opacity-0", className)} />;
}

export type ToastMessage ={ id: number; text: string; tone: "ok" | "warn" };

/** Brief confirmation at the bottom of the screen ("Delivered · Acme"), gone after a moment. */
export function Toast({ toast, onDone }: { toast: ToastMessage | null; onDone: () => void }) {
  const tr = useT();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" role="status" aria-live="polite">
      <p
        key={toast.id}
        className={cx(
          "flex animate-toast items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-pop",
          toast.tone === "ok" ? "bg-emerald-600" : "bg-navy-900",
        )}
      >
        {toast.tone === "ok" ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
        {tr(toast.text)}
      </p>
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  const tr = useT();
  if (!message) return null;
  return <p className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{tr(message)}</p>;
}
