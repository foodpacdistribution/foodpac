/** Versioned photo URL: changes only when the photo does, so it can be cached for good. */
export function productImageUrl(p: { id: string; imageAt: Date | string | number }) {
  return `/api/products/${p.id}/image/${new Date(p.imageAt).getTime().toString(36)}`;
}
