import { SignJWT, jwtVerify } from "jose";

/**
 * Cookie-based session for rewards.shopcarbon.com — mirrors the WMS
 * pattern (lib/auth.ts there) so the two services behave identically.
 * Credentials live in `rewards_employees` (managed from WMS at
 * /settings → Rewards users); we don't store sessions in the DB, we
 * sign a short JWT with SESSION_SECRET.
 */

const COOKIE_NAME = "rewards_session";

export type SessionPayload = {
  /** users.id (UUID) */
  sub: string;
  email: string;
  /** user_roles.name for the row referenced by rewards_employees.rewards_role_id */
  role: string;
};

function getSecret(): Uint8Array {
  // Prefer a dedicated SESSION_SECRET (lets us rotate the auth secret
  // independently of NextAuth). Fall back to NEXTAUTH_SECRET so a fresh
  // deploy still has a usable key. Dev fallback is intentionally bad so
  // it can't accidentally ship to production.
  const raw =
    process.env.SESSION_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    "dev-only-change-me-min-32-chars!!!!";
  return new TextEncoder().encode(raw);
}

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

/**
 * Set Secure only when the browser used HTTPS. In production behind
 * Traefik we trust X-Forwarded-Proto. Identical logic to WMS so a
 * misconfigured proxy hits the same fix in both apps.
 */
export function sessionCookieSecure(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const override = process.env.REWARDS_SESSION_COOKIE_SECURE?.trim();
  if (override === "0" || override === "false") return false;
  if (override === "1" || override === "true") return true;
  const raw = req.headers.get("x-forwarded-proto");
  const proto = raw?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ email: p.email, role: p.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const sub = payload.sub;
    const email = payload.email as string | undefined;
    const roleRaw = payload.role as string | undefined;
    if (!sub || !email) return null;
    return { sub, email, role: roleRaw?.trim() || "member" };
  } catch {
    return null;
  }
}
