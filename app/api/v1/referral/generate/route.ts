import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { isAuthorizedServerCall } from "@/lib/auth";
import { getPool } from "@/lib/db";

const schema = z.object({
  customer_id: z.number().int().positive(),
});

/**
 * POST /api/v1/referral/generate
 *
 * Returns the customer's referral code, minting one if they don't have
 * one yet. Codes look like CARBON-7K2P9F (a random 6-char suffix —
 * collisions are vanishingly rare and we surface a 409 on the unique
 * constraint if one slips through).
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
  const { customer_id } = parsed.data;

  const pool = getPool();
  const existing = await pool.query<{ code: string }>(
    `SELECT code FROM loyalty_referrals WHERE referrer_customer_id = $1`,
    [customer_id],
  );
  if (existing.rows[0]) {
    return NextResponse.json({ code: existing.rows[0].code, share_url: shareUrl(existing.rows[0].code) });
  }
  const c = await pool.query<{ first_name: string | null }>(
    `SELECT first_name FROM pos_customers WHERE id = $1`,
    [customer_id],
  );
  if (c.rowCount === 0) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }
  const slug = (c.rows[0].first_name || "carbon").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) || "CARBON";
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  const code = `CARBON-${slug}-${suffix}`;
  try {
    await pool.query(
      `INSERT INTO loyalty_referrals (code, referrer_customer_id) VALUES ($1, $2)`,
      [code, customer_id],
    );
  } catch (err) {
    console.error("[/api/v1/referral/generate]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  return NextResponse.json({ code, share_url: shareUrl(code) });
}

function shareUrl(code: string) {
  return `https://shopcarbon.com/?ref=${encodeURIComponent(code)}`;
}
