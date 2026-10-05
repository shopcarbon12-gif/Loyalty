import { NextResponse } from "next/server";
import { getPool } from "./db";
import { verifyAppProxySignature } from "./shopify-hmac";

/**
 * Resolve the logged-in storefront customer on an app-proxy request
 * (shopcarbon.com/apps/loyalty/* → rewards.shopcarbon.com/apps/loyalty/*).
 *
 * Shopify signs the query string, including logged_in_customer_id and
 * timestamp. The POST body isn't signed, so mutating routes pass
 * `fresh: true` to refuse signatures older than five minutes.
 */
export async function proxyCustomer(
  req: Request,
  opts: { fresh?: boolean } = {},
): Promise<
  | { ok: true; gid: string; customerId: number | null; firstName: string | null }
  | { ok: false; res: NextResponse }
> {
  const url = new URL(req.url);
  if (!verifyAppProxySignature(url)) {
    return { ok: false, res: NextResponse.json({ error: "invalid_signature" }, { status: 401 }) };
  }
  if (opts.fresh) {
    const ts = Number(url.searchParams.get("timestamp"));
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return { ok: false, res: NextResponse.json({ error: "stale_request", message: "Please refresh and try again." }, { status: 401 }) };
    }
  }
  const id = url.searchParams.get("logged_in_customer_id");
  if (!id) {
    return { ok: false, res: NextResponse.json({ logged_in: false, error: "not_logged_in", message: "Sign in to use your points." }, { status: 401 }) };
  }
  // Storefront sends the numeric id; we store the Admin GID.
  const gid = `gid://shopify/Customer/${id}`;
  const r = await getPool().query<{ id: number; first_name: string | null }>(
    `SELECT id, first_name FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [gid],
  );
  return { ok: true, gid, customerId: r.rows[0]?.id ?? null, firstName: r.rows[0]?.first_name ?? null };
}
