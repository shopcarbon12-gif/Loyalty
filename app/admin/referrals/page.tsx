import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPool } from "@/lib/db";
import { getSettings, clearSettingsCache } from "@/lib/settings";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

type RecentReferral = {
  id: string;
  referrer_first: string | null;
  referrer_last: string | null;
  referee_first: string | null;
  referee_last: string | null;
  redeemed_at: string;
  qualifying_amount: string | null;
  shopify_order_gid: string | null;
};

/**
 * Admin → Referrals — single live program with referrer/referee earn
 * amounts and a minimum-purchase floor. Matches Kangaroo's
 * REFERRAL_RULES_PURCHASE rule type by default (both sides earn 100 pts
 * on the referee's first purchase ≥ $50). The form persists the new
 * fields added in migration 002.
 */
export default async function ReferralsPage() {
  const pool = getPool();
  const settings = await getSettings();

  // Recent conversions, joined to both customer rows for display.
  const recent = await pool.query<RecentReferral>(
    `SELECT lrr.id::text,
            rer.first_name AS referrer_first, rer.last_name AS referrer_last,
            ree.first_name AS referee_first,  ree.last_name AS referee_last,
            lrr.redeemed_at,
            lrr.qualifying_amount::text,
            lrr.shopify_order_gid
       FROM loyalty_referral_redemptions lrr
       JOIN loyalty_referrals lr ON lr.id = lrr.referral_id
       LEFT JOIN pos_customers rer ON rer.id = lr.referrer_customer_id
       LEFT JOIN pos_customers ree ON ree.id = lrr.referee_customer_id
      ORDER BY lrr.redeemed_at DESC
      LIMIT 25`,
  );

  // Pending referrals (codes minted, no redemption yet)
  const pending = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM loyalty_referrals lr
      WHERE NOT EXISTS (SELECT 1 FROM loyalty_referral_redemptions lrr WHERE lrr.referral_id = lr.id)`,
  );

  async function save(formData: FormData) {
    "use server";
    const num = (k: string) => Number(formData.get(k) ?? 0);
    const pool = getPool();
    await pool.query(
      `UPDATE loyalty_settings
          SET referral_reward_points  = $1,
              referee_earns_points    = $2,
              referral_min_purchase   = $3
        WHERE id = 1`,
      [
        Math.max(0, Math.floor(num("referral_reward_points"))),
        Math.max(0, Math.floor(num("referee_earns_points"))),
        Math.max(0, num("referral_min_purchase")),
      ],
    );
    clearSettingsCache();
    revalidatePath("/admin/referrals");
    redirect("/admin/referrals");
  }

  const converted = recent.rows.length;
  const pendingN = Number(pending.rows[0]?.n ?? 0);

  return (
    <AdminShell active="referrals">
      <section className="p-8 max-w-5xl">
        <p className="text-sm text-[var(--carbon-muted)] mb-6">
          One referral program at a time (matches Kangaroo&rsquo;s constraint).
          Both sides earn when the referee makes their first qualifying purchase.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <Stat label="Converted (recent)" value={converted.toLocaleString()} />
          <Stat label="Pending links" value={pendingN.toLocaleString()} />
          <Stat
            label="Per-conversion payout"
            value={`+${settings.referral_reward_points + settings.referee_earns_points} pts`}
            sub="split across both sides"
          />
        </div>

        <div className="carbon-card p-5 mb-6">
          <h2 className="text-base font-bold mb-4">Rules</h2>
          <form action={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="Referrer earns (pts)"
              name="referral_reward_points"
              defaultValue={settings.referral_reward_points}
              hint="Credited to the customer who shared the link."
            />
            <Field
              label="Referee earns (pts)"
              name="referee_earns_points"
              defaultValue={settings.referee_earns_points}
              hint="Credited to the new customer on their first qualifying order."
            />
            <Field
              label="Minimum qualifying purchase ($)"
              name="referral_min_purchase"
              step="0.01"
              defaultValue={settings.referral_min_purchase}
              hint="Eligible amount on the referee's first order must reach this."
            />
            <div className="flex items-end">
              <button type="submit" className="carbon-btn-primary w-full">Save referral rules</button>
            </div>
          </form>
        </div>

        <div className="carbon-card overflow-hidden">
          <h2 className="text-base font-bold p-4 border-b border-[var(--carbon-border-soft)]">
            Recent conversions
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--carbon-surface-soft)] text-xs uppercase tracking-wider font-bold">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Referrer</th>
                  <th className="text-left px-3 py-2">Referee</th>
                  <th className="text-right px-3 py-2">First order</th>
                  <th className="text-left px-3 py-2">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--carbon-border-soft)]">
                {recent.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-[var(--carbon-muted)]">
                      No conversions yet — the program activates the moment the
                      first referee places a qualifying order.
                    </td>
                  </tr>
                ) : (
                  recent.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(r.redeemed_at).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        {[r.referrer_first, r.referrer_last].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {[r.referee_first, r.referee_last].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.qualifying_amount ? `$${Number(r.qualifying_amount).toFixed(2)}` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.shopify_order_gid ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="carbon-card p-4">
      <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub ? <p className="text-[11px] text-[var(--carbon-muted)] mt-1">{sub}</p> : null}
    </div>
  );
}

function Field({
  label,
  name,
  step,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  step?: string;
  defaultValue: number;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
        {label}
      </span>
      <input
        type="number"
        name={name}
        step={step ?? "1"}
        defaultValue={defaultValue}
        className="carbon-input"
      />
      {hint ? <span className="text-[11px] text-[var(--carbon-muted)]">{hint}</span> : null}
    </label>
  );
}
