"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteAddress } from "@/app/actions/shop";
import { useT } from "@/components/i18n";

export function DeleteAddress({ id }: { id: string }) {
  const tr = useT();
  const [pending, start] = useTransition();
  return (
    <button
      aria-label={tr("Delete address")}
      disabled={pending}
      onClick={() => start(async () => void (await deleteAddress(id)))}
      className="grid size-8 place-items-center rounded-full text-leaf-900/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
