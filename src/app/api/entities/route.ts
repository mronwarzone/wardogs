import { NextResponse } from "next/server";
import { getEntityStore } from "@/lib/entityStore";

export const dynamic = "force-dynamic";

/** One-shot snapshot (polling fallback if SSE unavailable). */
export async function GET() {
  const store = getEntityStore();
  return NextResponse.json(store.frame());
}
