import { NextResponse } from "next/server";
import { isAuthorizedServerCall } from "@/lib/auth";
import { syncCustomersToShopify } from "@/lib/customer-sync";

/**
 * POST /api/cron/customer-sync
 *
 * Pushes member edits made in POS / WMS to Shopify (lib/customer-sync.ts).
 * Run every minute by a Coolify scheduled task (bearer LOYALTY_API_KEY).
 */
export async function POST(req: Request) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncCustomersToShopify()) });
  } catch (err) {
    console.error("[customer-sync]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
