import { getPool } from "@/lib/db";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";
import { dollarsForPoints, getBalance } from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";

/**
 * GET /api/account/summary
 *
 * Powers the Rewards page in Shopify customer accounts
 * (shopify-app/extensions/rewards-account). Balance, recent activity,
 * open codes, and the redemption rules the UI needs to build its options.
 */
export async function GET(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);

  const pool = getPool();
  const c = await pool.query<{ id: number; first_name: string | null }>(
    `SELECT id, first_name FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  const s = await getSettings();
  const rules = {
    live: s.live,
    min_redeem_points: s.min_redeem_points,
    redeem_increment_points: s.redeem_increment_points,
    redeem_points_per_dollar: s.redeem_points_per_dollar,
    earn_rate_per_dollar: s.earn_rate_per_dollar,
    max_redeem_pct_of_order: s.max_redeem_pct_of_order,
  };
  const member = c.rows[0];
  // Not linked yet — first online order or account update links them.
  if (!member) return corsJson({ linked: false, balance: 0, dollars_value: 0, activity: [], codes: [], rules });

  const [balance, activity, codes] = await Promise.all([
    getBalance(member.id),
    pool.query(
      `SELECT delta_points, reason, source, created_at
         FROM loyalty_ledger WHERE customer_id = $1
        ORDER BY created_at DESC, id DESC LIMIT 10`,
      [member.id],
    ),
    pool.query(
      `SELECT code, points, dollars::float8 AS dollars, min_subtotal::float8 AS min_subtotal, expires_at
         FROM loyalty_coupons
        WHERE customer_id = $1 AND used_at IS NULL AND refunded_ledger_id IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [member.id],
    ),
  ]);
  return corsJson({
    linked: true,
    first_name: member.first_name,
    balance,
    dollars_value: await dollarsForPoints(Math.max(0, balance)),
    activity: activity.rows,
    codes: codes.rows,
    rules,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
