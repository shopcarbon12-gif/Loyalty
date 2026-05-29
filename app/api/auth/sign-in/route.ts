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
