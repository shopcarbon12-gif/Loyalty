import { getPool } from "./db";

/**
 * Minimal Shopify Admin GraphQL client. Reads the access token from the
 * shared `shopify_tokens` table that Carbon-Gen wrote at install time.
 * Carbon-Loyalty owns no install logic — it's purely a consumer of the
 * token Carbon-Gen already minted.
 *
 * Throttle/retry handling kept simple: one retry on 429 (Shopify) or
 * THROTTLED (GraphQL extension). For higher-volume needs we'd port
 * Carbon-Gen's full backoff helper, but loyalty events are low-volume
 * compared to the order-sync use case Carbon-Gen was built for.
 */
const API_VERSION = process.env.SHOPIFY_API_VERSION?.trim() || "2025-01";

async function getShopAndToken(shopDomain?: string): Promise<{ shop: string; token: string }> {
  const pool = getPool();
  // Single-merchant deployment — pick the most recently installed token.
  // If a shopDomain is specified (multi-shop in the future), filter on it.
  const r = shopDomain
    ? await pool.query<{ shop: string; access_token: string }>(
        `SELECT shop, access_token FROM shopify_tokens WHERE shop = $1 LIMIT 1`,
        [shopDomain],
      )
    : await pool.query<{ shop: string; access_token: string }>(
        `SELECT shop, access_token FROM shopify_tokens
          ORDER BY installed_at DESC NULLS LAST LIMIT 1`,
      );
  const row = r.rows[0];
  if (!row) throw new Error("no_shopify_token");
  return { shop: row.shop, token: row.access_token };
}

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown> = {},
  opts?: { shop?: string },
): Promise<T> {
  const { shop, token } = await getShopAndToken(opts?.shop);
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const body = JSON.stringify({ query, variables });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body,
    });
    if (res.status === 429) {
      lastErr = new Error("rate_limited");
      await sleep(800);
      continue;
    }
    if (!res.ok) {
      lastErr = new Error(`shopify_http_${res.status}`);
      throw lastErr;
    }
    const data = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    if (data.errors && data.errors.length) {
      const throttled = data.errors.some(
        (e) => e.extensions?.code === "THROTTLED",
      );
      if (throttled) {
        lastErr = new Error("graphql_throttled");
        await sleep(1500);
        continue;
      }
      throw new Error(
        `graphql_error: ${data.errors.map((e) => e.message).join(" · ")}`,
      );
    }
    if (!data.data) throw new Error("graphql_no_data");
    return data.data;
  }
  throw lastErr ?? new Error("shopify_unknown");
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Find a Shopify customer by email (preferred) or phone. Returns the GID
 * if found, null otherwise.
 */
export async function findShopifyCustomer(opts: {
  email?: string | null;
  phone?: string | null;
}): Promise<{ gid: string; email: string | null; phone: string | null } | null> {
  const q = opts.email
    ? `email:${quote(opts.email)}`
    : opts.phone
      ? `phone:${quote(opts.phone)}`
      : null;
  if (!q) return null;
  const data = await shopifyGraphQL<{
    customers: { edges: { node: { id: string; email: string | null; phone: string | null } }[] };
  }>(
    `query Find($q: String!) {
       customers(first: 1, query: $q) {
         edges { node { id email phone } }
       }
     }`,
    { q },
  );
  const node = data.customers.edges[0]?.node;
  if (!node) return null;
  return { gid: node.id, email: node.email, phone: node.phone };
}

function quote(s: string): string {
  return JSON.stringify(s);
}

/**
 * Upsert (write) a customer's loyalty.balance metafield. Type
 * number_integer; namespace + key driven by loyalty_settings.
 */
export async function writeBalanceMetafield(opts: {
  customerGid: string;
  balance: number;
  namespace?: string;
  key?: string;
}): Promise<void> {
  const ns = opts.namespace ?? "loyalty";
  const key = opts.key ?? "balance";
  await shopifyGraphQL(
    `mutation MfSet($mfs: [MetafieldsSetInput!]!) {
       metafieldsSet(metafields: $mfs) {
         metafields { id }
         userErrors { field message }
       }
     }`,
    {
      mfs: [
        {
          ownerId: opts.customerGid,
          namespace: ns,
          key,
          type: "number_integer",
          value: String(Math.max(0, Math.floor(opts.balance))),
        },
      ],
    },
  );
}
