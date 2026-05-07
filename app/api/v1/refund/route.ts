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
    // Nothing earned or redeemed for this sale — refund is a no-op for loyalty.
    const resp = { reversed: [], message: "no_loyalty_rows" };
    return NextResponse.json(resp);
  }

  try {
    const result = await withTransaction(async (client) => {
      const reversed: { ledger_id: number; delta_points: number }[] = [];
      let lastBalance = 0;
      for (const row of orig.rows) {
        const delta = -Math.round(row.delta_points * pct);
        if (delta === 0) continue;
        const led = await insertLedger(client, {
          customer_id: row.customer_id,
          shopify_gid: null,
          delta_points: delta,
          reason: "refund",
          source: "pos",
          source_ref: `pos:refund:${data.sale_id}:${row.id}:${data.idempotency_key.slice(0, 8)}`,
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
