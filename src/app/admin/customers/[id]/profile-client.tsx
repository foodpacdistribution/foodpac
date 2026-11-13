"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "@/components/client-ui";
import { useT } from "@/components/i18n";
import { btn, cx } from "@/components/ui";
import { type Customer, CustomerForm } from "../customers-client";

export type ProfileTab = { key: string; label: string; count?: number; panel: React.ReactNode };

/**
 * The customer page's sections, one at a time. The open one is kept in the address (#orders),
 * so a link like /admin/customers/<id>#credit opens straight onto it and Back returns to it.
 */
export function ProfileTabs({ tabs }: { tabs: ProfileTab[] }) {
  const tr = useT();
  const [active, setActive] = useState(tabs[0]?.key);
  useEffect(() => {
    const fromHash = () => {
      const k = window.location.hash.slice(1);
      if (tabs.some((t) => t.key === k)) setActive(k);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div>
      <div role="tablist" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={t.key === current.key}
            onClick={() => {
              setActive(t.key);
              history.replaceState(null, "", `#${t.key}`);
            }}
            className={cx(
              "relative -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              t.key === current.key ? "border-blue-600 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
            )}
          >
            {tr(t.label)}
            {t.count !== undefined && (
              <span className={cx("rounded-full px-1.5 text-[11px] tabular-nums", t.key === current.key ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500")}>{t.count}</span>
            )}
          </button>
        ))}
      </div>
      <div key={current.key} role="tabpanel" className="animate-fade-in pt-4">
        {current.panel}
      </div>
    </div>
  );
}

/** Edit button on the customer page: the same form as on the Customers list. */
export function EditCustomer({ customer, isAdmin, sales }: { customer: Customer; isAdmin: boolean; sales: boolean }) {
  const tr = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btn("secondary")} onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> {tr("Edit")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={tr("Edit customer")}>
        {open && (
          <CustomerForm
            customer={customer}
            isAdmin={isAdmin}
            sales={sales}
            onDone={() => setOpen(false)}
            onDeleted={() => router.replace("/admin/customers")}
          />
        )}
      </Modal>
    </>
  );
}
