import Link from "next/link";
import { getPool } from "@/lib/db";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type Row = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile_phone: string | null;
  phone: string | null;
  balance: string;
  lifetime: string;
  last_event_at: string | null;
  shopify_customer_gid: string | null;
  created_via: string | null;
  created_at_geo: string | null;
  pos_location_name: string | null;
};

const SOURCE_LABELS: Record<string, { label: string; tone: string }> = {
  pos:        { label: "Store",        tone: "bg-blue-100 text-blue-800" },
  shopify:    { label: "Online",       tone: "bg-emerald-100 text-emerald-800" },
  wms_manual: { label: "WMS · Manual", tone: "bg-purple-100 text-purple-800" },
  wms_csv:    { label: "WMS · CSV",    tone: "bg-amber-100 text-amber-800" },
  admin:      { label: "Admin",        tone: "bg-slate-200 text-slate-800" },
  legacy:     { label: "Legacy",       tone: "bg-stone-200 text-stone-700" },
};

/**
 * Admin → Customers — searchable / filterable member list. Shape matches
 * the Kangaroo merchant portal customers table so the cutover doesn't feel
 * like a regression to the back office team.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const filter = sp.filter ?? "all";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const args: unknown[] = [];
  const where: string[] = [];
  if (q) {
    args.push(`%${q}%`);
    where.push(
      `(pc.first_name ILIKE $${args.length} OR pc.last_name ILIKE $${args.length} OR pc.email ILIKE $${args.length} OR pc.mobile_phone ILIKE $${args.length} OR pc.phone ILIKE $${args.length})`,
    );
  }
  if (filter === "high_balance") {
    where.push(`COALESCE(lb.balance,0) >= 500`);
  } else if (filter === "shopify_linked") {
    where.push(`pc.shopify_customer_gid IS NOT NULL`);
  } else if (filter === "active_30d") {
    where.push(`lb.last_event_at >= now() - interval '30 days'`);
  } else if (filter.startsWith("via_")) {
    args.push(filter.slice("via_".length));
    where.push(`pc.created_via = $${args.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const pool = getPool();
  const countArgs = [...args];
  const countSql = `SELECT COUNT(*)::text AS n
                      FROM pos_customers pc
                      LEFT JOIN loyalty_balance lb ON lb.customer_id = pc.id
                      ${whereSql}`;

  const listArgs = [...args, PAGE_SIZE, offset];
  const limitIdx = listArgs.length - 1;
  const offsetIdx = listArgs.length;

  const [c, list] = await Promise.all([
    pool.query<{ n: string }>(countSql, countArgs),
    pool.query<Row>(
      `SELECT pc.id,
              pc.first_name,
              pc.last_name,
              pc.email,
              pc.mobile_phone,
              pc.phone,
              COALESCE(lb.balance, 0)::text AS balance,
              COALESCE((SELECT SUM(delta_points) FROM loyalty_ledger
                          WHERE customer_id = pc.id AND delta_points > 0), 0)::text AS lifetime,
              lb.last_event_at,
              pc.shopify_customer_gid,
              pc.created_via,
              pc.created_at_geo,
              -- pos_locations holds no name; resolve via wms-owned locations
              l.name AS pos_location_name
         FROM pos_customers pc
         LEFT JOIN loyalty_balance lb ON lb.customer_id = pc.id
         LEFT JOIN pos_locations  pl ON pl.id = pc.pos_location_id
         LEFT JOIN locations      l  ON l.id  = pl.wms_location_id
         ${whereSql}
        ORDER BY COALESCE(lb.balance, 0) DESC, pc.last_name NULLS LAST, pc.first_name
        LIMIT $${limitIdx}::int OFFSET $${offsetIdx}::int`,
      listArgs,
    ),
  ]);

  const total = Number(c.rows[0]?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const baseHref = (p: number) =>
    `?q=${encodeURIComponent(q)}&filter=${filter}&page=${p}`;

  return (
    <AdminShell active="customers">
      <section className="p-8 max-w-7xl">
        <div className="flex items-start justify-between gap-4 mb-4">
          <p className="text-sm text-[var(--carbon-muted)]">
            Every <code>pos_customers</code> row joined to <code>loyalty_balance</code>.
            {" "}Click a row for the full ledger and to reward or adjust points.
          </p>
          <Link href="/admin/customers/import" className="carbon-btn-primary whitespace-nowrap">
            ⇪ Import CSV
          </Link>
        </div>

        <form className="flex flex-wrap gap-2 items-end mb-4">
          <label className="flex flex-col gap-1 flex-1 min-w-[260px]">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Search</span>
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Name, email, or phone…"
              className="carbon-input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Filter</span>
            <select name="filter" defaultValue={filter} className="carbon-input">
              <option value="all">All members</option>
              <option value="high_balance">Balance ≥ 500</option>
              <option value="shopify_linked">Shopify-linked</option>
              <option value="active_30d">Active last 30d</option>
              <optgroup label="By source">
                {Object.entries(SOURCE_LABELS).map(([key, v]) => (
                  <option key={key} value={`via_${key}`}>{v.label}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <button type="submit" className="carbon-btn-secondary">Apply</button>
          <Link href="/admin/customers" className="carbon-btn-secondary">Clear</Link>
        </form>

        <div className="carbon-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--carbon-surface-soft)] text-xs uppercase tracking-wider font-bold">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-right px-3 py-2">Balance</th>
                <th className="text-right px-3 py-2">Lifetime</th>
                <th className="text-left px-3 py-2">Last activity</th>
                <th className="text-left px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--carbon-border-soft)]">
              {list.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-[var(--carbon-muted)]">
                    No customers match.
                  </td>
                </tr>
              ) : (
                list.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--carbon-surface-soft)] cursor-pointer">
                    <td className="px-3 py-2">
                      <Link href={`/admin/customers/${r.id}`} className="block">
                        <span className="font-bold">
                          {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/customers/${r.id}`} className="block">
                        {r.email ?? <span className="text-[var(--carbon-muted)]">—</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/customers/${r.id}`} className="block">
                        {r.mobile_phone ?? r.phone ?? <span className="text-[var(--carbon-muted)]">—</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">
                      {Number(r.balance).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--carbon-muted)]">
                      {Number(r.lifetime).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[var(--carbon-muted)]">
                      {r.last_event_at ? new Date(r.last_event_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {(() => {
                        const v = SOURCE_LABELS[r.created_via ?? ""] ?? SOURCE_LABELS.legacy;
                        const where =
                          r.pos_location_name ?? r.created_at_geo ?? null;
                        return (
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={`inline-block w-fit px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${v.tone}`}
                            >
                              {v.label}
                            </span>
                            {where ? (
                              <span className="text-[11px] text-[var(--carbon-muted)]">
                                {where}
                                {r.shopify_customer_gid && r.created_via !== "shopify" ? " · shopify-linked" : ""}
                              </span>
                            ) : r.shopify_customer_gid && r.created_via !== "shopify" ? (
                              <span className="text-[11px] text-[var(--carbon-muted)]">shopify-linked</span>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm">
          <Link
            href={baseHref(Math.max(1, page - 1))}
            className={`carbon-btn-secondary ${page === 1 ? "opacity-40 pointer-events-none" : ""}`}
          >
            Prev
          </Link>
          <span className="text-[var(--carbon-muted)]">
            Page {page} of {totalPages} · {total.toLocaleString()} members
          </span>
          <Link
            href={baseHref(Math.min(totalPages, page + 1))}
            className={`carbon-btn-secondary ${page === totalPages ? "opacity-40 pointer-events-none" : ""}`}
          >
            Next
          </Link>
        </div>
      </section>
    </AdminShell>
  );
}
