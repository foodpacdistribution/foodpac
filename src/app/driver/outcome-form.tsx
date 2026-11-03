"use client";

import { LocateFixed } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { FormError, SubmitButton } from "@/components/client-ui";
import { cx, Field, inputCls, Spinner } from "@/components/ui";
import type { ActionResult } from "@/lib/action";
import { FAILURE_REASONS } from "@/lib/orders";
import { PhotoCapture, SignaturePad } from "./proof-inputs";
import { useBestFix } from "./use-location-sharing";
import { useT } from "@/components/i18n";

type Action<T> = (prev: unknown, form: FormData) => Promise<ActionResult<T>>;

/**
 * "Delivered" / "Couldn't deliver" sheet shared by the driver app and Quick route: photo,
 * signature and receiver's name, or what went wrong, plus the phone's location at that moment.
 */
export function OutcomeForm<T>({
  kind,
  action,
  fields,
  onDone,
  requirePhoto = false,
  requireSignature = false,
  proofRequired = false,
  reference = "",
}: {
  kind: "delivered" | "failed";
  action: Action<T>;
  /** Hidden values identifying the stop. */
  fields: Record<string, string>;
  onDone: (data: T | undefined) => void;
  requirePhoto?: boolean;
  requireSignature?: boolean;
  /** A photo or a signature must come with every delivery. */
  proofRequired?: boolean;
  reference?: string;
}) {
  const tr = useT();
  const [state, submit] = useActionState(action, undefined);
  const [photo, setPhoto] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");
  const fix = useBestFix();
  useEffect(() => {
    if (state?.ok) onDone(state.data);
  }, [state, onDone]);

  // What still stops the driver confirming, said next to the button instead of a silent grey one.
  const missing =
    kind === "delivered"
      ? requirePhoto && !photo
        ? "Take a delivery photo."
        : requireSignature && !signature
          ? "Get the customer's signature."
          : proofRequired && !photo && !signature
            ? "Take a photo or get a signature to confirm the delivery."
            : null
      : !reason
        ? "Choose what happened."
        : null;

  return (
    <form
      action={(fd) => {
        // Images live in component state (resized / drawn), so attach them here.
        if (photo) fd.set("photo", photo);
        if (signature) fd.set("signature", signature);
        if (fix) {
          fd.set("lat", String(fix.lat));
          fd.set("lng", String(fix.lng));
          fd.set("accuracy", String(fix.accuracy));
        }
        return submit(fd);
      }}
      className="space-y-4"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {kind === "delivered" ? (
        <>
          <PhotoCapture value={photo} onChange={setPhoto} required={requirePhoto} />
          <Field label={tr(signature || requireSignature ? "Received by *" : "Received by (optional)")}>
            <input
              name="recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="off"
              required={!!signature || requireSignature}
              className={cx(inputCls, "h-11 text-base")}
            />
          </Field>
          <SignaturePad
            onChange={setSignature}
            required={requireSignature}
            signer={recipient}
            onSignerChange={setRecipient}
            reference={reference}
            accuracyM={fix ? fix.accuracy : null}
          />
        </>
      ) : (
        <>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="mb-1.5 text-xs font-medium text-slate-600">{tr("What happened?")} *</legend>
            {FAILURE_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm has-[:checked]:border-red-400 has-[:checked]:bg-red-50">
                <input type="radio" name="reason" value={r} required checked={reason === r} onChange={() => setReason(r)} />
                {tr(r)}
              </label>
            ))}
          </fieldset>
          <PhotoCapture value={photo} onChange={setPhoto} />
        </>
      )}
      <Field label={tr(reason === "Other" ? "Note *" : "Note (optional)")}>
        <textarea
          name="note"
          rows={2}
          required={kind === "failed" && reason === "Other"}
          placeholder={kind === "failed" && reason === "Other" ? tr("What happened?") : undefined}
          className={cx(inputCls, "h-auto py-2 text-base")}
        />
      </Field>
      <p className={cx("flex items-center gap-1.5 text-xs", fix && fix.accuracy <= 30 ? "text-emerald-700" : "text-slate-500")}>
        {fix ? <LocateFixed className="size-3.5" /> : <Spinner className="size-3" />}
        {fix ? tr("Location recorded with this delivery · ±{m} m", { m: Math.round(fix.accuracy) }) : tr("Getting your exact location…")}
      </p>
      <FormError message={state && !state.ok ? state.error : null} />
      {missing && <p className="text-center text-xs font-medium text-amber-700">{tr(missing)}</p>}
      <SubmitButton disabled={!!missing} variant={kind === "delivered" ? "success" : "primary"} size="lg" className="w-full rounded-xl" pendingText={tr("Uploading…")}>
        {kind === "delivered" ? tr("Confirm delivered") : tr("Report problem")}
      </SubmitButton>
    </form>
  );
}
