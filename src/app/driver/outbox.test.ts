import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The phone's outbox: photos go up in parcels the server can take, and one that's too big never
// holds up the deliveries behind it. (No IndexedDB here: the outbox then keeps items in memory.)

type Outbox = typeof import("./outbox");
let outbox: Outbox;

const photo = (kb: number, name = "delivery.jpg") => new File([new Uint8Array(kb * 1024)], name, { type: "image/jpeg" });
const meta = { stopId: "stop-1", name: "Cafe" };

/** A server that turns away anything over `maxFiles` photos the way Vercel does: 413 and no JSON. */
function server(maxFiles: number) {
  const received: number[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: FormData }) => {
    const n = init.body.getAll("photo").length;
    if (n > maxFiles) return new Response("Request Entity Too Large", { status: 413 });
    received.push(n);
    return Response.json({ ok: true });
  });
  return received;
}

beforeEach(async () => {
  vi.resetModules();
  outbox = await import("./outbox");
});
afterEach(() => vi.unstubAllGlobals());

describe("photoBatches", () => {
  it("keeps each upload under the limit and the photos in order", () => {
    const files = [{ size: 2 }, { size: 2 }, { size: 1 }, { size: 3 }];
    expect(outbox.photoBatches(files, 4)).toEqual([[files[0], files[1]], [files[2], files[3]]]);
  });

  it("sends a photo that's too big on its own by itself", () => {
    const files = [{ size: 1 }, { size: 9 }, { size: 1 }];
    expect(outbox.photoBatches(files, 4)).toEqual([[files[0]], [files[1]], [files[2]]]);
  });
});

describe("sending photos", () => {
  it("uploads ten large photos in several parcels", async () => {
    const received = server(10);
    await outbox.addPhotosToOutbox(Array.from({ length: 10 }, () => photo(600)), meta);
    await vi.waitFor(() => expect(received.reduce((a, b) => a + b, 0)).toBe(10));
    expect(received.length).toBeGreaterThan(1);
  });

  it("splits an upload already waiting on the phone when the server says it's too big", async () => {
    const received = server(2);
    // Under the size limit, so it goes up as one parcel and is turned away by the server.
    await outbox.addPhotosToOutbox(Array.from({ length: 5 }, () => photo(10)), meta);
    await vi.waitFor(() => expect(received.reduce((a, b) => a + b, 0)).toBe(5));
  });

  it("sets aside a delivery that's too big and still sends the ones behind it", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: FormData }) => {
      const stopId = String(init.body.get("stopId"));
      if (stopId === "too-big") return new Response("Request Entity Too Large", { status: 413 });
      sent.push(stopId);
      return Response.json({ ok: true });
    });
    const delivered = (stopId: string) => {
      const form = new FormData();
      form.append("stopId", stopId);
      return outbox.addToOutbox(form, { stopId, kind: "delivered", name: stopId });
    };
    await delivered("too-big");
    await delivered("next-stop");
    await vi.waitFor(() => expect(sent).toContain("next-stop"));
  });
});
