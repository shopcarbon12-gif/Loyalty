"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Single-step sign-in for Carbon Rewards. Credentials live in WMS at
 * https://wms.shopcarbon.com/settings/users (rewards_employees row +
 * users.email + rewards_password_hash). The form POSTs to
 * /api/auth/sign-in which sets the rewards_session cookie.
 */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-[var(--carbon-bg)]">
          <p className="text-[var(--carbon-muted)]">Loading…</p>
        </main>
      }
    >
      <SignInInner />
    </Suspense>
  );
}

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const fromParam = params.get("from") ?? null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Email or password didn't match.");
        } else {
          setError("Sign-in failed. Try again in a moment.");
        }
        return;
      }
      // Sanitize the redirect target — only allow same-origin paths.
      const target =
        fromParam && fromParam.startsWith("/") ? fromParam : "/admin";
      router.replace(target);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-[var(--carbon-bg)]">
      {/* Brand panel — dark hex-pattern background image with the
          CarbonREWARDS wordmark, tagline, and copyright. Hidden on small
          screens; the round-logo badge above the card stands in. */}
      <aside
        className="hidden lg:flex flex-col justify-center p-12 text-white relative overflow-hidden"
        style={{
          backgroundColor: "#06122a",
          backgroundImage: "url(/login-brand-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "right center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div
          className="absolute inset-0 bg-black/30 pointer-events-none"
          aria-hidden
        />
        <div className="relative z-10">
          <h1 className="carbon-wordmark text-[5.25rem] font-black tracking-tight leading-[1.0] text-white">
            CarbonREWARDS.
          </h1>
          <h2
            className="text-6xl font-bold tracking-tight leading-[1.05] mt-2"
            style={{ color: "#7B9CE8" }}
          >
            Earn it. Keep them.
          </h2>
          <div
            className="mt-6 h-[3px] w-16"
            style={{ background: "#7B9CE8" }}
            aria-hidden
          />
          <p className="mt-6 text-2xl opacity-90 max-w-xl leading-snug">
            The loyalty program built on
            <br />
            every sale, every channel.
          </p>
        </div>
        <p className="absolute bottom-8 left-12 right-12 z-10 text-xs opacity-70">
          © Carbon Jeans Company. All rights reserved.
        </p>
      </aside>

      <section className="relative flex items-center justify-center p-6">
        <div className="relative w-full max-w-md">
          <div
            className="absolute left-1/2 -top-10 -translate-x-1/2 w-20 h-20 rounded-full bg-white border border-[var(--carbon-border-soft)] shadow-md flex items-center justify-center z-10"
            aria-hidden
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Carbon"
              className="w-12 h-12 object-cover rounded-full"
            />
          </div>

          <div className="carbon-card w-full p-10 pt-14">
            <h1 className="text-2xl font-bold tracking-tight text-center mb-1">
              Sign in
            </h1>
            <p className="text-[var(--carbon-muted)] text-sm text-center mb-8">
              Credentials are managed in WMS &rarr; Settings &rarr; Rewards users.
            </p>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--carbon-muted)] mb-2">
                  Email
                </label>
                <div className="relative">
                  <span
                    className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[var(--carbon-muted)] text-[18px] pointer-events-none"
                    aria-hidden
                  >
                    mail
                  </span>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@shopcarbon.com"
                    className="carbon-input tap w-full !pl-12"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--carbon-muted)] mb-2">
                  Password
                </label>
                <div className="relative">
                  <span
                    className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[var(--carbon-muted)] text-[18px] pointer-events-none"
                    aria-hidden
                  >
                    lock
                  </span>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="carbon-input tap w-full !pl-12 !pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-[var(--carbon-muted)] hover:text-[var(--carbon-text)]"
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden>
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="carbon-btn-primary tap-lg w-full text-base mt-2 inline-flex items-center justify-center gap-2"
              >
                {busy ? (
                  "Signing in…"
                ) : (
                  <>
                    Sign in
                    <span
                      className="material-symbols-outlined text-[20px]"
                      aria-hidden
                    >
                      arrow_forward
                    </span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 flex items-center gap-3" aria-hidden>
              <span className="flex-1 h-px bg-[var(--carbon-border-soft)]" />
              <span className="text-[11px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
                Secure
              </span>
              <span className="flex-1 h-px bg-[var(--carbon-border-soft)]" />
            </div>
            <p className="mt-3 text-xs text-[var(--carbon-muted)] flex items-center justify-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]" aria-hidden>
                lock
              </span>
              Your data is encrypted and secure
            </p>

            {error && (
              <p className="mt-6 text-center text-[var(--carbon-danger)] text-sm">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
