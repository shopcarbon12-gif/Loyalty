/**
 * Employee / staff display names — owner rule (2026-10-12):
 *
 *   "when using employees name across all the projects, we should mention
 *    only first name and the first letter of the last name, e.g. Julian P.
 *    — only in reports you should keep it full."
 *
 * Display only — never apply before writing to the database. NOT for
 * customer names (customers are always shown as-is).
 */

/**
 * "Julian Perez" → "Julian P." (first token + initial of the LAST token).
 * A single name is returned unchanged, whitespace is collapsed, and
 * null / empty / email values pass straight through. Idempotent.
 */
export function shortStaffName(full: string | null | undefined): string | null | undefined {
  if (full == null) return full;
  const s = full.trim().replace(/\s+/g, " ");
  if (!s) return full;
  if (s.includes("@")) return s; // an email, not a name — leave it alone
  const parts = s.split(" ");
  if (parts.length === 1) return s;
  const first = parts[0]!;
  const initial = parts[parts.length - 1]!.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

/**
 * Staff label from a users row: "First L." from first/last, else the
 * email's local part (never the full address), else null.
 */
export function staffLabel(
  first: string | null | undefined,
  last: string | null | undefined,
  email?: string | null,
): string | null {
  const name = [first, last].map((v) => (v ?? "").trim()).filter(Boolean).join(" ");
  if (name) return shortStaffName(name) ?? null;
  const e = (email ?? "").trim();
  if (!e) return null;
  return e.includes("@") ? e.split("@")[0]!.trim() || e : (shortStaffName(e) ?? null);
}
