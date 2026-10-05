import { NextResponse } from "next/server";
import { isAuthorizedServerCall } from "@/lib/auth";
import { syncBalanceMetafields } from "@/lib/metafield-sync";

/**
 * POST /api/cron/sync-metafields
 *
 * Pushes changed loyalty balances to Shopify customer metafields. Run every
 * minute by a Coolify scheduled task on this app (bearer LOYALTY_API_KEY).
 */
export async function POST(req: Request) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 500, 1), 5000);
  try {
    return NextResponse.json({ ok: true, ...(await syncBalanceMetafields(limit)) });
  } catch (err) {
    console.error("[sync-metafields]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
