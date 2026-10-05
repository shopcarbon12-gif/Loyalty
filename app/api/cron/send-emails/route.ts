import { NextResponse } from "next/server";
import { isAuthorizedServerCall } from "@/lib/auth";
import { sendQueuedEmails } from "@/lib/email";

/**
 * POST /api/cron/send-emails
 *
 * Delivers queued member emails through Resend (lib/email.ts). Run every
 * minute by a Coolify scheduled task (bearer LOYALTY_API_KEY).
 */
export async function POST(req: Request) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await sendQueuedEmails()) });
  } catch (err) {
    console.error("[send-emails]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
