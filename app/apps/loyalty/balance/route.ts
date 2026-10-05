import { NextResponse } from "next/server";
import { memberSummary } from "@/lib/member-summary";
import { proxyCustomer } from "@/lib/proxy-customer";

/**
 * GET /apps/loyalty/balance
 *
 * Shopify app proxy (shopcarbon.com/apps/loyalty/balance). Powers the
 * "Use your points" box in the cart drawer and cart page
 * (theme snippet carbon-rewards-cart). Same payload as
 * /api/account/summary, plus logged_in.
 */
export async function GET(req: Request) {
  const pc = await proxyCustomer(req);
  if (!pc.ok) return pc.res;
  const summary = await memberSummary(pc.customerId ? { id: pc.customerId, first_name: pc.firstName } : null);
  return NextResponse.json({ logged_in: true, ...summary });
}
