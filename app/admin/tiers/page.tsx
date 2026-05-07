import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSettings, clearSettingsCache } from "@/lib/settings";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

type TierRow = {
  code: string;
  name: string;
  qualifying_points: number;
  earn_multiplier: string;
  perks: unknown;
  sort_order: number;
};

/**
 * Admin → Tiers — ladder editor for the four-tier program (Bronze /
 * Silver / Gold / VIP). Saves all rows in a single round-trip.
 */
export default async function TiersPage() {
  const pool = getPool();
  const settings = await getSettings();
  const r = await pool.query<TierRow>(
    `SELECT code, name, qualifying_points, earn_multiplier::text, perks, sort_order
       FROM loyalty_tiers ORDER BY sort_order ASC`,
  );
  const tiers = r.rows;

  // Distribution metrics for the dashboard tiles
  const dist = await pool.query<{ tier: string; n: string }>(
    `WITH lifetime AS (
       SELECT customer_id,
              SUM(CASE WHEN delta_points > 0 THEN delta_points ELSE 0 END) AS pts
         FROM loyalty_ledger WHERE customer_id IS NOT NULL
         GROUP BY customer_id
     )
     SELECT
       (SELECT t.code FROM loyalty_tiers t
         WHERE t.qualifying_points <= COALESCE(lifetime.pts, 0)
         ORDER BY t.qualifying_points DESC LIMIT 1) AS tier,
       COUNT(*)::text AS n
       FROM lifetime
       GROUP BY tier`,
  );
  const distMap = new Map(dist.rows.map((d) => [d.tier, Number(d.n)]));
  const totalCustomers = [...distMap.values()].reduce((a, b) => a + b, 0);

  async function save(formData: FormData) {
    "use server";
    const pool = getPool();
    for (const t of tiers) {
      const points = Number(formData.get(`points_${t.code}`) ?? t.qualifying_points);
      const mult = Number(formData.get(`mult_${t.code}`) ?? t.earn_multiplier);
      if (!Number.isFinite(points) || !Number.isFinite(mult)) continue;
      await pool.query(
        `UPDATE loyalty_tiers
            SET qualifying_points = $1,
                earn_multiplier = $2
          WHERE code = $3`,
        [Math.max(0, Math.floor(points)), Math.max(0, mult), t.code],
      );
    }
    const tierBatchHour = Number(formData.get("tier_batch_hour_est") ?? 10);
    const metric = String(formData.get("tier_qualifying_metric") ?? "amount");
    await pool.query(
      `UPDATE loyalty_settings
          SET tier_batch_hour_est = $1,
              tier_qualifying_metric = $2
        WHERE id = 1`,
      [Math.max(0, Math.min(23, Math.floor(tierBatchHour))), metric],
    );
    clearSettingsCache();
    revalidatePath("/admin/tiers");
    redirect("/admin/tiers");
  }

  const TIER_BORDER: Record<string, string> = {
    bronze: "#b48a40",
    silver: "#8a8a8a",
    gold: "#d4af37",
    vip: "#6d28d9",
  };

  return (
    <AdminShell active="tiers">
      <section className="p-8 max-w-6xl">
        <p className="text-sm text-[var(--carbon-muted)] mb-4">
          Customers move up the ladder as their lifetime point total crosses each
          threshold. Multipliers apply at earn-time (Silver gets 25% more pts
          than Bronze on every sale).
        </p>

        <form action={save} className="space-y-6">
          <div className="carbon-card p-5">
            <h2 className="text-base font-bold mb-3">Program-level</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Qualifying metric</span>
                <select name="tier_qualifying_metric" defaultValue={settings.tier_qualifying_metric} className="carbon-input">
                  <option value="amount">Lifetime amount spent</option>
                  <option value="points">Lifetime points earned</option>
                  <option value="visits">Lifetime visits</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Batch run hour (EST)</span>
                <input
                  type="number"
                  name="tier_batch_hour_est"
                  min={0}
                  max={23}
                  defaultValue={settings.tier_batch_hour_est}
                  className="carbon-input"
                />
              </label>
            </div>
            <p className="text-xs text-[var(--carbon-muted)] mt-2">
              Tier promotions/demotions run as a daily batch at the chosen hour.
              Defaults to 10 EST to match Kangaroo&rsquo;s timing so customers
              don&rsquo;t notice a different cadence at cutover.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {tiers.map((t) => {
              const n = distMap.get(t.code) ?? 0;
              const pct = totalCustomers > 0 ? Math.round((n / totalCustomers) * 1000) / 10 : 0;
              return (
                <div
                  key={t.code}
                  className="carbon-card p-4 border-t-4"
                  style={{ borderTopColor: TIER_BORDER[t.code] ?? "#999" }}
                >
                  <h3 className="text-lg font-bold">{t.name}</h3>
                  <p className="text-[11px] uppercase tracking-wider font-bold text-[var(--carbon-muted)] mt-1">
                    Threshold (lifetime)
                  </p>
                  <input
                    type="number"
                    name={`points_${t.code}`}
                    defaultValue={t.qualifying_points}
                    className="carbon-input mt-1"
                  />
                  <p className="text-[11px] uppercase tracking-wider font-bold text-[var(--carbon-muted)] mt-3">
                    Earn multiplier
                  </p>
                  <input
                    type="number"
                    step="0.01"
                    name={`mult_${t.code}`}
                    defaultValue={t.earn_multiplier}
                    className="carbon-input mt-1"
                  />
                  <p className="text-xs text-[var(--carbon-muted)] mt-3">
                    {n.toLocaleString()} customers · {pct}%
                  </p>
                  {Array.isArray(t.perks) ? (
                    <ul className="text-xs mt-2 list-disc list-inside text-[var(--carbon-muted)]">
                      {(t.perks as string[]).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button type="submit" className="carbon-btn-primary">Save tier program</button>
          </div>
        </form>
      </section>
    </AdminShell>
  );
}
