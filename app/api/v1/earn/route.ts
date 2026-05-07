import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedServerCall } from "@/lib/auth";
import {
  insertLedger,
  lookupIdempotency,
  pointsForEligible,
  recordIdempotency,
  withTransaction,
} from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";

const schema = z.object({
  idempotency_key: z.string().min(8).max(128),
  customer_id: z.number().int().positive(),
  sale_id: z.number().int().positive(),
  location_id: z.string().uuid().optional().nullable(),
  eligible_amount: z.number().nonnegative(),
  occurred_at: z.string().datetime().optional(),
});

/**
 * POST /api/v1/earn
 *
 * Carbon-POS calls this from its capture-route after pos_sales is
 * committed. Idempotent on `idempotency_key` AND on (source='pos',
 * source_ref='pos:sale:<sale_id>') — the unique index on the ledger is
 * the second line of defence in case the idempotency table is wiped.
 *
 * Side effect: if this is the customer's first qualifying purchase AND
 * a pending referral attribution exists, we credit BOTH sides
 * (referrer + referee) per the program rules. The
 * loyalty_referral_redemptions table has a unique index on
 * referee_customer_id, so even retried calls only fire the bonus once.
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
  const data = parsed.data;

  const cached = await lookupIdempotency(data.idempotency_key);
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const points = await pointsForEligible(data.eligible_amount);
  const settings = await getSettings();
  const sourceRef = `pos:sale:${data.sale_id}`;
  const requestHash = JSON.stringify({
    customer_id: data.customer_id,
    sale_id: data.sale_id,
    eligible_amount: data.eligible_amount,
  });

  try {
    const result = await withTransaction(async (client) => {
      const led = await insertLedger(client, {
        customer_id: data.customer_id,
        shopify_gid: null,
        delta_points: points,
        reason: "sale",
        source: "pos",
        source_ref: sourceRef,
        amount_basis: data.eligible_amount,
      });

      // ---- Referral payout (both sides) ----------------------------------
      // Look up a pending referral for this customer (no redemption yet)
      // and the qualifying-amount floor. If matched, write the two bonus
      // ledger rows + an attribution row. If anything fails, swallow —
      // the sale's earn row is already in.
      let referralPayout: null | {
        referrer_id: number;
        referrer_ledger_id: number;
        referee_ledger_id: number;
      } = null;
      try {
        if (data.eligible_amount >= Number(settings.referral_min_purchase)) {
          // A pending redemption is a row keyed on this referee that has not
          // yet received a referrer_ledger_id (set when the qualifying
          // purchase fires). We grab + lock it, credit both sides, then
          // stamp the ledger ids onto the row.
          const pending = await client.query<{
            id: string;
            referrer_customer_id: number;
          }>(
            `SELECT lrr.id::text, lr.referrer_customer_id
               FROM loyalty_referral_redemptions lrr
               JOIN loyalty_referrals lr ON lr.id = lrr.referral_id
              WHERE lrr.referee_customer_id = $1
                AND lrr.referrer_ledger_id IS NULL
              ORDER BY lrr.redeemed_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED`,
            [data.customer_id],
          );
          if (pending.rows[0] && pending.rows[0].referrer_customer_id !== data.customer_id) {
            const referrerId = pending.rows[0].referrer_customer_id;
            const referrerLed = await insertLedger(client, {
              customer_id: referrerId,
              shopify_gid: null,
              delta_points: settings.referral_reward_points,
              reason: "referral_bonus",
              source: "system",
              source_ref: `referral:referrer:sale:${data.sale_id}`,
              amount_basis: null,
            });
            const refereeLed = await insertLedger(client, {
              customer_id: data.customer_id,
              shopify_gid: null,
              delta_points: settings.referee_earns_points,
              reason: "referral_bonus",
              source: "system",
              source_ref: `referral:referee:sale:${data.sale_id}`,
              amount_basis: null,
            });
            await client.query(
              `UPDATE loyalty_referral_redemptions
                  SET qualifying_amount  = $2,
                      referrer_ledger_id = $3,
                      referee_ledger_id  = $4,
                      pos_sale_id        = $5
                WHERE id = $1`,
              [
                Number(pending.rows[0].id),
                data.eligible_amount,
                referrerLed.id,
                refereeLed.id,
                data.sale_id,
              ],
            );
            referralPayout = {
              referrer_id: referrerId,
              referrer_ledger_id: referrerLed.id,
              referee_ledger_id: refereeLed.id,
            };
          }
        }
      } catch (refErr) {
        // Referral logic is best-effort — never fail the sale's earn over it
        console.error("[/api/v1/earn] referral payout error", refErr);
      }

      const responseBody = {
        ledger_id: led.id,
        points_awarded: points,
        new_balance: led.new_balance,
        referral_payout: referralPayout,
      };
      await recordIdempotency(
        client,
        data.idempotency_key,
        "/api/v1/earn",
        requestHash,
        200,
        responseBody,
        led.id,
      );
      return responseBody;
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/v1/earn]", err);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't record the earn." },
      { status: 500 },
    );
  }
}
