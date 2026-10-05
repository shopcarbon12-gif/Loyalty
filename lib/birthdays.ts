import { getPool, withTransaction } from "./db";
import { queueEmail } from "./email";
import { insertLedger } from "./loyalty";
import { getSettings } from "./settings";

/**
 * Birthday bonus: members whose birthday is today (America/New_York) get
 * birthday_bonus_points once per year (ledger source_ref
 * birthday:<member>:<year>) and a birthday email. Feb 29 birthdays are
 * celebrated on Feb 28 in non-leap years.
 */
export async function awardBirthdays(today: { year: number; month: number; day: number }): Promise<{ awarded: number }> {
  const s = await getSettings();
  if (!s.live || s.birthday_bonus_points <= 0) return { awarded: 0 };
  const leap = (today.year % 4 === 0 && today.year % 100 !== 0) || today.year % 400 === 0;
  const alsoFeb29 = !leap && today.month === 2 && today.day === 28;
  const r = await getPool().query<{ id: number; shopify_customer_gid: string | null }>(
    `SELECT id, shopify_customer_gid FROM pos_customers
      WHERE birthday IS NOT NULL
        AND ((extract(month FROM birthday) = $1 AND extract(day FROM birthday) = $2)
          OR ($3 AND extract(month FROM birthday) = 2 AND extract(day FROM birthday) = 29))`,
    [today.month, today.day, alsoFeb29],
  );
  let awarded = 0;
  for (const m of r.rows) {
    await withTransaction(async (client) => {
      const ref = `birthday:${m.id}:${today.year}`;
      const before = await client.query(`SELECT 1 FROM loyalty_ledger WHERE source = 'system' AND source_ref = $1`, [ref]);
      if (before.rows[0]) return;
      const led = await insertLedger(client, {
        customer_id: m.id,
        shopify_gid: m.shopify_customer_gid,
        delta_points: s.birthday_bonus_points,
        reason: "birthday_bonus",
        source: "system",
        source_ref: ref,
        amount_basis: null,
      });
      await queueEmail(client, {
        customerId: m.id,
        template: "birthday_bonus",
        data: { points: s.birthday_bonus_points },
        ledgerId: led.id,
        dedupeKey: ref,
      });
      awarded++;
    });
  }
  return { awarded };
}
