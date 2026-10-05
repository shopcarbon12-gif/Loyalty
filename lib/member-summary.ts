import { getPool } from "./db";
import { dollarsForPoints, getBalance } from "./loyalty";
import { getSettings } from "./settings";

/**
 * What a member sees about their rewards — shared by the customer-account
 * extension (/api/account/summary) and the cart box (/apps/loyalty/balance)
 * so both show identical numbers.
 */
export async function memberSummary(member: { id: number; first_name: string | null } | null) {
  const s = await getSettings();
  const rules = {
    live: s.live,
    min_redeem_points: s.min_redeem_points,
    redeem_increment_points: s.redeem_increment_points,
    redeem_points_per_dollar: s.redeem_points_per_dollar,
    earn_rate_per_dollar: s.earn_rate_per_dollar,
    max_redeem_pct_of_order: s.max_redeem_pct_of_order,
    max_redeem_dollars_per_order: s.max_redeem_dollars_per_order,
  };
  // Not linked yet — first online order or account update links them.
  if (!member) return { linked: false, balance: 0, dollars_value: 0, activity: [], codes: [], rules };

  const pool = getPool();
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
  return {
    linked: true,
    first_name: member.first_name,
    balance,
    dollars_value: await dollarsForPoints(Math.max(0, balance)),
    activity: activity.rows,
    codes: codes.rows,
    rules,
  };
}
