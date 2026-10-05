import type { PoolClient } from "pg";
import { getPool } from "./db";
import { getSettings } from "./settings";

/**
 * Member emails. Callers queue inside their own transaction
 * (loyalty_comms_log, status 'queued'); /api/cron/send-emails renders and
 * delivers them through Resend every minute. A dedupe key makes one email
 * per event (e.g. birthday:<member>:<year>) however often a job re-runs.
 */
export type EmailTemplate =
  | "points_earned"
  | "reward_code"
  | "birthday_bonus"
  | "tier_upgrade"
  | "referral_reward"
  | "referral_welcome";

const REWARDS_URL = "https://account.shopcarbon.com/pages/01a10b52-0216-71b7-9eed-6d9ea4827972";
const SHOP_URL = "https://shopcarbon.com";

export async function queueEmail(
  db: PoolClient | ReturnType<typeof getPool>,
  e: {
    customerId: number;
    template: EmailTemplate;
    data: Record<string, unknown>;
    ledgerId?: number | null;
    dedupeKey?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO loyalty_comms_log
       (customer_id, channel, template, to_address, status, related_ledger_id, payload, dedupe_key)
     SELECT c.id, 'email', $2, c.email, 'queued', $3, $4::jsonb, $5
       FROM pos_customers c
      WHERE c.id = $1 AND NULLIF(trim(c.email), '') IS NOT NULL
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [e.customerId, e.template, e.ledgerId ?? null, JSON.stringify(e.data), e.dedupeKey ?? null],
  );
}

export async function sendQueuedEmails(limit = 40): Promise<{ sent: number; failed: number; skipped: number }> {
  const pool = getPool();
  const s = await getSettings();
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.LOYALTY_FROM_EMAIL?.trim() || "Carbon Rewards <rewards@carbonjeanscompany.com>";
  const rows = await pool.query<{
    id: string; template: EmailTemplate; to_address: string; payload: Record<string, unknown>; first_name: string | null; balance: number;
  }>(
    `SELECT l.id::text, l.template, l.to_address, COALESCE(l.payload, '{}'::jsonb) AS payload, c.first_name,
            COALESCE((SELECT SUM(delta_points) FROM loyalty_ledger WHERE customer_id = c.id), 0)::int AS balance
       FROM loyalty_comms_log l LEFT JOIN pos_customers c ON c.id = l.customer_id
      WHERE l.status = 'queued' AND l.channel = 'email'
      ORDER BY l.created_at
      LIMIT $1`,
    [limit],
  );
  let sent = 0, failed = 0, skipped = 0;
  for (const r of rows.rows) {
    // Switched off, or no provider: don't send, don't keep retrying.
    if (!s.emails_enabled || !key) {
      await pool.query(`UPDATE loyalty_comms_log SET status = 'failed', error_message = $2 WHERE id = $1`,
        [r.id, !key ? "RESEND_API_KEY missing" : "emails disabled in settings"]);
      skipped++;
      continue;
    }
    const msg = render(r.template, { ...r.payload, first_name: r.first_name, balance: r.balance });
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [r.to_address], subject: msg.subject, html: msg.html, text: msg.text }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) throw new Error(body.message || `resend_http_${res.status}`);
      await pool.query(
        `UPDATE loyalty_comms_log SET status = 'sent', provider_id = $2, subject = $3, sent_at = now() WHERE id = $1`,
        [r.id, body.id ?? null, msg.subject],
      );
      sent++;
    } catch (err) {
      await pool.query(
        `UPDATE loyalty_comms_log SET status = 'failed', subject = $3, error_message = $2 WHERE id = $1`,
        [r.id, String(err instanceof Error ? err.message : err).slice(0, 500), msg.subject],
      );
      failed++;
    }
  }
  return { sent, failed, skipped };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type Rendered = { subject: string; html: string; text: string };

function render(t: EmailTemplate, d: Record<string, unknown>): Rendered {
  const name = esc(String(d.first_name || "there"));
  const bal = Number(d.balance ?? 0);
  const balLine = `You now have <b>${bal.toLocaleString()} points</b> — every 100 points is $10 off.`;
  switch (t) {
    case "points_earned":
      return layout(
        `You earned ${d.points} Carbon Rewards points`,
        `Hi ${name}, you earned <b>${d.points} points</b>${d.where ? ` on your ${esc(String(d.where))} purchase` : ""}.`,
        balLine,
        bal >= 100 ? ["Redeem your points", REWARDS_URL] : ["Keep shopping", SHOP_URL],
      );
    case "reward_code":
      return layout(
        `Your $${d.dollars} Carbon Rewards code: ${d.code}`,
        `Hi ${name}, here's your reward code for <b>$${d.dollars} off</b> your items:`,
        `<div style="font:700 26px/1.2 monospace;letter-spacing:2px;padding:14px 0">${esc(String(d.code))}</div>` +
          `Use it at checkout by ${esc(String(d.expires || ""))} on items totaling $${d.min_subtotal} or more (shipping not included). ` +
          `Unused codes return their points automatically.`,
        ["Shop now", SHOP_URL],
      );
    case "birthday_bonus":
      return layout(
        `Happy birthday, ${String(d.first_name || "there")}! ${d.points} points are on us`,
        `Happy birthday, ${name}! 🎉 We added <b>${d.points} bonus points</b> to your Carbon Rewards.`,
        balLine,
        ["Treat yourself", REWARDS_URL],
      );
    case "tier_upgrade":
      return layout(
        `You're now ${d.tier_name} in Carbon Rewards`,
        `Congrats ${name} — you've reached <b>${esc(String(d.tier_name))}</b>.`,
        `From now on you earn <b>${d.multiplier}× points</b> on every purchase` +
          (Array.isArray(d.perks) && d.perks.length ? `, plus: ${d.perks.map((p) => esc(String(p))).join(", ")}.` : "."),
        ["See your rewards", REWARDS_URL],
      );
    case "referral_reward":
      return layout(
        `Your friend shopped — you earned ${d.points} points`,
        `Thanks for spreading the word, ${name}! A friend you referred just made their first purchase, so we added <b>${d.points} points</b> to your account.`,
        balLine,
        ["Share your link again", REWARDS_URL],
      );
    case "referral_welcome":
      return layout(
        `Welcome to Carbon Rewards — ${d.points} bonus points`,
        `Hi ${name}, thanks for shopping with a friend's link! We added <b>${d.points} bonus points</b> to your Carbon Rewards.`,
        balLine,
        ["See your rewards", REWARDS_URL],
      );
  }
}

function layout(subject: string, lead: string, body: string, cta: [string, string]): Rendered {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:#000;padding:22px 28px;color:#fff;font-weight:800;letter-spacing:3px;font-size:18px">CARBON <span style="color:#d946ef">REWARDS</span></td></tr>
<tr><td style="padding:28px;font-size:16px;line-height:1.5">
<p style="margin:0 0 14px">${lead}</p>
<p style="margin:0 0 22px">${body}</p>
<a href="${cta[1]}" style="display:inline-block;background:#7b2cff;background-image:linear-gradient(90deg,#7b2cff,#d946ef);color:#fff;text-decoration:none;font-weight:800;text-transform:uppercase;letter-spacing:1px;font-size:14px;padding:14px 26px;border-radius:4px">${cta[0]}</a>
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #eee;font-size:12px;color:#777">You're receiving this because you're a Carbon Rewards member. 1 point for every $1 · every 100 points = $10 off.<br><a href="${SHOP_URL}" style="color:#777">shopcarbon.com</a></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${strip(lead)}\n\n${strip(body)}\n\n${cta[0]}: ${cta[1]}\n\n— Carbon Rewards`;
  return { subject, html, text };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
}
