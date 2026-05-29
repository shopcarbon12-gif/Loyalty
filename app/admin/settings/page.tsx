import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getSettings, clearSettingsCache } from "@/lib/settings";
import { AdminShell } from "@/components/AdminShell";

export const dynamic = "force-dynamic";

/**
 * Admin → Settings — the rules for the program. Server action saves
 * straight to the loyalty_settings row and busts the in-process cache.
 */
export default async function SettingsPage() {
  const settings = await getSettings();

  async function save(formData: FormData) {
    "use server";
    const num = (k: string) => Number(formData.get(k) ?? 0);
    const bool = (k: string) => formData.get(k) === "on";
    await getPool().query(
      // coupon_ttl_hours is intentionally not written: the online-store
      // redemption flow that mints expiring Shopify discount codes isn't
      // built yet, so the field is hidden from the UI.
      `UPDATE loyalty_settings
          SET earn_rate_per_dollar         = $1,
              exclude_tax                  = $2,
              exclude_gift_card_purchases  = $3,
              redeem_points_per_dollar     = $4,
              min_redeem_points            = $5,
              redeem_increment_points      = $6,
              max_redeem_pct_of_order      = $7,
              allow_stacking_with_codes    = $8,
              signup_bonus_points          = $9,
              birthday_bonus_points        = $10,
              referral_reward_points       = $11,
              referee_earns_points         = $12,
              referral_min_purchase        = $13,
              points_never_expire          = $14,
              live                         = $15,
              updated_at                   = now()
        WHERE id = 1`,
      [
        num("earn_rate_per_dollar"),
        bool("exclude_tax"),
        bool("exclude_gift_card_purchases"),
        num("redeem_points_per_dollar"),
        num("min_redeem_points"),
        num("redeem_increment_points"),
        num("max_redeem_pct_of_order"),
        bool("allow_stacking_with_codes"),
        num("signup_bonus_points"),
        num("birthday_bonus_points"),
        num("referral_reward_points"),
        num("referee_earns_points"),
        num("referral_min_purchase"),
        bool("points_never_expire"),
        bool("live"),
      ],
    );
    clearSettingsCache();
    revalidatePath("/admin/settings");
    redirect("/admin/settings");
  }

  return (
    <AdminShell active="settings">
      <section className="p-8 max-w-3xl">
        <p className="text-sm text-[var(--carbon-muted)] mb-6">
          Tunable from here without a deploy. Carbon-POS reads these values via
          the loyalty API; Shopify webhooks read them server-side here.
        </p>
        <form action={save} className="space-y-6">
          <Group title="Earn">
            <Field label="Earn rate per $1" name="earn_rate_per_dollar"
                   type="number" step="0.0001" defaultValue={settings.earn_rate_per_dollar} />
            <Toggle label="Exclude tax from eligible amount" name="exclude_tax"
                    defaultChecked={settings.exclude_tax} />
            <Toggle label="Exclude gift-card purchase lines" name="exclude_gift_card_purchases"
                    defaultChecked={settings.exclude_gift_card_purchases} />
          </Group>
          <Group title="Redeem">
            <Field label="Points per $1 redeemed" name="redeem_points_per_dollar"
                   type="number" defaultValue={settings.redeem_points_per_dollar} />
            <Field label="Minimum redemption (pts)" name="min_redeem_points"
                   type="number" defaultValue={settings.min_redeem_points} />
            <Field label="Redemption increment (pts)" name="redeem_increment_points"
                   type="number" defaultValue={settings.redeem_increment_points} />
            <Field label="Max % of order subtotal" name="max_redeem_pct_of_order"
                   type="number" defaultValue={settings.max_redeem_pct_of_order} />
            <Toggle label="Allow stacking with other discount codes" name="allow_stacking_with_codes"
                    defaultChecked={settings.allow_stacking_with_codes} />
          </Group>
          <Group title="Bonuses">
            <Field label="Signup bonus (pts)" name="signup_bonus_points"
                   type="number" defaultValue={settings.signup_bonus_points} />
            <Field label="Birthday bonus (pts)" name="birthday_bonus_points"
                   type="number" defaultValue={settings.birthday_bonus_points} />
          </Group>
          <Group title="Referrals">
            <Field label="Referrer earns (pts)" name="referral_reward_points"
                   type="number" defaultValue={settings.referral_reward_points} />
            <Field label="Referee earns (pts)" name="referee_earns_points"
                   type="number" defaultValue={settings.referee_earns_points} />
            <Field label="Min qualifying purchase ($)" name="referral_min_purchase"
                   type="number" step="0.01" defaultValue={settings.referral_min_purchase} />
          </Group>
          <Group title="Lifetime">
            <Toggle label="Points never expire" name="points_never_expire"
                    defaultChecked={settings.points_never_expire} />
          </Group>
          <Group title="Live switch">
            <Toggle label="Rewards live — when ON, the program is live for customers"
                    name="live" defaultChecked={settings.live} />
          </Group>
          <button type="submit" className="carbon-btn-primary">Save settings</button>
        </form>
      </section>
    </AdminShell>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="carbon-card p-5">
      <h2 className="text-base font-bold mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  name,
  type,
  step,
  defaultValue,
}: {
  label: string;
  name: string;
  type: string;
  step?: string;
  defaultValue: number | string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
        {label}
      </span>
      <input
        type={type}
        name={name}
        step={step}
        defaultValue={defaultValue}
        className="carbon-input"
      />
    </label>
  );
}

function Toggle({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 sm:col-span-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span className="text-sm">{label}</span>
    </label>
  );
}
