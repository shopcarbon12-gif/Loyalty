import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a Shopify webhook request's HMAC.
 *
 * Shopify signs the raw request body with the app's API secret using
 * HMAC-SHA256 and base64-encodes the digest into the
 * X-Shopify-Hmac-Sha256 header. We compute the same digest server-side
 * and constant-time-compare.
 *
 * Caller MUST pass the raw body bytes — JSON.parse first then re-stringify
 * does NOT round-trip Shopify's exact byte sequence.
 */
export function verifyWebhookHmac(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!secret || !hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  if (digest.length !== hmacHeader.length) return false;
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

/**
 * Verify an app-proxy request's signature. Shopify rewrites
 * shopcarbon.com/apps/loyalty/X → loyalty.shopcarbon.com/X with a
 * `signature` query param computed over the OTHER query params sorted
 * lexicographically and concatenated as key=value pairs (no separator).
 *
 * Returns true if the signature matches; false otherwise.
 */
export function verifyAppProxySignature(url: URL): boolean {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  if (!secret) return false;
  const sig = url.searchParams.get("signature");
  if (!sig) return false;
  const params: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    if (k !== "signature") params.push([k, v]);
  });
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const message = params.map(([k, v]) => `${k}=${v}`).join("");
  const digest = createHmac("sha256", secret).update(message, "utf8").digest("hex");
  if (digest.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(sig));
  } catch {
    return false;
  }
}
