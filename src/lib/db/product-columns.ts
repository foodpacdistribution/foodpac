import { getTableColumns } from "drizzle-orm";
import { products } from "./schema";

const { image: _photo, ...columns } = getTableColumns(products);

/** A product without its photo: for reading names, prices and stock, where the picture would only be dead weight. */
export const productColumns = columns;
