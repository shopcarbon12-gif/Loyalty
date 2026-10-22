import { requireSession } from "@/lib/get-session";

/**
 * Server-side auth gate for every /admin page. Runs on the server before any
 * admin page renders and redirects to /login when there is no valid session,
 * so authorization never depends on middleware alone (defence in depth against
 * a middleware bypass such as CVE-2026-44575).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return <>{children}</>;
}
