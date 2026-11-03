"use client";

import { Printer } from "lucide-react";
import { Tx } from "./i18n";

export function PrintButton({ className, label = "Print" }: { className?: string; label?: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      <Printer className="size-4" /> <Tx>{label}</Tx>
    </button>
  );
}
