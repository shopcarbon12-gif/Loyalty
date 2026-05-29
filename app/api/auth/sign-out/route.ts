import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/session";

/**
 * POST /api/auth/sign-out — clear the rewards_session cookie. We accept
 * POST (and GET as a convenience for a link) so the LogoutButton in the
 * AdminShell can be a plain form. Always responds 200; nothing to
 * verify before deleting.
 */
function signOut(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: sessionCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function POST() { return signOut(); }
export async function GET()  { return signOut(); }
