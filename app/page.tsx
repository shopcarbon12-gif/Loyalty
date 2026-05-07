import { redirect } from "next/navigation";

/**
 * Root of loyalty.shopcarbon.com. Anonymous customers should never land
 * here directly — they reach the loyalty service via the Shopify storefront
 * widget (app proxy at shopcarbon.com/apps/loyalty/*) or via the Carbon-POS
 * server-to-server API. The only first-class human user is the back-office
 * admin, so the root just bounces to /admin.
 */
export default function Root() {
  redirect("/admin");
}
