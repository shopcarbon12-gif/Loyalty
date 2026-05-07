import { getPool } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { AdminShell } from "@/components/AdminShell";

/**
 * Admin dashboard — top-level numbers Kangaroo's portal also surfaces:
 *   total members · points outstanding · points redeemed · top reward.
 * Plus the LOYALTY_LIVE switch state so we never forget whether we're
 * actually firing.
 */
export default async function AdminHome() {
  const pool = getPool();
  const settings = await getSettings();
  const [members, summary] = await Promise.all([
    pool.query<{ n: string }>(
      `SELECT COUNT(DISTINCT customer_id)::text AS n FROM loyalty_ledger
        WHERE customer_id IS NOT NULL`,
    ),
    pool.query<{ awarded: string; redeemed: string; refunded: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN delta_points > 0 AND reason IN ('sale','signup_bonus','birthday_bonus','referral_bonus','manual')
                            THEN delta_points ELSE 0 END), 0)::text AS awarded,
         COALESCE(SUM(CASE WHEN reason = 'redemption' THEN -delta_points ELSE 0 END), 0)::text AS redeemed,
         COALESCE(SUM(CASE WHEN reason = 'refund' THEN delta_points ELSE 0 END), 0)::text AS refunded
       FROM loyalty_ledger`,
    ),
  ]);
  const m = Number(members.rows[0]?.n ?? 0);
  const awarded = Number(summary.rows[0]?.awarded ?? 0);
  const redeemed = Number(summary.rows[0]?.redeemed ?? 0);
  return (
    <AdminShell active="dashboard">
      <section className="p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl">
          <Stat label="Members" value={m.toLocaleString()} />
          <Stat label="Points awarded" value={awarded.toLocaleString()} />
          <Stat label="Points redeemed" value={redeemed.toLocaleString()} />
          <Stat
            label="Live switch"
            value={settings.live ? "ON" : "OFF"}
            tone={settings.live ? "good" : "muted"}
          />
        </div>
        <div className="mt-8 carbon-card p-6 max-w-3xl">
          <h2 className="text-lg font-bold mb-2">Current rules</h2>
          <ul className="text-sm space-y-1 text-[var(--carbon-text)]">
            <li>Earn: <b>{settings.earn_rate_per_dollar} pt per $1</b> (tax {settings.exclude_tax ? "EXCLUDED" : "INCLUDED"})</li>
            <li>Redeem: <b>{settings.redeem_increment_points} pts → ${(settings.redeem_increment_points / settings.redeem_points_per_dollar).toFixed(2)} off</b>, in {settings.redeem_increment_points}-pt steps, max {settings.max_redeem_pct_of_order}% of subtotal</li>
            <li>Welcome bonus: <b>{settings.signup_bonus_points} pts</b></li>
            <li>Birthday bonus: <b>{settings.birthday_bonus_points} pts</b></li>
            <li>Referral reward: <b>{settings.referral_reward_points} pts</b></li>
            <li>Coupon expiry: <b>{settings.coupon_ttl_hours} h</b> · stacking with codes: <b>{settings.allow_stacking_with_codes ? "ON" : "OFF"}</b></li>
            <li>Points expire: <b>{settings.points_never_expire ? "Never" : "(time-bound)"}</b></li>
          </ul>
        </div>
      </section>
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "muted";
}) {
  const cls =
    tone === "good"
      ? "text-[var(--carbon-success)]"
      : tone === "muted"
        ? "text-[var(--carbon-muted)]"
        : "text-[var(--carbon-text)]";
  return (
    <div className="carbon-card p-5">
      <p className="text-[11px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
        {label}
      </p>
      <p className={`text-3xl font-bold mt-2 ${cls}`}>{value}</p>
    </div>
  );
}
