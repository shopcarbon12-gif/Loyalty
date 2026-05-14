import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPool, withTransaction } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { insertLedger } from "@/lib/loyalty";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

type Customer = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  phone: string | null;
  birthday: string | null;
  shopify_customer_gid: string | null;
  shopify_linked_at: string | null;
  created_at: string;
};

type LedgerRow = {
  id: string;
  delta_points: number;
  reason: string;
  source: string;
  source_ref: string | null;
  amount_basis: string | null;
  created_at: string;
  pos_location_name: string | null;
  pos_location_code: string | null;
};

/**
 * Admin → Customer detail. Mirrors the Kangaroo merchant-portal customer
 * page: profile + balance + tier progress + transactions + manager-only
 * actions to reward or adjust points. Both write reason='manual' so they
 * stay out of the organic earn/redeem KPIs. All writes go through
 * `insertLedger` so the unique (source, source_ref) index keeps
 * double-clicks idempotent.
 */
export default async function CustomerDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customerId = Number(id);
  if (!Number.isFinite(customerId)) notFound();

  const pool = getPool();
  const settings = await getSettings();

  const [c, balance, lifetime, ledger, tierRow] = await Promise.all([
    pool.query<Customer>(
      `SELECT id, first_name, last_name, email, mobile_phone, phone,
              birthday::text, shopify_customer_gid, shopify_linked_at::text, created_at::text
         FROM pos_customers WHERE id = $1`,
      [customerId],
    ),
    pool.query<{ b: string }>(
      `SELECT COALESCE(SUM(delta_points), 0)::text AS b
         FROM loyalty_ledger WHERE customer_id = $1`,
      [customerId],
    ),
    pool.query<{ life: string; visits: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN delta_points > 0 THEN delta_points ELSE 0 END), 0)::text AS life,
         COUNT(DISTINCT source_ref) FILTER (WHERE reason = 'sale')::text AS visits
       FROM loyalty_ledger WHERE customer_id = $1`,
      [customerId],
    ),
    pool.query<LedgerRow>(
      // For source='pos', the source_ref encodes the pos_sales.id. Resolve
      // the originating location via pos_sales → pos_locations → WMS
      // locations so the UI can show "<code> · <name>" instead of "pos".
      `SELECT ll.id::text, ll.delta_points, ll.reason, ll.source, ll.source_ref,
              ll.amount_basis::text, ll.created_at,
              l.name AS pos_location_name,
              l.code AS pos_location_code
         FROM loyalty_ledger ll
         LEFT JOIN pos_sales     ps
           ON ll.source = 'pos'
          AND ll.source_ref IN ('pos:sale:' || ps.id::text,
                                'pos:redeem:' || ps.id::text)
         LEFT JOIN pos_locations pl ON pl.id = ps.pos_location_id
         LEFT JOIN locations     l  ON l.id  = pl.wms_location_id
        WHERE ll.customer_id = $1
        ORDER BY ll.created_at DESC
        LIMIT 100`,
      [customerId],
    ),
    pool.query<{
      code: string;
      name: string;
      qualifying_points: number;
      earn_multiplier: string;
    }>(
      `SELECT code, name, qualifying_points, earn_multiplier::text
         FROM loyalty_tiers
        ORDER BY sort_order ASC`,
    ),
  ]);

  if (c.rowCount === 0) notFound();
  const customer = c.rows[0];
  const bal = Number(balance.rows[0]?.b ?? 0);
  const life = Number(lifetime.rows[0]?.life ?? 0);
  const visits = Number(lifetime.rows[0]?.visits ?? 0);
  const tiers = tierRow.rows;
  const currentTier = tiers
    .filter((t) => life >= t.qualifying_points)
    .sort((a, b) => b.qualifying_points - a.qualifying_points)[0];
  const nextTier = tiers.find((t) => t.qualifying_points > life);

  // Server actions for manual overrides ------------------------------------
  // Both actions stamp reason='manual' so they're excluded from the
  // organic earn/redeem KPIs on the dashboard. They are manager-only
  // adjustments, not customer activity.
  async function rewardAction(formData: FormData) {
    "use server";
    const pts = Number(formData.get("points") ?? 0);
    const note = String(formData.get("note") ?? "").trim().slice(0, 60);
    if (!Number.isFinite(pts) || pts <= 0) return;
    await withTransaction((client) =>
      insertLedger(client, {
        customer_id: customerId,
        shopify_gid: null,
        delta_points: Math.floor(pts),
        reason: "manual",
        source: "admin",
        source_ref: `admin:reward:${Date.now()}:${note || "manual"}`,
        amount_basis: null,
      }),
    );
    revalidatePath(`/admin/customers/${customerId}`);
    redirect(`/admin/customers/${customerId}`);
  }

  async function adjustAction(formData: FormData) {
    "use server";
    // Signed integer: positive adds, negative deducts. Manager override —
    // not subject to redeem min/increment rules.
    const delta = Number(formData.get("points") ?? 0);
    const note = String(formData.get("note") ?? "").trim().slice(0, 60);
    if (!Number.isFinite(delta) || delta === 0) return;
    await withTransaction((client) =>
      insertLedger(client, {
        customer_id: customerId,
        shopify_gid: null,
        delta_points: Math.trunc(delta),
        reason: "manual",
        source: "admin",
        source_ref: `admin:adjust:${Date.now()}:${note || "manual"}`,
        amount_basis: null,
      }),
    );
    revalidatePath(`/admin/customers/${customerId}`);
    redirect(`/admin/customers/${customerId}`);
  }

  const fullName =
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "(no name)";
  const initials =
    ((customer.first_name?.[0] ?? "") + (customer.last_name?.[0] ?? "")).toUpperCase() || "?";

  return (
    <AdminShell active="customers">
      <section className="p-8 max-w-7xl">
        <Link href="/admin/customers" className="text-sm text-[var(--carbon-muted)] hover:underline">
          ‹ Back to customers
        </Link>

        <header className="mt-3 mb-6 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center text-xl font-bold">
            {initials}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{fullName}</h1>
            <p className="text-sm text-[var(--carbon-muted)] mt-1">
              {customer.email ?? ""}
              {customer.mobile_phone || customer.phone ? ` · ${customer.mobile_phone ?? customer.phone}` : ""}
              {customer.birthday ? ` · 🎂 ${customer.birthday}` : ""}
            </p>
            <p className="text-xs text-[var(--carbon-muted)] mt-1">
              Member since {new Date(customer.created_at).toLocaleDateString()}
              {customer.shopify_customer_gid ? " · Shopify-linked" : ""}
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Balance" value={bal.toLocaleString()} sub={`≈ $${(bal / settings.redeem_points_per_dollar).toFixed(2)} redeemable`} />
          <Stat
            label="Tier"
            value={currentTier?.name ?? "Member"}
            sub={
              nextTier
                ? `${(nextTier.qualifying_points - life).toLocaleString()} pts to ${nextTier.name}`
                : "Top tier reached"
            }
            tone={currentTier?.code === "vip" ? "good" : undefined}
          />
          <Stat label="Lifetime points" value={life.toLocaleString()} sub="all-time" />
          <Stat label="Visits" value={visits.toLocaleString()} sub="distinct sales" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
          <div className="carbon-card overflow-hidden">
            <h2 className="text-base font-bold p-4 border-b border-[var(--carbon-border-soft)]">
              Transactions · last 100
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--carbon-surface-soft)] text-xs uppercase tracking-wider font-bold">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-right px-3 py-2">Δ Pts</th>
                    <th className="text-left px-3 py-2">Reason</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-left px-3 py-2">Ref</th>
                    <th className="text-right px-3 py-2">Basis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--carbon-border-soft)]">
                  {ledger.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-12 text-center text-[var(--carbon-muted)]">
                        No activity yet.
                      </td>
                    </tr>
                  ) : (
                    ledger.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-bold ${
                            row.delta_points > 0
                              ? "text-[var(--carbon-success)]"
                              : "text-[var(--carbon-danger)]"
                          }`}
                        >
                          {row.delta_points > 0 ? "+" : ""}
                          {row.delta_points}
                        </td>
                        <td className="px-3 py-2">{row.reason}</td>
                        <td className="px-3 py-2">
                          {row.source === "pos" && row.pos_location_code
                            ? `${row.pos_location_code} · ${row.pos_location_name ?? ""}`
                            : row.source}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{row.source_ref ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.amount_basis ? `$${Number(row.amount_basis).toFixed(2)}` : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="carbon-card p-5">
              <h2 className="text-base font-bold mb-3">＋ Reward points</h2>
              <p className="text-xs text-[var(--carbon-muted)] mb-3">
                Manager override · adds points directly to this customer.
              </p>
              <form action={rewardAction} className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Points</span>
                  <input type="number" step="1" min="1" name="points" required className="carbon-input" placeholder="100" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Note (optional)</span>
                  <input type="text" name="note" maxLength={60} className="carbon-input" placeholder="Reason / reference" />
                </label>
                <button type="submit" className="carbon-btn-primary w-full">Reward points</button>
              </form>
            </div>

            <div className="carbon-card p-5">
              <h2 className="text-base font-bold mb-3">⇄ Adjust points</h2>
              <p className="text-xs text-[var(--carbon-muted)] mb-3">
                Manager override · positive adds, negative deducts. Bypasses
                redemption rules.
              </p>
              <form action={adjustAction} className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Points (±)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="-?[0-9]+"
                    name="points"
                    required
                    className="carbon-input"
                    placeholder="-100"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Note (optional)</span>
                  <input type="text" name="note" maxLength={60} className="carbon-input" placeholder="Reason / reference" />
                </label>
                <button type="submit" className="carbon-btn-secondary w-full">Apply adjustment</button>
              </form>
            </div>

            <div className="carbon-card p-5">
              <h2 className="text-base font-bold mb-2">Quick links</h2>
              <ul className="text-sm space-y-1">
                <li>
                  <Link className="underline" href={`/admin/ledger?customer_id=${customerId}`}>
                    Filter ledger to this customer →
                  </Link>
                </li>
                {customer.shopify_customer_gid ? (
                  <li>
                    <a
                      className="underline"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://admin.shopify.com/store/30e7d3/customers/${customer.shopify_customer_gid.split("/").pop()}`}
                    >
                      Shopify customer ↗
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good";
}) {
  return (
    <div className="carbon-card p-4">
      <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === "good" ? "text-[var(--carbon-success)]" : ""}`}>{value}</p>
      {sub ? <p className="text-[11px] text-[var(--carbon-muted)] mt-1">{sub}</p> : null}
    </div>
  );
}
