"use client";

import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { useLinkStatus } from "next/link";
import { createContext, useActionState, useContext, useEffect, useRef, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useT } from "./i18n";
import { btn, cx, Spinner, TopProgress } from "./ui";

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
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        // The animation replays each time showModal() makes the dialog visible.
        "m-auto w-[calc(100%-2rem)] animate-pop rounded-2xl border border-line bg-white p-0 text-slate-900 shadow-pop",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className={btn("ghost", "icon")} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-[75dvh] overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/**
 * Put inside a <Link>: shows the top progress bar and a small spinner while that link's
 * page is loading (only when it wasn't prefetched). Always rendered, so the link never shifts.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <Spinner className={cx("size-3.5 transition-opacity", pending ? "opacity-100" : "opacity-0", className)} />
      {pending && <TopProgress />}
    </>
  );
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
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{tr(message)}</p>;
}
