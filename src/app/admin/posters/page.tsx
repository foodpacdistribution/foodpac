import type { Metadata } from "next";
import { requireUser, STAFF } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/planning";
import { listPosters } from "@/lib/posters";
import { todayIn } from "@/lib/time";
import { PostersClient } from "./posters-client";

export const metadata: Metadata = { title: "Home Page Posters" };

export default async function PostersPage() {
  await requireUser(STAFF);
  const db = await getDb();
  const [s, rows] = await Promise.all([getSettings(db), listPosters(db)]);
  return <PostersClient posters={rows} builtIn={s.builtInPosters} today={todayIn(s.timezone)} />;
}
