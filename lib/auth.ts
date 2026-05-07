import { timingSafeEqual } from "crypto";

/**
 * Server-to-server bearer auth used by Carbon-POS (and any other internal
 * caller) when hitting /api/v1/*. The shared key lives in LOYALTY_API_KEY
 * on both apps' Coolify env. Constant-time compare so request timing
 * doesn't leak the secret.
 */
export function isAuthorizedServerCall(req: Request): boolean {
  const expected = process.env.LOYALTY_API_KEY?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const got = match[1].trim();
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}
