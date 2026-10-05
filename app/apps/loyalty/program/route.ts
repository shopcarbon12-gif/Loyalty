import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { verifyAppProxySignature } from "@/lib/shopify-hmac";
import { listTiers } from "@/lib/tiers";

/**
 * GET /apps/loyalty/program
 *
 * Shopify app proxy, no sign-in needed. The program's public rules for the
 * storefront rewards widget's "how it works" panel, so it always matches
 * loyalty_settings / loyalty_tiers.
 */
export async function GET(req: Request) {
  if (!verifyAppProxySignature(new URL(req.url))) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const s = await getSettings();
  const tiers = await listTiers();
  return NextResponse.json(
    {
      live: s.live,
      earn_rate_per_dollar: s.earn_rate_per_dollar,
      redeem_points_per_dollar: s.redeem_points_per_dollar,
      redeem_increment_points: s.redeem_increment_points,
      max_redeem_dollars_per_order: s.max_redeem_dollars_per_order,
      signup_bonus_points: s.signup_bonus_points,
      birthday_bonus_points: s.birthday_bonus_points,
      referral: { you_get: s.referral_reward_points, friend_gets: s.referee_earns_points, min_purchase: Number(s.referral_min_purchase) },
      tier_metric: s.tier_qualifying_metric,
      tiers: tiers.map((t) => ({ name: t.name, threshold: t.qualifying_points, multiplier: t.earn_multiplier })),
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
