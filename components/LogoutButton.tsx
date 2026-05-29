"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Topbar logout: POSTs to /api/auth/sign-out, clears the cookie, and
 * sends the browser to /login. Renders as a small material-symbol
 * button so it sits comfortably next to the user's email.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await fetch("/api/auth/sign-out", { method: "POST" });
          router.replace("/login");
          router.refresh();
        })
      }
      className="inline-flex items-center gap-1 text-xs uppercase tracking-wider font-bold text-[var(--carbon-muted)] hover:text-[var(--carbon-text)] disabled:opacity-50"
      title="Sign out"
    >
      <span className="material-symbols-outlined text-[18px]" aria-hidden>
        logout
      </span>
      <span className="hidden sm:inline">{pending ? "…" : "Sign out"}</span>
    </button>
  );
}
