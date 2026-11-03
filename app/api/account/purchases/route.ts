import { getPool } from "@/lib/db";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";

/**
 * GET /api/account/purchases
 *
 * In-store (Carbon POS) purchases for the signed-in customer, shown on the
 * "In-store purchases" page in customer accounts. Online orders already
 * live in Shopify's own Orders page.
 */
export async function GET(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);
  const pool = getPool();
  const c = await pool.query<{ id: number }>(
    `SELECT id FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  if (!c.rows[0]) return corsJson({ purchases: [] });

  const sales = await pool.query<{
    ref: string; number: string; placed_at: string; total: string; status: string; location_name: string | null;
  }>(
    `SELECT ref, number, placed_at, total::text, status, location_name
       FROM customer_purchases
      WHERE customer_id = $1 AND channel = 'store'
      ORDER BY placed_at DESC
      LIMIT 50`,
    [c.rows[0].id],
  );
  const ids = sales.rows.map((s) => Number(s.ref));
  const lines = ids.length
    ? await pool.query<{ sale_id: number; description: string; quantity: number; line_total: string; line_type: string }>(
        `SELECT sale_id, description, quantity, line_total::text, line_type
           FROM pos_sale_lines WHERE sale_id = ANY($1::int[]) ORDER BY id`,
        [ids],
      )
    : { rows: [] };
  // Points each sale earned (POS earn rows are keyed source_ref = 'pos:sale:<id>').
  const earned = ids.length
    ? await pool.query<{ source_ref: string; points: string }>(
        `SELECT source_ref, sum(delta_points)::text AS points
           FROM loyalty_ledger
          WHERE customer_id = $1 AND source = 'pos' AND reason = 'sale' AND source_ref = ANY($2::text[])
          GROUP BY source_ref`,
        [c.rows[0].id, ids.map((id) => `pos:sale:${id}`)],
      )
    : { rows: [] };
  const pointsBySale = new Map(earned.rows.map((r) => [r.source_ref, Number(r.points)]));
  return corsJson({
    purchases: sales.rows.map((s) => ({
      number: s.number,
      points: pointsBySale.get(`pos:sale:${s.ref}`) ?? null,
      placed_at: s.placed_at,
      total: Number(s.total),
      status: s.status,
      store: s.location_name,
      lines: lines.rows
        .filter((l) => l.sale_id === Number(s.ref))
        .map((l) => ({
          description: l.description,
          quantity: l.quantity,
          total: Number(l.line_total),
          type: l.line_type,
        })),
    })),
  });
}

export function OPTIONS() {
  return corsPreflight();
}
