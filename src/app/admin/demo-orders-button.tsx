"use client";

import { Sparkles } from "lucide-react";
import { useTransition } from "react";
import { addDemoOrders } from "@/app/actions/orders";
import { btn, Spinner } from "@/components/ui";
import { useT } from "@/components/i18n";

/** Fills a day with sample orders so a first-time user can try the whole flow. */
export function DemoOrdersButton({ date }: { date: string }) {
  const tr = useT();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className={btn("ghost", "sm")}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await addDemoOrders(date);
          if (!res.ok) alert(res.error);
        })
      }
    >
      {pending ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" />} {pending ? tr("Adding…") : tr("Try it with demo orders")}
    </button>
  );
}
