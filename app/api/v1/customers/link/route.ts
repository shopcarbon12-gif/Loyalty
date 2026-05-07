import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedServerCall } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { findShopifyCustomer } from "@/lib/shopify";

const schema = z.object({
  customer_id: z.number().int().positive(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
});

/**
 * POST /api/v1/customers/link
 *
 * Called by POS / WMS after a pos_customers row is created or updated.
 * Looks the customer up in Shopify by email then phone, and stamps the
 * Shopify GID on the pos_customers row. Idempotent — repeated calls with
 * the same identifiers settle to the same GID.
 */
export async function POST(req: Request) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { customer_id, email, phone } = parsed.data;
  if (!email && !phone) {
    return NextResponse.json(
      { error: "no_identifier", message: "email or phone required" },
      { status: 400 },
    );
  }

  let match;
  try {
    match = await findShopifyCustomer({ email, phone });
  } catch (err) {
    // Shopify down or token missing — POS doesn't block; we'll retry later.
    console.warn("[customers/link] shopify lookup failed", err);
    return NextResponse.json({ linked: false, reason: "shopify_unreachable" });
  }
  if (!match) {
    return NextResponse.json({ linked: false, reason: "no_shopify_customer" });
  }
  await getPool().query(
    `UPDATE pos_customers
        SET shopify_customer_gid = $1,
            shopify_linked_at    = now()
      WHERE id = $2`,
    [match.gid, customer_id],
  );
  return NextResponse.json({ linked: true, shopify_gid: match.gid });
}
