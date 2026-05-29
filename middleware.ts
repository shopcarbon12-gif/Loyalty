import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, verifySessionToken } from "@/lib/session";

/**
 * Gate /admin/* on a valid rewards_session cookie. Unauthenticated
 * requests get redirected to /login with `?from=<path>` so we can send
 * them back where they were trying to go.
 *
 * The /api/auth/* and /api/v1/* routes are NOT gated here:
 *   - /api/auth/* needs to be reachable for sign-in/out themselves
 *   - /api/v1/* is server-to-server (bearer token via lib/auth.ts)
 *   - /api/admin/* same — bearer token, called from WMS
 *   - /apps/loyalty/* is Shopify storefront app-proxy, signed via HMAC
 *   - /api/shopify/* is webhooks, signed via HMAC
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Only gate /admin/*.
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  const token = req.cookies.get(sessionCookieName())?.value;
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload) return NextResponse.next();
  }

  // Not signed in — bounce to /login, preserving the destination.
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname + (search || ""));
  return NextResponse.redirect(url);
}

export const config = {
  // Match /admin and everything under it. Static assets and other
  // routes pass through unchanged.
  matcher: ["/admin/:path*"],
};
