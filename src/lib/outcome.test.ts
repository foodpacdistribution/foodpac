import { describe, expect, it } from "vitest";
import { readOutcome } from "./outcome";

// Smallest valid PNG (1×1), as the signature pad uploads.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

describe("readOutcome", () => {
  it("accepts a signature without the name of whoever signed", async () => {
    const form = new FormData();
    form.set("signature", new File([PNG], "signature.png", { type: "image/png" }));
    const o = await readOutcome(form, "delivered", { requirePhoto: false, requireSignature: true });
    expect(o.type).toBe("delivered");
    expect(o.signature).not.toBeNull();
    expect(o.type === "delivered" && o.recipient).toBeNull();
  });

  it("still keeps a name when the driver enters one", async () => {
    const form = new FormData();
    form.set("signature", new File([PNG], "signature.png", { type: "image/png" }));
    form.set("recipient", " Hao Lin ");
    const o = await readOutcome(form, "delivered", { requirePhoto: false, requireSignature: true });
    expect(o.type === "delivered" && o.recipient).toBe("Hao Lin");
  });
});
