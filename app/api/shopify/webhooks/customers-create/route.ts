import { NextResponse } from "next/server";
import { getPool, withTransaction } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { insertLedger } from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";

/**
 * POST /api/shopify/webhooks/customers-create
 *
 * Shopify fires this when a customer signs up on the storefront. We
 * mirror them into pos_customers (matching on email + phone, like
 * Kangaroo's "Email and Phone" sync key) and award the welcome bonus.
 *
 * Idempotent on (source='system', source_ref='welcome:<gid>') — the
 * unique ledger index prevents a second welcome bonus on retry.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  let c: ShopifyCustomer;
  try {
    c = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const settings = await getSettings();
  if (!settings.live) return NextResponse.json({ ok: true, skipped: "live_off" });

  const gid = c.admin_graphql_api_id;
  if (!gid) return NextResponse.json({ ok: true, skipped: "no_gid" });

  try {
    const result = await withTransaction(async (client) => {
      // Match by GID first; fall back to email+phone for cross-channel
      // customers who already shopped in store.
      const existing = await client.query<{ id: number }>(
        `SELECT id FROM pos_customers
          WHERE shopify_customer_gid = $1
             OR (email IS NOT NULL AND email = $2 AND phone_2 IS NOT NULL AND phone_2 = $3)
             OR (email IS NOT NULL AND email = $2 AND phone IS NOT NULL AND phone = $3)
          ORDER BY shopify_customer_gid IS NOT NULL DESC
          LIMIT 1`,
        [gid, c.email ?? "", c.phone ?? ""],
      );
      let customerId: number;
      if (existing.rows[0]) {
        customerId = existing.rows[0].id;
        // Backfill the GID link if it wasn't set yet.
        await client.query(
          `UPDATE pos_customers
              SET shopify_customer_gid = COALESCE(shopify_customer_gid, $1),
                  shopify_linked_at    = COALESCE(shopify_linked_at, now())
            WHERE id = $2`,
          [gid, customerId],
        );
      } else {
        // Build "City, ST" from Shopify shipping/default address so the
        // member shows up in WMS with real geo provenance instead of "—".
        const geo = formatGeo(c.default_address);
        const ins = await client.query<{ id: number }>(
          `INSERT INTO pos_customers
             (first_name, last_name, email, phone, birthday,
              shopify_customer_gid, shopify_linked_at,
              created_via, created_at_geo, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now(), 'shopify', $7, now())
           RETURNING id`,
          [
            c.first_name ?? null,
            c.last_name ?? null,
            c.email ?? null,
            c.phone ?? null,
            null, // Shopify customer payload doesn't carry birthdate by default
            gid,
            geo,
          ],
        );
        customerId = ins.rows[0].id;
      }

      // Welcome bonus — idempotent on the unique source/source_ref index.
      const bonus = settings.signup_bonus_points;
      let welcomeLed: { id: number; new_balance: number } | null = null;
      if (bonus > 0) {
        welcomeLed = await insertLedger(client, {
          customer_id: customerId,
          shopify_gid: gid,
          delta_points: bonus,
          reason: "signup_bonus",
          source: "system",
          source_ref: `welcome:${gid}`,
          amount_basis: null,
        });
      }
      return { customer_id: customerId, welcome_ledger: welcomeLed };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[customers-create]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

type ShopifyCustomer = {
  admin_graphql_api_id?: string;
  id?: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  default_address?: {
    city?: string | null;
    province?: string | null;
    province_code?: string | null;
    country_code?: string | null;
  } | null;
};

/**
 * "City, ST" or "City" or "ST" — never an empty trailing comma. Returns
 * null if neither field is present so the column stays NULL instead of
 * ", " junk.
 */
function formatGeo(addr: ShopifyCustomer["default_address"]): string | null {
  if (!addr) return null;
  const city = (addr.city ?? "").trim();
  const state = (addr.province_code ?? addr.province ?? "").trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}
