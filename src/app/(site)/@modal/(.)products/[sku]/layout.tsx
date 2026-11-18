import { ProductSheet } from "../../../product-sheet";

/** The sheet stays put while its product loads, so it opens the moment a product is tapped. */
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return <ProductSheet title="Product">{children}</ProductSheet>;
}
