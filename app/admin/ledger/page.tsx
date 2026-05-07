import { getPool } from "@/lib/db";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Admin → Ledger — recent activity browser. Filterable by reason; paged.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const reason = sp.reason ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const pool = getPool();
  const args: unknown[] = [];
  let where = "";
  if (reason) {
    args.push(reason);
    where = `WHERE reason = $1`;
  }
  args.push(PAGE_SIZE, offset);
  const limitIdx = args.length - 1;
  const offsetIdx = args.length;

  const r = await pool.query(
    `SELECT l.id::text,
            l.delta_points,
            l.reason,
            l.source,
            l.source_ref,
            l.amount_basis::text,
            l.created_at,
            COALESCE(NULLIF(TRIM(CONCAT(c.first_name, ' ', c.last_name)), ''), '(no customer)') AS customer_name,
            l.customer_id
       FROM loyalty_ledger l
       LEFT JOIN pos_customers c ON c.id = l.customer_id
       ${where}
      ORDER BY l.created_at DESC
      LIMIT $${limitIdx}::int OFFSET $${offsetIdx}::int`,
    args,
  );

  return (
    <AdminShell active="ledger">
      <section className="p-8 max-w-6xl">
        <form className="flex gap-2 items-end mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
              Filter by reason
            </span>
            <select name="reason" defaultValue={reason} className="carbon-input">
              <option value="">All</option>
              <option value="sale">sale</option>
              <option value="redemption">redemption</option>
              <option value="refund">refund</option>
              <option value="signup_bonus">signup_bonus</option>
              <option value="birthday_bonus">birthday_bonus</option>
              <option value="referral_bonus">referral_bonus</option>
              <option value="manual">manual</option>
              <option value="adjustment">adjustment</option>
              <option value="migration">migration</option>
            </select>
          </label>
          <button type="submit" className="carbon-btn-secondary">Apply</button>
        </form>
        <div className="carbon-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--carbon-surface-soft)] text-xs uppercase tracking-wider font-bold">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-right px-3 py-2">Δ Points</th>
                <th className="text-left px-3 py-2">Reason</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Ref</th>
                <th className="text-right px-3 py-2">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--carbon-border-soft)]">
              {r.rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--carbon-muted)]">No ledger rows match.</td></tr>
              ) : (
                r.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{row.customer_name}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-bold ${
                        row.delta_points > 0
                          ? "text-[var(--carbon-success)]"
                          : "text-[var(--carbon-danger)]"
                      }`}
                    >
                      {row.delta_points > 0 ? "+" : ""}{row.delta_points}
                    </td>
                    <td className="px-3 py-2">{row.reason}</td>
                    <td className="px-3 py-2">{row.source}</td>
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
        <div className="mt-3 flex items-center gap-2 text-sm">
          <a
            className="carbon-btn-secondary"
            href={`?reason=${reason}&page=${Math.max(1, page - 1)}`}
          >Prev</a>
          <span className="text-[var(--carbon-muted)]">Page {page}</span>
          <a
            className="carbon-btn-secondary"
            href={`?reason=${reason}&page=${page + 1}`}
          >Next</a>
        </div>
      </section>
    </AdminShell>
  );
}
