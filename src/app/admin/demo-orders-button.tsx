"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { addDemoOrders } from "@/app/actions/orders";
import { btn, Spinner } from "@/components/ui";

/** Fills a day with sample orders so a first-time user can try the whole flow. */
export function DemoOrdersButton({ date }: { date: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className={btn("ghost", "sm")}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await addDemoOrders(date);
          if (!res.ok) alert(res.error);
          router.refresh();
        })
      }
    >
      {pending ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" />} {pending ? "Adding…" : "Try it with demo orders"}
    </button>
  );
}
