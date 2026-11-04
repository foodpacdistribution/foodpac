/** Versioned poster picture URL ("desktop" or "mobile"): changes when the poster is saved, so it can be cached for good. */
export function posterImageUrl(p: { id: string; updatedAt: Date | string | number }, kind: "desktop" | "mobile" = "desktop") {
  return `/api/posters/${p.id}/${kind}/${new Date(p.updatedAt).getTime().toString(36)}`;
}
