import Link from "next/link";

/**
 * Bare-bones AdminShell for loyalty.shopcarbon.com. Same Carbon look as
 * Carbon-POS — sidebar + topbar + main column.
 *
 * For B0/B1 we don't gate the UI with a NextAuth session (the service
 * is internal-only and Coolify can be set to require basic-auth in front
 * of it). B6 wires a real shared NextAuth session with Carbon-POS.
 */
export function AdminShell({
  active,
  title,
  children,
}: {
  active: "dashboard" | "settings" | "ledger" | "customers" | "tiers" | "referrals" | "comms";
  title?: string;
  children: React.ReactNode;
}) {
  const NAV = [
    { key: "dashboard", icon: "dashboard",      href: "/admin", label: "Dashboard" },
    { key: "customers", icon: "people",         href: "/admin/customers", label: "Customers" },
    { key: "ledger",    icon: "list",           href: "/admin/ledger", label: "Transactions" },
    { key: "tiers",     icon: "stars",          href: "/admin/tiers", label: "Tiers" },
    { key: "referrals", icon: "share",          href: "/admin/referrals", label: "Referrals" },
    { key: "comms",     icon: "mail",           href: "/admin/comms", label: "Communications" },
    { key: "settings",  icon: "settings",       href: "/admin/settings", label: "Rules & Settings" },
  ] as const;
  return (
    <div className="min-h-screen bg-[var(--carbon-bg)] text-[var(--carbon-text)]">
      <aside className="carbon-sidebar fixed left-0 top-0 h-screen flex flex-col py-8 px-3 z-40">
        <Link href="/admin" className="mb-10 px-3 flex items-end gap-3">
          {/* Same /logo.jpg lockup as Carbon-POS so the two services share
              identity. Falls back to a colored tile if the asset is missing
              so the chrome doesn't break before the file lands. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Carbon"
            className="w-24 h-24 object-cover shrink-0"
          />
          <span className="carbon-wordmark text-2xl font-semibold tracking-tight leading-none pb-1">
            Carbon <b className="font-extrabold tracking-wider">LOYALTY</b>
          </span>
        </Link>
        <nav className="flex-1 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`carbon-nav-item ${active === item.key ? "active" : ""}`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-[var(--carbon-border-soft)] pt-4 mt-4 px-4">
          <p className="text-xs text-[var(--carbon-muted)]">Carbon-Loyalty</p>
          <p className="text-xs text-[var(--carbon-muted)]">loyalty.shopcarbon.com</p>
        </div>
      </aside>
      <div
        className="flex flex-col min-h-screen"
        style={{ marginLeft: "var(--carbon-sidebar-w)" }}
      >
        <header className="carbon-topbar sticky top-0 z-20 flex items-center px-6 lg:px-8 gap-4">
          <span className="material-symbols-outlined text-[var(--carbon-blue)]" aria-hidden>
            {NAV.find((n) => n.key === active)?.icon ?? "dashboard"}
          </span>
          <h1 className="text-lg font-bold tracking-tight">
            {title ?? NAV.find((n) => n.key === active)?.label}
          </h1>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
