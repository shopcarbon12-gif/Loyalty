import { shopifyGraphQL } from "./shopify";

/**
 * Carbon Rewards is retail only (owner 2026-11-07). A Shopify B2B buyer — a
 * customer who is a contact of a wholesale company — earns no points, gets no
 * signup bonus or referral reward, and cannot see or redeem a balance.
 *
 * The answer is cached for 10 minutes per customer (the account pages call
 * several endpoints at once). If Shopify can't be reached we answer "not
 * wholesale" so retail customers are never locked out by an outage.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { wholesale: boolean; at: number }>();

export const WHOLESALE_MESSAGE =
  "Carbon Rewards is for retail customers. Wholesale accounts don't earn or redeem points.";

export async function isWholesaleCustomer(customerGid: string): Promise<boolean> {
  const hit = cache.get(customerGid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.wholesale;
  try {
    const d = await shopifyGraphQL<{ customer: { companyContactProfiles: { id: string }[] } | null }>(
      `query RewardsB2B($id: ID!) { customer(id: $id) { companyContactProfiles { id } } }`,
      { id: customerGid },
    );
    const wholesale = (d.customer?.companyContactProfiles?.length ?? 0) > 0;
    cache.set(customerGid, { wholesale, at: Date.now() });
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
    return wholesale;
  } catch (err) {
    console.warn("[wholesale] lookup failed", customerGid, err instanceof Error ? err.message : err);
    return false;
  }
}
