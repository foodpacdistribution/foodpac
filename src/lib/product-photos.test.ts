import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type DB, schema } from "./db";
import { goodsPhotos, products } from "./db/schema";
import { codeFromFileName, fillProductPhotosFromInvoices, goodsPhotoId } from "./goods-photos";

const state = { db: null as unknown as DB };
vi.mock("./db", async (orig) => ({ ...(await orig<typeof import("./db")>()), getDb: async () => state.db }));
vi.mock("./auth/dal", async (orig) => ({ ...(await orig<typeof import("./auth/dal")>()), assertUser: async () => ({ id: "u", role: "admin" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { uploadProductPhoto } = await import("@/app/actions/products");

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 0, 0, 0]);
const product = (sku: string, name: string) => ({ sku, name, priceCents: 100 });
const photoOf = async (sku: string) => (await state.db.select().from(products).where(eq(products.sku, sku)))[0];

beforeAll(async () => {
  const lite = drizzle(new PGlite(), { schema });
  await migrate(lite, { migrationsFolder: "drizzle" });
  state.db = lite as unknown as DB;
}, 30000);

describe("codeFromFileName", () => {
  it("reads product codes the way the import writes them", () => {
    expect(codeFromFileName("RB-BOWLPA16.jpg")).toBe("RB-BOWLPA16");
    expect(codeFromFileName("rb sushich1 bx.png")).toBe("RB-SUSHICH1-BX");
    // EMERGE's "RB-BAPAW1/2B": a slash can't be in a file name, so Finder shows ":" and the import "-".
    expect(codeFromFileName("RB-BAPAW1:2B.jpeg")).toBe("RB-BAPAW1-2B");
  });
});

describe("photos printed on invoices", () => {
  it("go to products of the same name that have none, never over an uploaded one", async () => {
    await state.db.insert(products).values([product("A1", "PAPER BOWL 520ml (16oz) White"), product("A2", "Kraft bag"), { ...product("A3", "Cling wrap"), image: jpeg(9), imageMime: "image/jpeg" }]);
    await state.db.insert(goodsPhotos).values(
      ["paper bowl  520ml (16oz) white", "Cling wrap"].map((name, i) => ({ id: goodsPhotoId(name), name, mime: "image/jpeg", bytes: 8, data: jpeg(i + 1) })),
    );
    expect(await fillProductPhotosFromInvoices(state.db)).toBe(1);
    expect((await photoOf("A1")).image).toEqual(jpeg(1));
    expect((await photoOf("A2")).image).toBeNull();
    expect((await photoOf("A3")).image).toEqual(jpeg(9));
  });
});

describe("uploadProductPhoto", () => {
  const upload = (fileName: string, data = jpeg(7)) => {
    const f = new FormData();
    f.set("fileName", fileName);
    f.set("photo", new File([data], fileName, { type: "image/jpeg" }));
    return uploadProductPhoto(f);
  };

  it("finds the product by code or by name and replaces its photo", async () => {
    expect(await upload("a1.jpg")).toMatchObject({ ok: true, data: { sku: "A1" } });
    expect((await photoOf("A1")).image).toEqual(jpeg(7));
    expect(await upload("kraft  BAG.png", jpeg(5))).toMatchObject({ ok: true, data: { sku: "A2" } });
    expect((await photoOf("A2")).image).toEqual(jpeg(5));
  });

  it("says when nothing matches", async () => {
    expect(await upload("unknown-thing.jpg")).toMatchObject({ ok: false, error: expect.stringContaining("No product") });
  });
});
