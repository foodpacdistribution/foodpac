/** Versioned photo URL: changes when the product is saved, so it can be cached for good. */
export function productImageUrl(p: { id: string; updatedAt: Date | string | number }) {
  return `/api/products/${p.id}/image/${new Date(p.updatedAt).getTime().toString(36)}`;
}
