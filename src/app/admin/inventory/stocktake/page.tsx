import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { StocktakeClient } from "./stocktake-client";

export const metadata: Metadata = { title: "Stocktake" };

export default async function StocktakePage() {
  await requireUser(STAFF);
  return <StocktakeClient />;
}
