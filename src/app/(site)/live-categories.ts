import "server-only";
import { cache } from "react";
import type { DB } from "@/lib/db";
import { listCategories } from "@/lib/shop";

/** Products on sale per range. Read once per request, however many parts of the page need it. */
export const categoryCounts = cache((db: DB) => listCategories(db));

export { stockedCategories } from "./content";
