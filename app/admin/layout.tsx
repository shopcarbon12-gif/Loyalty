import { redirect } from "next/navigation";
import { getSession, isAdminRole } from "@/lib/get-session";

/**
 * Server-side auth gate for every /admin page. Runs on the server before any
 * admin page renders, so authorization never depends on middleware alone
 * (defence in depth against a middleware bypass such as CVE-2026-44575).
 *
 *  - no session        → /login
 *  - session, non-admin → "access restricted" (no redirect, so a logged-in
 *    Manager doesn't bounce in a loop); only Super Admin sees the admin.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminRole(session.role)) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-[var(--carbon-bg)]">
        <div className="carbon-card max-w-md w-full p-8 text-center">
          <h1 className="text-xl font-bold mb-2">Access restricted</h1>
          <p className="text-[var(--carbon-muted)] text-sm">
            The Rewards admin is available to Super Admins only. Ask a Super
            Admin if you need access.
          </p>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
