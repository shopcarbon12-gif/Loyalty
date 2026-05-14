"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Loc = { id: string; code: string; name: string };

/**
 * Two-step manager sign-in for Carbon Loyalty. Visually matches the
 * Carbon POS register so floor staff see the same flow.
 *
 *   Step 1: location email + password.
 *   Step 2: 4-digit PIN keypad. If multiple locations match the email,
 *           the keypad starts disabled until the user picks one.
 *
 * Auth backend is owned by Carbon WMS — this screen calls placeholder
 * endpoints documented inline that the WMS team will provide. Until
 * those exist, the form short-circuits with a friendly message so the
 * UI can be reviewed without booting WMS.
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

  const [stage, setStage] = useState<"creds" | "pin">("creds");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [locations, setLocations] = useState<Loc[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinRef = useRef(pin);
  pinRef.current = pin;
  const locIdRef = useRef(locationId);
  locIdRef.current = locationId;

  /** Step 1 — verify location credentials against WMS. */
  const submitCreds = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setBusy(true);
      try {
        // TODO(wms): POST { email, password } → { locations: Loc[] }
        // The WMS auth service will own this endpoint.
        const res = await fetch("/api/auth/locations-for-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        }).catch(() => null);
        if (!res || !res.ok) {
          setError(
            "Auth service not connected yet — credentials are managed by Carbon WMS.",
          );
          return;
        }
        const data = (await res.json()) as { locations: Loc[] };
        const list = data.locations ?? [];
        if (list.length === 0) {
          setError("Email or password didn't match a location.");
          return;
        }
        setLocations(list);
        setLocationId(list.length === 1 ? list[0].id : "");
        setPin("");
        setStage("pin");
      } finally {
        setBusy(false);
      }
    },
    [email, password],
  );

  /** Step 2 — submit PIN. Backed by WMS auth (TBD). */
  const submitPin = useCallback(
    async (value: string, locId: string) => {
      if (!locId) return;
      setBusy(true);
      setError(null);
      const chosen = locations.find((l) => l.id === locId);
      // TODO(wms): POST { email, password, pin, locationId } → session cookie.
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          pin: value,
          locationId: locId,
        }),
      }).catch(() => null);
      setBusy(false);
      if (!res || !res.ok) {
        setError("That PIN didn't match for this location.");
        setPin("");
        return;
      }
      const target = chosen
        ? `/admin?loc=${chosen.code}`
        : (fromParam ?? "/admin");
      router.replace(target);
    },
    [email, password, locations, fromParam, router],
  );

  const tapDigit = useCallback((d: string) => {
    setPin((prev) => (prev + d).slice(0, 4));
  }, []);
  const tapBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);
  const tapEnter = useCallback(() => {
    const v = pinRef.current;
    const lid = locIdRef.current;
    if (!lid) {
      setError("Pick a location first.");
      return;
    }
    if (v.length !== 4) {
      setError("Enter all 4 digits, then press Enter.");
      return;
    }
    void submitPin(v, lid);
  }, [submitPin]);

  // Hardware keyboard support on the PIN screen.
  useEffect(() => {
    if (stage !== "pin") return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        tapDigit(e.key);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        tapBackspace();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        tapEnter();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPin("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, busy, tapDigit, tapBackspace, tapEnter]);

  const keypadDisabled = busy || !locationId;
  const [showPassword, setShowPassword] = useState(false);

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
          {/* Round logo badge above the card. */}
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
            {stage === "creds" ? (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-center mb-1">
                  Manager sign in
                </h1>
                <p className="text-[var(--carbon-muted)] text-sm text-center mb-8">
                  Enter the credentials your admin set for this location.
                </p>
                <form onSubmit={submitCreds} className="flex flex-col gap-4">
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
                        placeholder="name@yourstore.com"
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
                        Continue
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
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight mb-1">
                  Manager PIN
                </h1>
                <p className="text-[var(--carbon-muted)] text-sm mb-6">
                  {locations.length > 1
                    ? "Pick a location, then tap your 4-digit PIN."
                    : `Signing in to ${locations[0]?.code} · ${locations[0]?.name}.`}
                </p>

                {locations.length > 1 ? (
                  <div className="mb-6">
                    <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--carbon-muted)] mb-2">
                      Location
                    </label>
                    <select
                      value={locationId}
                      onChange={(e) => setLocationId(e.target.value)}
                      className="carbon-input tap w-full"
                    >
                      <option value="">— Choose a location —</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} · {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="flex gap-3 justify-center mb-6">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`pin-dot w-4 h-4 border-2 ${
                        i < pin.length
                          ? "bg-[var(--carbon-blue)] border-[var(--carbon-blue)]"
                          : "border-[var(--carbon-border)]"
                      }`}
                    />
                  ))}
                </div>
                <div
                  className={`grid grid-cols-3 gap-3 ${
                    keypadDisabled ? "opacity-50 pointer-events-none" : ""
                  }`}
                  aria-disabled={keypadDisabled}
                >
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={keypadDisabled}
                      className="tap-lg carbon-btn-secondary text-2xl font-semibold"
                      onClick={() => tapDigit(d)}
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={keypadDisabled}
                    className="tap-lg carbon-btn-ghost text-[var(--carbon-muted)] text-sm font-semibold uppercase tracking-wider"
                    onClick={() => setPin("")}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={keypadDisabled}
                    className="tap-lg carbon-btn-secondary text-2xl font-semibold"
                    onClick={() => tapDigit("0")}
                  >
                    0
                  </button>
                  <button
                    type="button"
                    disabled={keypadDisabled || pin.length !== 4}
                    className="tap-lg carbon-btn-primary text-sm font-bold uppercase tracking-wider"
                    onClick={tapEnter}
                  >
                    {busy ? "…" : "Enter"}
                  </button>
                </div>
                {keypadDisabled && !busy ? (
                  <p className="text-[11px] text-[var(--carbon-muted)] text-center mt-3 uppercase tracking-wider">
                    Pick a location to enable the keypad.
                  </p>
                ) : (
                  <p className="text-[11px] text-[var(--carbon-muted)] text-center mt-3 uppercase tracking-wider">
                    You can also type your PIN on the keyboard.
                  </p>
                )}

                <button
                  className="w-full mt-6 text-xs uppercase tracking-wider font-bold text-[var(--carbon-blue)] hover:underline"
                  onClick={() => {
                    setStage("creds");
                    setPin("");
                    setError(null);
                  }}
                >
                  ← Use a different email
                </button>
              </>
            )}

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
