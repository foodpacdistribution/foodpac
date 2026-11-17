// Kinds of food business, for the store's details and for suggesting what stores like it buy.
// Safe for client components.

import type { StoreType } from "./db/schema";

export const STORE_TYPES: Record<StoreType, string> = {
  bubble_tea: "Bubble tea & drinks",
  cafe: "Café",
  takeaway: "Takeaway",
  restaurant: "Restaurant",
  sushi: "Sushi & Japanese",
  bakery: "Bakery",
  dessert: "Desserts",
  catering: "Catering",
  grocery: "Grocery",
  other: "Other",
};
export const STORE_TYPE_KEYS = Object.keys(STORE_TYPES) as StoreType[];
export const isStoreType = (v: unknown): v is StoreType => typeof v === "string" && Object.hasOwn(STORE_TYPES, v);
