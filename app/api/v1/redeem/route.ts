import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedServerCall } from "@/lib/auth";
import {
  dollarsForPoints,
  getBalance,
  insertLedger,
  lookupIdempotency,
  recordIdempotency,
  withTransaction,
} from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";

const schema = z.object({
  idempotency_key: z.string().min(8).max(128),
  customer_id: z.number().int().positive(),
  sale_id: z.number().int().positive(),
  points: z.number().int().positive(),
});

/**
 * POST /api/v1/redeem
 *
 * Server-to-server. Returns the redemption value in dollars so the POS
 * cart can show the discount line. Validates against:
 *   - balance ≥ points
 *   - points is a multiple of redeem_increment_points
 *   - points ≥ min_redeem_points
 *
 * (max_redeem_pct_of_order is enforced by the caller — we don't know the
 * order subtotal here. POS validates it client-side AND server-side
 * before issuing the redemption.)
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

  const s = await getSettings();
  if (data.points < s.min_redeem_points) {
    return NextResponse.json(
      { error: "below_minimum", message: `Minimum redemption is ${s.min_redeem_points} points.` },
      { status: 422 },
    );
  }
  if (data.points % s.redeem_increment_points !== 0) {
    return NextResponse.json(
      {
        error: "increment_invalid",
        message: `Points must be a multiple of ${s.redeem_increment_points}.`,
      },
      { status: 422 },
    );
  }
  const balance = await getBalance(data.customer_id);
  if (balance < data.points) {
    return NextResponse.json(
      { error: "insufficient_balance", message: "Not enough points." },
      { status: 402 },
    );
  }

  const dollarsOff = await dollarsForPoints(data.points);
  const sourceRef = `pos:redeem:${data.sale_id}`;
  const requestHash = JSON.stringify({
    customer_id: data.customer_id,
    sale_id: data.sale_id,
    points: data.points,
  });

  try {
    const result = await withTransaction(async (client) => {
      const led = await insertLedger(client, {
        customer_id: data.customer_id,
        shopify_gid: null,
        delta_points: -data.points,
        reason: "redemption",
        source: "pos",
        source_ref: sourceRef,
        amount_basis: dollarsOff,
      });
      await recordIdempotency(
        client,
        data.idempotency_key,
        "/api/v1/redeem",
        requestHash,
        200,
        {
          ledger_id: led.id,
          points_redeemed: data.points,
          dollars_off: dollarsOff,
          new_balance: led.new_balance,
        },
        led.id,
      );
      return led;
    });
    return NextResponse.json({
      ledger_id: result.id,
      points_redeemed: data.points,
      dollars_off: dollarsOff,
      new_balance: result.new_balance,
    });
  } catch (err) {
    console.error("[/api/v1/redeem]", err);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't record the redemption." },
      { status: 500 },
    );
  }
}
