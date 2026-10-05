import { NextResponse } from "next/server";
import { isAuthorizedServerCall } from "@/lib/auth";
import { awardBirthdays } from "@/lib/birthdays";
import { getPool } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { recomputeTiers } from "@/lib/tiers";

/**
 * POST /api/cron/daily   (?force=1 to run now)
 *
 * Fired hourly by a Coolify scheduled task (bearer LOYALTY_API_KEY). Runs
 * the daily batch — birthday bonuses, then tier promotions/demotions —
 * once per day, at/after loyalty_settings.tier_batch_hour_est (America/New_York).
 */
export async function POST(req: Request) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  const now = etParts(new Date());
  const s = await getSettings();
  if (!force && now.hour < s.tier_batch_hour_est) {
    return NextResponse.json({ ok: true, skipped: "before_batch_hour", et_hour: now.hour });
  }
  const date = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
  const claim = await getPool().query(
    `INSERT INTO loyalty_job_runs (job, run_date) VALUES ('daily', $1) ON CONFLICT DO NOTHING RETURNING 1`,
    [date],
  );
  if (!claim.rows[0] && !force) return NextResponse.json({ ok: true, skipped: "already_ran", date });
  try {
    const birthdays = await awardBirthdays(now);
    const tiers = await recomputeTiers();
    const result = { birthdays, tiers };
    await getPool().query(
      `UPDATE loyalty_job_runs SET result = $2, ran_at = now() WHERE job = 'daily' AND run_date = $1`,
      [date, JSON.stringify(result)],
    );
    return NextResponse.json({ ok: true, date, ...result });
  } catch (err) {
    console.error("[cron/daily]", err);
    // Release the claim so the next hourly run retries.
    await getPool().query(`DELETE FROM loyalty_job_runs WHERE job = 'daily' AND run_date = $1 AND result IS NULL`, [date]);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

function etParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) };
}
