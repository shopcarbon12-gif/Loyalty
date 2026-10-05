import { getPool } from "@/lib/db";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";
import { memberSummary } from "@/lib/member-summary";

/**
 * GET /api/account/summary
 *
 * Powers the Rewards page in Shopify customer accounts
 * (shopify-app/extensions/rewards-account). See lib/member-summary.ts.
 *
 * `thank_you_codes`: 15%-off-next-order codes the WMS created when it printed
 * one of this customer's packing slips (table order_thank_you_codes, owned by
 * the WMS). Keyed on the Shopify customer, so they show whether or not the
 * customer is a points member yet. Unused and unexpired only.
 */
export async function GET(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);
  const c = await getPool().query<{ id: number; first_name: string | null }>(
    `SELECT id, first_name FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  const [summary, thankYou] = await Promise.all([
    memberSummary(c.rows[0] ?? null),
    getPool()
      .query<{ code: string; percent_off: number; ends_at: Date; order_name: string }>(
        `SELECT code, percent_off, ends_at, order_name
           FROM order_thank_you_codes
          WHERE shopify_customer_gid = $1 AND used_at IS NULL AND ends_at > now()
          ORDER BY ends_at ASC`,
        [session.customerGid],
      )
      .then((r) => r.rows)
      .catch((e) => {
        console.error("[account/summary] thank-you codes", e);
        return [];
      }),
  ]);
  return corsJson({ ...summary, thank_you_codes: thankYou });
}

export function OPTIONS() {
  return corsPreflight();
}
