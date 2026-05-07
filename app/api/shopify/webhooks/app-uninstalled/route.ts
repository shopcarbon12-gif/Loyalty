import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { clearSettingsCache } from "@/lib/settings";

/**
 * POST /api/shopify/webhooks/app-uninstalled
 *
 * Safety mechanism. If someone uninstalls the Carbon Loyalty app from
 * the Shopify admin, we auto-flip live=false so the program pauses
 * cleanly instead of silently rejecting webhook signatures from a
 * shop we can no longer reach. The back office can re-install + flip
 * live=true to resume.
 *
 * We don't drop ledger rows — those are the program's audit trail.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  try {
    await getPool().query(
      `UPDATE loyalty_settings SET live = FALSE, updated_at = now() WHERE id = 1`,
    );
    clearSettingsCache();
    return NextResponse.json({ ok: true, action: "live_set_false" });
  } catch (err) {
    console.error("[app-uninstalled]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
