import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedServerCall } from "@/lib/auth";
import { withTransaction } from "@/lib/loyalty";

const schema = z.object({
  referral_code: z.string().min(4).max(64),
  referee_customer_id: z.number().int().positive(),
});

/**
 * POST /api/v1/referral/attribute
 *
 * Stores a "pending" referral redemption when a new customer signs up
 * with a referral code. The bonus is paid out later — when /api/v1/earn
 * sees their first purchase ≥ referral_min_purchase. This endpoint just
 * records the attribution.
 *
 * Idempotent: the unique index on loyalty_referral_redemptions
 * (referee_customer_id) means a re-call is a no-op.
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
  const { referral_code, referee_customer_id } = parsed.data;

  try {
    const result = await withTransaction(async (client) => {
      const ref = await client.query<{ id: string; referrer_customer_id: number }>(
        `SELECT id::text, referrer_customer_id
           FROM loyalty_referrals
          WHERE code = $1`,
        [referral_code],
      );
      if (!ref.rows[0]) return { ok: false as const, reason: "code_not_found" };
      if (ref.rows[0].referrer_customer_id === referee_customer_id) {
        return { ok: false as const, reason: "self_referral" };
      }
      const ins = await client.query<{ id: string }>(
        `INSERT INTO loyalty_referral_redemptions (referral_id, referee_customer_id)
         VALUES ($1, $2)
         ON CONFLICT (referee_customer_id) WHERE referee_customer_id IS NOT NULL DO NOTHING
         RETURNING id::text`,
        [Number(ref.rows[0].id), referee_customer_id],
      );
      return {
        ok: true as const,
        attribution_id: ins.rows[0]?.id ?? null,
        referrer_customer_id: ref.rows[0].referrer_customer_id,
        already_attributed: ins.rowCount === 0,
      };
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/v1/referral/attribute]", err);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't attribute referral." },
      { status: 500 },
    );
  }
}
