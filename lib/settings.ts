import { getPool } from "./db";

export type LoyaltySettings = {
  earn_rate_per_dollar: number;
  exclude_tax: boolean;
  exclude_gift_card_purchases: boolean;
  redeem_points_per_dollar: number;
  min_redeem_points: number;
  redeem_increment_points: number;
  max_redeem_pct_of_order: number;
  coupon_ttl_hours: number;
  allow_stacking_with_codes: boolean;
  signup_bonus_points: number;
  birthday_bonus_points: number;
  referral_reward_points: number;     // referrer's reward
  referee_earns_points: number;       // referee's reward — added in migration 002
  referral_min_purchase: number;      // qualifying-purchase floor
  tier_batch_hour_est: number;
  tier_qualifying_metric: "amount" | "points" | "visits";
  points_never_expire: boolean;
  metafield_namespace: string;
  metafield_key: string;
  live: boolean;
};

let _cache: { value: LoyaltySettings; expires: number } | null = null;
const TTL_MS = 30_000;

/**
 * Fetches the singleton loyalty_settings row. Cached 30s in-process.
 */
export async function getSettings(): Promise<LoyaltySettings> {
  if (_cache && _cache.expires > Date.now()) return _cache.value;
  const pool = getPool();
  const r = await pool.query<LoyaltySettings>(
    `SELECT earn_rate_per_dollar::float8       AS earn_rate_per_dollar,
            exclude_tax,
            exclude_gift_card_purchases,
            redeem_points_per_dollar,
            min_redeem_points,
            redeem_increment_points,
            max_redeem_pct_of_order,
            coupon_ttl_hours,
            allow_stacking_with_codes,
            signup_bonus_points,
            birthday_bonus_points,
            referral_reward_points,
            referee_earns_points,
            referral_min_purchase::float8      AS referral_min_purchase,
            tier_batch_hour_est,
            tier_qualifying_metric,
            points_never_expire,
            metafield_namespace,
            metafield_key,
            live
       FROM loyalty_settings WHERE id = 1`,
  );
  if (!r.rows[0]) throw new Error("loyalty_settings missing — run migrations");
  _cache = { value: r.rows[0], expires: Date.now() + TTL_MS };
  return r.rows[0];
}

export function clearSettingsCache() {
  _cache = null;
}
