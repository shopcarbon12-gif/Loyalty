import type { PoolClient } from "pg";
import { getPool } from "./db";
import { queueEmail } from "./email";
import { getSettings } from "./settings";

/**
 * Tiers (loyalty_tiers: Bronze / Silver / Gold / VIP). A member's tier is
 * the highest whose qualifying_points threshold their LIFETIME metric
 * reaches, where the metric is loyalty_settings.tier_qualifying_metric:
 *   amount — lifetime spend across in-store + online (customer_purchases)
 *   points — lifetime points earned (positive ledger rows)
 *   visits — number of purchases
 * Recomputed by the daily batch; the tier's earn_multiplier applies to
 * every earn (POS and online).
 */
export type Tier = { code: string; name: string; qualifying_points: number; earn_multiplier: number; perks: string[] };

export async function listTiers(): Promise<Tier[]> {
  const r = await getPool().query<Tier>(
    `SELECT code, name, qualifying_points, earn_multiplier::float8 AS earn_multiplier, perks
       FROM loyalty_tiers ORDER BY qualifying_points`,
  );
  return r.rows;
}

/** Current tier for a member (lowest tier when not yet assigned). */
export async function memberTier(customerId: number, db: PoolClient | ReturnType<typeof getPool> = getPool()) {
  const tiers = await listTiers();
  const r = await db.query<{ tier_code: string; metric_value: string }>(
    `SELECT tier_code, metric_value::text FROM loyalty_member_tiers WHERE customer_id = $1`,
    [customerId],
  );
  const tier = tiers.find((t) => t.code === r.rows[0]?.tier_code) ?? tiers[0] ?? null;
  const metric = Number(r.rows[0]?.metric_value ?? 0);
  const next = tier ? tiers.find((t) => t.qualifying_points > tier.qualifying_points) ?? null : null;
  return { tier, metric, next, toNext: next ? Math.max(0, next.qualifying_points - metric) : 0 };
}

export async function earnMultiplier(customerId: number | null, db?: PoolClient): Promise<number> {
  if (customerId == null) return 1;
  const { tier } = await memberTier(customerId, db);
  return tier && tier.earn_multiplier > 0 ? tier.earn_multiplier : 1;
}

/** Daily batch: recompute every member's tier; email promotions. */
export async function recomputeTiers(): Promise<{ members: number; changed: number; promoted: number }> {
  const s = await getSettings();
  const tiers = await listTiers();
  if (!tiers.length) return { members: 0, changed: 0, promoted: 0 };
  const metricSql = {
    amount: `SELECT customer_id, SUM(total) AS v FROM customer_purchases WHERE status <> 'cancelled' GROUP BY customer_id`,
    points: `SELECT customer_id, SUM(delta_points) AS v FROM loyalty_ledger
              WHERE delta_points > 0 AND reason IN ('sale','signup_bonus','birthday_bonus','referral_bonus','migration')
              GROUP BY customer_id`,
    visits: `SELECT customer_id, COUNT(*) AS v FROM customer_purchases WHERE status <> 'cancelled' GROUP BY customer_id`,
  }[s.tier_qualifying_metric] ?? "";
  const pool = getPool();
  const rows = await pool.query<{ customer_id: number; v: string; old_code: string | null }>(
    `SELECT m.customer_id, COALESCE(m.v, 0)::text AS v, t.tier_code AS old_code
       FROM (${metricSql}) m
       LEFT JOIN loyalty_member_tiers t ON t.customer_id = m.customer_id
      WHERE m.customer_id IS NOT NULL`,
  );
  const rank = new Map(tiers.map((t, i) => [t.code, i]));
  let changed = 0, promoted = 0;
  for (const r of rows.rows) {
    const v = Number(r.v);
    const tier = [...tiers].reverse().find((t) => v >= t.qualifying_points) ?? tiers[0];
    if (r.old_code === tier.code) {
      await pool.query(`UPDATE loyalty_member_tiers SET metric_value = $2, updated_at = now() WHERE customer_id = $1`, [r.customer_id, v]);
      continue;
    }
    await pool.query(
      `INSERT INTO loyalty_member_tiers (customer_id, tier_code, metric_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id) DO UPDATE SET tier_code = EXCLUDED.tier_code, metric_value = EXCLUDED.metric_value,
              assigned_at = now(), updated_at = now()`,
      [r.customer_id, tier.code, v],
    );
    changed++;
    // Email only real promotions above the entry tier (not first-time Bronze, not demotions).
    const was = r.old_code != null ? rank.get(r.old_code) ?? 0 : 0;
    if ((rank.get(tier.code) ?? 0) > was) {
      promoted++;
      await queueEmail(pool, {
        customerId: r.customer_id,
        template: "tier_upgrade",
        data: { tier_name: tier.name, multiplier: tier.earn_multiplier, perks: tier.perks },
        dedupeKey: `tier:${r.customer_id}:${tier.code}`,
      });
    }
  }
  return { members: rows.rows.length, changed, promoted };
}
