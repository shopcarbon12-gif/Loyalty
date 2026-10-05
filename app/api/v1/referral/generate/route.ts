import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedServerCall } from "@/lib/auth";
import { referralCode, shareUrl } from "@/lib/referrals";

const schema = z.object({
  customer_id: z.number().int().positive(),
});

/**
 * POST /api/v1/referral/generate
 *
 * Returns the customer's referral code, minting one if they don't have
 * one yet. Codes look like CARBON-7K2P9F (a random 6-char suffix —
 * collisions are vanishingly rare and we surface a 409 on the unique
 * constraint if one slips through).
 */
export async function POST(req: Request) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { customer_id } = parsed.data;

  const code = await referralCode(customer_id);
  if (!code) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }
  return NextResponse.json({ code, share_url: shareUrl(code) });
}
