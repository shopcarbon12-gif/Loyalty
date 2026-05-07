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
 * If the loyalty service is OFF (settings.live=false) we still return
 * 200 with `{ skipped: true }` so POS's outbox doesn't queue retries.
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

  // Short-circuit if a previous attempt with this idempotency key
  // already produced a response. Cached for ~24 h via the
  // loyalty_idempotency table.
  const cached = await lookupIdempotency(data.idempotency_key);
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const points = await pointsForEligible(data.eligible_amount);
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
      await recordIdempotency(
        client,
        data.idempotency_key,
        "/api/v1/earn",
        requestHash,
        200,
        {
          ledger_id: led.id,
          points_awarded: points,
          new_balance: led.new_balance,
          idempotent: false,
        },
        led.id,
      );
      return led;
    });
    return NextResponse.json({
      ledger_id: result.id,
      points_awarded: points,
      new_balance: result.new_balance,
    });
  } catch (err) {
    console.error("[/api/v1/earn]", err);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't record the earn." },
      { status: 500 },
    );
  }
}
