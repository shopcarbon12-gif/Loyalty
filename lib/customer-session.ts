import { jwtVerify } from "jose";
import { NextResponse } from "next/server";

/**
 * Auth for the customer-account extension (shopify-app/extensions/).
 *
 * The extension sends `Authorization: Bearer <session token>`. Shopify
 * signs it HS256 with the Carbon_Studio app secret; `aud` is the app's
 * client id and `sub` is the logged-in customer's GID.
 */
export async function verifyCustomerSession(
  req: Request,
): Promise<{ customerGid: string } | null> {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();
  const clientId = process.env.SHOPIFY_APP_CLIENT_ID?.trim();
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!secret || !clientId || !m) return null;
  try {
    const { payload } = await jwtVerify(m[1].trim(), new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      audience: clientId,
      clockTolerance: 10,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub.startsWith("gid://shopify/Customer/")) {
      console.warn("[customer-session] no customer in token", { sub: payload.sub ?? null, dest: payload.dest });
      return null;
    }
    return { customerGid: sub };
  } catch (err) {
    // Log claims (never the token) so a rejected extension call is diagnosable.
    let claims: unknown = null;
    try {
      claims = JSON.parse(Buffer.from(m[1].split(".")[1] ?? "", "base64url").toString("utf8"));
    } catch {}
    console.warn("[customer-session] rejected", err instanceof Error ? err.message : err, claims);
    return null;
  }
}

// Extensions run in a sandboxed worker on Shopify's CDN origin, so every
// response (and the preflight) needs permissive CORS. Auth is the bearer
// token, not cookies, so `*` is safe here.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function corsJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
