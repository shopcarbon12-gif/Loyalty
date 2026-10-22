import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedServerCall } from "@/lib/auth";
import { getPool } from "@/lib/db";
import {
  insertLedger,
  lookupIdempotency,
  recordIdempotency,
  withTransaction,
} from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";

const schema = z.object({
  idempotency_key: z.string().min(8).max(128),
  sale_id: z.number().int().positive(),
  refund_amount: z.number().nonnegative(),
  refund_pct: z.number().min(0).max(1).optional(),
});

/**
 * POST /api/v1/refund
 *
 * Reverses prior earn + redemption ledger rows for a sale, pro-rated by
 * `refund_pct` (defaults to 1.0 = full refund).
 *
 *   - earn rows are negated × pct (customer loses the points the sale awarded)
 *   - redemption rows are negated × pct (customer regains points they spent)
 *
 * Idempotent: rerunning with the same idempotency_key short-circuits.
 * The actual ledger inserts use source_ref keys like
 * `pos:refund:<sale_id>:<orig_id>` so a partial refund followed by a
 * second partial refund stack correctly via distinct keys per call.
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

  // Live kill-switch — refunds while paused are no-ops. If a sale earned
  // points BEFORE the program was paused, refunding it AFTER would leave
  // the customer with un-clawed-back points; that's an acceptable edge
  // case for a soft-pause and the back office can adjust manually.
  const settings = await getSettings();
  if (!settings.live) {
    return NextResponse.json({ skipped: true, reason: "live_off", reversed: [] });
  }

  const pct = data.refund_pct ?? 1;
  // Lookup all ledger rows that originated from this sale (earn + redemption).
  const orig = await getPool().query<{
    id: string;
    customer_id: number | null;
    delta_points: number;
    reason: string;
    source_ref: string | null;
  }>(
    `SELECT id::text, customer_id, delta_points, reason, source_ref
       FROM loyalty_ledger
      WHERE source = 'pos'
        AND (source_ref = $1 OR source_ref = $2)`,
    [`pos:sale:${data.sale_id}`, `pos:redeem:${data.sale_id}`],
  );
  if (orig.rowCount === 0) {
    // The sale's earn may still be waiting in POS's outbox (it failed once and
    // is retrying). Reversing nothing now would let that earn land later and
    // the customer keep points for a refunded sale — answer 503 so POS
    // retries this refund after the earn has posted.
    const pending = await getPool().query(
      `SELECT 1 FROM pos_loyalty_outbox
        WHERE endpoint = '/api/v1/earn' AND posted_at IS NULL
          AND (payload->>'sale_id')::int = $1
        LIMIT 1`,
      [data.sale_id],
    );
    if (pending.rows[0]) {
      return NextResponse.json({ error: "earn_pending", message: "Sale's earn not posted yet — retry." }, { status: 503 });
    }
    // Nothing earned or redeemed for this sale — refund is a no-op for loyalty.
    const resp = { reversed: [], message: "no_loyalty_rows" };
    return NextResponse.json(resp);
  }

  try {
    const result = await withTransaction(async (client) => {
      // Serialize refunds per customer so two concurrent refunds for the same
      // sale can't both read "already reversed = 0" and reverse the same rows
      // twice (point inflation). Mirrors the lock in /redeem and issueCoupon.
      const custIds = [
        ...new Set(
          orig.rows
            .map((r) => r.customer_id)
            .filter((x): x is number => x != null),
        ),
      ];
      for (const cid of custIds) {
        await client.query(`SELECT id FROM pos_customers WHERE id = $1 FOR UPDATE`, [cid]);
      }
      const reversed: { ledger_id: number; delta_points: number }[] = [];
      let lastBalance = 0;
      // Refunds can come in several parts. Work from the running total so the
      // parts always add up to exactly the original (no per-part rounding
      // drift) and never reverse more than was earned/redeemed. POS's own
      // refund rows (shared DB) give the exact running total: every refund on
      // this sale up to and including this one (its id leads the key,
      // "00000042-pos-refund"). Fallback: this refund's pct alone.
      const refundId = Number(/^(\d+)-pos-refund$/.exec(data.idempotency_key)?.[1] ?? NaN);
      let cumulative = pct;
      if (Number.isFinite(refundId)) {
        const sums = await client.query<{ refunded: string; total: string | null }>(
          `SELECT COALESCE(SUM(r.amount), 0)::text AS refunded,
                  (SELECT total_amount::text FROM pos_sales WHERE id = $1) AS total
             FROM pos_refunds r
            WHERE r.original_sale_id = $1
              -- an exchange writes several rows for one return (credit used +
              -- leftover payout): count all rows of this refund's exchange
              AND (r.id <= $2 OR (r.exchange_sale_id IS NOT NULL AND r.exchange_sale_id =
                     (SELECT exchange_sale_id FROM pos_refunds WHERE id = $2)))`,
          [data.sale_id, refundId],
        );
        const total = Number(sums.rows[0].total ?? 0);
        if (total > 0) cumulative = Math.min(1, Number(sums.rows[0].refunded) / total);
      }
      for (const row of orig.rows) {
        const already = await client.query<{ s: string }>(
          `SELECT COALESCE(SUM(delta_points), 0)::text AS s FROM loyalty_ledger
            WHERE source = 'pos' AND reason = 'refund' AND source_ref LIKE $1`,
          [`pos:refund:${data.sale_id}:${row.id}:%`],
        );
        // Target total reversal for this row after this refund, minus what's
        // already been reversed; same sign rules as before (earn → negative,
        // redemption → positive).
        const target = -Math.round(row.delta_points * cumulative);
        const delta = target - Number(already.rows[0].s);
        if (delta === 0 || Math.sign(delta) !== Math.sign(-row.delta_points)) continue;
        const led = await insertLedger(client, {
          customer_id: row.customer_id,
          shopify_gid: null,
          delta_points: delta,
          reason: "refund",
          source: "pos",
          source_ref: `pos:refund:${data.sale_id}:${row.id}:${data.idempotency_key}`,
          amount_basis: data.refund_amount,
        });
        reversed.push({ ledger_id: led.id, delta_points: delta });
        lastBalance = led.new_balance;
      }
      const resp = { reversed, new_balance: lastBalance };
      await recordIdempotency(
        client,
        data.idempotency_key,
        "/api/v1/refund",
        JSON.stringify({ sale_id: data.sale_id, pct }),
        200,
        resp,
        null,
      );
      return resp;
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/v1/refund]", err);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't reverse loyalty." },
      { status: 500 },
    );
  }
}
