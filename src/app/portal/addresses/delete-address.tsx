"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { deleteAddress } from "@/app/actions/shop";

export function DeleteAddress({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      aria-label="Delete address"
      disabled={pending}
      onClick={() => start(async () => void (await deleteAddress(id)))}
      className="grid size-8 place-items-center rounded-full text-leaf-900/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
    >
      <Trash2 className="size-4" />
    </button>
  );
}
