"use client";

import { ImageUp } from "lucide-react";
import { useRef, useState } from "react";
import { resizeImage } from "@/lib/resize-image";
import { useT } from "./i18n";
import { btn, Spinner } from "./ui";

/**
 * A "Choose picture" button for a form. The picture is shrunk in the browser first (so photos
 * straight off a phone fit under the upload limit) and handed back for a preview.
 */
export function ImageInput({
  name,
  maxSide,
  required,
  label = "Choose picture",
  onPreview,
}: {
  name: string;
  maxSide: number;
  required?: boolean;
  label?: string;
  onPreview: (url: string | null) => void;
}) {
  const tr = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  return (
    <label className={btn("secondary", "md", "cursor-pointer")}>
      {working ? <Spinner className="size-3.5" /> : <ImageUp className="size-4" />}
      {tr(label)}
      <input
        ref={ref}
        name={name}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required={required}
        className="sr-only"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return onPreview(null);
          setWorking(true);
          const small = await resizeImage(file, maxSide);
          // Swap the shrunk file into the input, so the form uploads that one.
          if (small !== file && ref.current) {
            const dt = new DataTransfer();
            dt.items.add(small);
            ref.current.files = dt.files;
          }
          setWorking(false);
          onPreview(URL.createObjectURL(small));
        }}
      />
    </label>
  );
}
