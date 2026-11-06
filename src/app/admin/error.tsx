"use client";

import { PageError } from "@/components/page-error";

// Any page in this part of the site that fails shows this instead of freezing; the layout and menu stay.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  return <PageError error={error} retry={retry} />;
}
