import { cookies } from "next/headers";
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
