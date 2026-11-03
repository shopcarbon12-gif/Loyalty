import { NextResponse } from "next/server";
import { onlinePoints, storePurchases } from "@/lib/customer-purchases";
import { proxyCustomer } from "@/lib/proxy-customer";

/**
 * GET /apps/loyalty/purchases
 *
 * Shopify app proxy (shopcarbon.com/apps/loyalty/purchases). Powers the
 * Purchases panel of the storefront Member Club page (theme section
 * carbon-member-club): the logged-in customer's in-store receipts with the
 * points each earned, plus the points each online order earned (the online
 * orders themselves come from the theme's own customer.orders).
 */
export async function GET(req: Request) {
  const pc = await proxyCustomer(req);
  if (!pc.ok) return pc.res;
  if (!pc.customerId) return NextResponse.json({ logged_in: true, store: [], online_points: {} });
  const [store, online_points] = await Promise.all([storePurchases(pc.customerId), onlinePoints(pc.customerId)]);
  return NextResponse.json({ logged_in: true, store, online_points });
}
