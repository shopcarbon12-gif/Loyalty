import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { findRewardsUserForLogin } from "@/lib/queries/session-rewards-user";
import {
  sessionCookieName,
  sessionCookieSecure,
  signSession,
} from "@/lib/session";

const schema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

// In-memory brute-force throttle, keyed by client IP + email. Per-instance and
// reset on restart; an upstream proxy limit is the real defence at scale.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  // Last X-Forwarded-For hop is the one our proxy (Traefik) appends from the
  // real peer, so it can't be spoofed by an earlier client-supplied entry.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
    }
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

/**
 * POST /api/auth/sign-in
 *
 * Verifies the submitted email + password against rewards_employees
 * (WMS-managed) and, on success, sets the rewards_session cookie. No
 * locations, no PIN — the Rewards admin is a single-step credential
 * because the rewards_employees row carries a flat password.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400 },
    );
  }
  const rlKey = `${clientIp(req)}:${parsed.data.email.toLowerCase()}`;
  if (tooManyAttempts(rlKey)) {
    return NextResponse.json(
      { error: "too_many_attempts", message: "Too many sign-in attempts. Wait a few minutes." },
      { status: 429 },
    );
  }
  const pool = getPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database_unavailable" },
      { status: 500 },
    );
  }
  const session = await findRewardsUserForLogin(
    pool,
    parsed.data.email,
    parsed.data.password,
  );
  if (!session) {
    return NextResponse.json(
      { error: "invalid_credentials" },
      { status: 401 },
    );
  }
  attempts.delete(rlKey); // successful login clears the throttle
  const token = await signSession(session);
  const res = NextResponse.json({
    ok: true,
    email: session.email,
    role: session.role,
  });
  res.cookies.set({
    name: sessionCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(req),
    path: "/",
    // 7 days — must match the JWT setExpirationTime in lib/session.ts.
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
