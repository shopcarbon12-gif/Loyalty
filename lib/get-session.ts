import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName, verifySessionToken, type SessionPayload } from "@/lib/session";

/**
 * Server-side helper: read the rewards_session cookie and return the
 * decoded payload (or null if absent/invalid). Use from server
 * components and server actions, NOT route handlers — handlers should
 * call cookies() / verifySessionToken() directly so middleware can
 * see the result.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Server-side authorization guard for admin server components and server
 * actions. Redirects to /login when there is no valid session. Call this at
 * the top of every /admin page (via the admin layout) and inside every admin
 * server action — middleware is a coarse gate and must not be the only check.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** True only for the Rewards "Super Admin" role (matches "super_admin",
 *  "super-admin", etc.). Manager and any other role are NOT admins. */
export function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").toLowerCase().replace(/[^a-z]/g, "") === "superadmin";
}

/**
 * Stricter guard for mutating admin server actions: requires a valid session
 * AND the Super Admin role. A logged-in non-admin (e.g. Manager) is bounced to
 * /login?denied=1 rather than allowed to adjust points / change settings.
 */
export async function requireAdminSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminRole(session.role)) redirect("/login?denied=1");
  return session;
}
