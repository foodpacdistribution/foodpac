"use client";

import { Printer } from "lucide-react";

export function PrintButton({ className, label = "Print" }: { className?: string; label?: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      <Printer className="size-4" /> {label}
    </button>
  );
}
