import { getPool } from "@/lib/db";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

type CommsRow = {
  id: string;
  channel: "email" | "sms";
  template: string;
  to_address: string;
  status: "sent" | "failed" | "bounced" | "queued";
  created_at: string;
  customer_first: string | null;
  customer_last: string | null;
};

/**
 * Admin → Communications — log of every transactional email/SMS the
 * loyalty service emits. Welcome / birthday / tier-change / redemption
 * confirmations all land here.
 */
export default async function CommsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const channel = sp.channel ?? "";
  const status = sp.status ?? "";

  const pool = getPool();
  const args: unknown[] = [];
  const where: string[] = [];
  if (channel) {
    args.push(channel);
    where.push(`l.channel = $${args.length}`);
  }
  if (status) {
    args.push(status);
    where.push(`l.status = $${args.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const r = await pool.query<CommsRow>(
    `SELECT l.id::text, l.channel, l.template, l.to_address, l.status, l.created_at,
            pc.first_name AS customer_first, pc.last_name AS customer_last
       FROM loyalty_comms_log l
       LEFT JOIN pos_customers pc ON pc.id = l.customer_id
       ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT 100`,
    args,
  );

  const stats = await pool.query<{ channel: string; status: string; n: string }>(
    `SELECT channel, status, COUNT(*)::text AS n
       FROM loyalty_comms_log
      WHERE created_at >= now() - interval '30 days'
      GROUP BY channel, status`,
  );

  return (
    <AdminShell active="comms">
      <section className="p-8 max-w-6xl">
        <p className="text-sm text-[var(--carbon-muted)] mb-4">
          Every transactional message the program sends. Welcome, birthday,
          tier-change and redemption confirmations land here once Resend +
          Twilio are wired in.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Sent (30d, email)" value={
            stats.rows.find((s) => s.channel === "email" && s.status === "sent")?.n ?? "0"
          } />
          <Stat label="Sent (30d, SMS)" value={
            stats.rows.find((s) => s.channel === "sms" && s.status === "sent")?.n ?? "0"
          } />
          <Stat label="Failed (30d)" value={
            stats.rows.filter((s) => s.status === "failed").reduce((a, b) => a + Number(b.n), 0).toLocaleString()
          } />
          <Stat label="Queued" value={
            stats.rows.filter((s) => s.status === "queued").reduce((a, b) => a + Number(b.n), 0).toLocaleString()
          } />
        </div>

        <form className="flex gap-2 items-end mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Channel</span>
            <select name="channel" defaultValue={channel} className="carbon-input">
              <option value="">All</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">Status</span>
            <select name="status" defaultValue={status} className="carbon-input">
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="bounced">Bounced</option>
              <option value="queued">Queued</option>
            </select>
          </label>
          <button type="submit" className="carbon-btn-secondary">Apply</button>
        </form>

        <div className="carbon-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--carbon-surface-soft)] text-xs uppercase tracking-wider font-bold">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Channel</th>
                <th className="text-left px-3 py-2">Template</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-left px-3 py-2">To</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--carbon-border-soft)]">
              {r.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-[var(--carbon-muted)]">
                    No messages yet — Resend + Twilio integrations come online in B6.
                  </td>
                </tr>
              ) : (
                r.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{row.channel}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.template}</td>
                    <td className="px-3 py-2">
                      {[row.customer_first, row.customer_last].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-3 py-2">{row.to_address}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.status === "sent"
                            ? "text-[var(--carbon-success)] font-bold text-xs uppercase tracking-wider"
                            : row.status === "failed" || row.status === "bounced"
                              ? "text-[var(--carbon-danger)] font-bold text-xs uppercase tracking-wider"
                              : "text-[var(--carbon-muted)] font-bold text-xs uppercase tracking-wider"
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="carbon-card p-4">
      <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
