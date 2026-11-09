"use client";

import { MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "./i18n";
import { cx, inputCls, Spinner } from "./ui";

type Suggestion = { id: string; main: string; secondary: string; text: string };
export type PickedAddress = { text: string; lat: number | null; lng: number | null };

const newSession = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));

/**
 * Address field with suggestions as you type (Google Places, or OpenStreetMap as a fallback).
 * Picking a Google suggestion also returns its exact position. Works controlled (`value` +
 * `onChange`) or inside a plain form (`name` + `defaultValue`).
 */
export function AddressInput({
  value: controlled,
  onChange,
  onPick,
  name,
  defaultValue,
  near,
  placeholder,
  className,
  inputClassName,
  clearOnPick,
  required,
  autoFocus,
  "aria-label": ariaLabel,
}: {
  value?: string;
  onChange?: (text: string) => void;
  onPick?: (a: PickedAddress) => void;
  name?: string;
  defaultValue?: string;
  near?: { lat: number; lng: number } | null;
  placeholder?: string;
  className?: string;
  /** Replaces the default input styling (e.g. the shop's rounded fields). */
  inputClassName?: string;
  clearOnPick?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
}) {
  const tr = useT();
  const listId = useId();
  const [own, setOwn] = useState(defaultValue ?? "");
  const value = controlled ?? own;
  const setValue = (v: string) => (onChange ? onChange(v) : setOwn(v));
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const session = useRef(newSession());
  const box = useRef<HTMLDivElement>(null);
  const nearLat = near?.lat ?? null;
  const nearLng = near?.lng ?? null;

  // Ask for suggestions a moment after typing stops; drop answers to older keystrokes.
  useEffect(() => {
    if (query === null) return;
    const q = query.trim();
    if (q.length < 3) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const sp = new URLSearchParams({ q, session: session.current });
        if (nearLat !== null && nearLng !== null) {
          sp.set("lat", nearLat.toFixed(3));
          sp.set("lng", nearLng.toFixed(3));
        }
        const res = await fetch(`/api/places?${sp}`, { signal: ctl.signal });
        const body = res.ok ? ((await res.json()) as { suggestions: Suggestion[] }) : { suggestions: [] };
        setItems(body.suggestions);
        setActive(-1);
        setOpen(true);
      } catch {
        // Aborted or offline: the field still works as plain text.
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, nearLat, nearLng]);

  useEffect(() => {
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const pick = async (s: Suggestion) => {
    setOpen(false);
    setItems([]);
    setQuery(null);
    let picked: PickedAddress = { text: s.text, lat: null, lng: null };
    if (s.id.startsWith("g:")) {
      setLoading(true);
      try {
        const res = await fetch(`/api/places?${new URLSearchParams({ id: s.id, session: session.current })}`);
        const body = res.ok ? ((await res.json()) as { place: { text: string; lat: number; lng: number } | null }) : { place: null };
        if (body.place) picked = { text: s.text, lat: body.place.lat, lng: body.place.lng };
      } catch {
        // Keep the text; it will be looked up like any typed address.
      } finally {
        setLoading(false);
      }
    }
    // A pick ends the billing session; the next search starts a new one.
    session.current = newSession();
    setValue(clearOnPick ? "" : picked.text);
    onPick?.(picked);
  };

  const showList = open && value.trim().length >= 3;

  return (
    <div ref={box} className={cx("relative", className)}>
      <input
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        name={name}
        value={value}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          setQuery(e.target.value);
          if (e.target.value.trim().length < 3) setItems([]);
        }}
        onFocus={() => items.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!showList || !items.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className={cx(inputClassName ?? cx(inputCls, "h-11 text-base"), "pr-9")}
      />
      <span className="pointer-events-none absolute top-3 right-3 text-slate-400">{loading ? <Spinner className="size-4" /> : <MapPin className="size-4" />}</span>
      {showList && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-pop">
          {items.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-slate-500">{loading ? tr("Searching…") : tr("No matching addresses. Keep typing or enter it in full.")}</li>
          ) : (
            items.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // pointerdown so the pick lands before the input loses focus.
                onPointerDown={(e) => (e.preventDefault(), pick(s))}
                onMouseEnter={() => setActive(i)}
                className={cx("flex cursor-pointer items-start gap-2.5 px-3 py-2", i === active && "bg-blue-50")}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{s.main}</span>
                  {s.secondary && <span className="block truncate text-xs text-slate-500">{s.secondary}</span>}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
