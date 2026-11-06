"use client";

import { PageError } from "@/components/page-error";

// Catches what the section boundaries can't: a failure in a section's own layout (the back office
// and portal layouts load the signed-in user and the menu counts), which would otherwise show the
// bare "Application error" screen.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10">
      <PageError error={error} retry={retry} />
    </div>
  );
}
