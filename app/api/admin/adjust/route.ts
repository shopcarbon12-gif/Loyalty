import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedServerCall } from "@/lib/auth";
import { insertLedger, withTransaction } from "@/lib/loyalty";

const schema = z.object({
  customer_id: z.number().int().positive(),
  delta_points: z.number().int(),
  reason_text: z.string().min(1).max(500),
  acted_by_user_id: z.string().uuid(),
});

/**
 * POST /api/admin/adjust
 *
 * Manager / admin-only manual ledger adjustment. Used from the WMS
 * customer detail page and from this service's own /admin/customers/:id
 * page. Bears server-to-server auth (LOYALTY_API_KEY) — gating to manager+
 * is the caller's job.
 *
 * The reason_text is stamped as the only piece of free-form context on
 * the ledger row. We use the generic `manual` reason so reports can
 * filter manual entries from organic activity.
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
  if (data.delta_points === 0) {
    return NextResponse.json(
      { error: "zero_delta", message: "Adjustment must be non-zero." },
      { status: 422 },
    );
  }
  try {
    const result = await withTransaction((client) =>
      insertLedger(client, {
        customer_id: data.customer_id,
        shopify_gid: null,
        delta_points: data.delta_points,
        reason: "manual",
        source: "admin",
        // Free-form reason embedded into source_ref so it appears on the
        // ledger view without a separate column. Time-stamped to keep
        // the unique index happy across multiple adjustments.
        source_ref: `admin:${Date.now()}:${data.reason_text.slice(0, 60)}`,
        amount_basis: null,
        created_by: data.acted_by_user_id,
      }),
    );
    return NextResponse.json({
      ledger_id: result.id,
      new_balance: result.new_balance,
    });
  } catch (err) {
    console.error("[/api/admin/adjust]", err);
    return NextResponse.json(
      { error: "server_error", message: "Couldn't adjust." },
      { status: 500 },
    );
  }
}
