/**
 * CSV customer importer used by /admin/customers/import.
 *
 * Accepts a tolerant column set — Kangaroo's dashboard CSV export,
 * Shopify's "Customers" CSV export, and plain hand-rolled spreadsheets
 * all map cleanly. Required: at least one of email or phone (we need a
 * matching key per Kangaroo's "Email + Phone" sync).
 *
 * Optional `balance` column writes a single migration ledger row per
 * imported customer with reason='migration', source='admin',
 * source_ref='csv:<key>'. The unique (source, source_ref) index keeps
 * a re-run from double-crediting.
 */

import { PoolClient } from "pg";
import { withTransaction } from "./db";
import { insertLedger } from "./loyalty";

export type ParsedRow = {
  rowIndex: number;          // 1-indexed, excluding header
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;   // ISO yyyy-mm-dd
  balance: number | null;    // points to credit
  external_ref: string | null; // e.g. kangaroo user_uid for idempotency
  raw: Record<string, string>;
};

export type RowOutcome = {
  rowIndex: number;
  status: "matched" | "created" | "skipped" | "error";
  pos_customer_id?: number;
  ledger_id?: number;
  message?: string;
  identity?: string;
};

export type ImportSummary = {
  total: number;
  matched: number;
  created: number;
  skipped: number;
  errors: number;
  pointsCredited: number;
  outcomes: RowOutcome[];
};

const COL_ALIASES: Record<keyof ParsedRow, string[]> = {
  rowIndex:    [],
  first_name:  ["first_name", "firstname", "first name", "given name", "given_name"],
  last_name:   ["last_name", "lastname", "last name", "family name", "family_name", "surname"],
  email:       ["email", "e-mail", "email address"],
  phone:       ["phone", "mobile", "mobile phone", "mobile_phone", "phone number", "cell"],
  birthday:    ["birthday", "birth date", "birth_date", "dob", "date of birth"],
  balance:     ["balance", "points", "point balance", "points_balance", "user_balance"],
  external_ref:["external_ref", "kangaroo_id", "user_uid", "id", "loyalty_id"],
  raw:         [],
};

/**
 * Parse a CSV string into typed rows. Header row is required.
 * Quoted fields with embedded commas/newlines are supported via a small
 * state machine — we don't depend on a CSV library so this stays portable.
 */
export function parseCsv(text: string): { headers: string[]; rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const lines = splitCsv(text.replace(/\r\n/g, "\n"));
  if (lines.length === 0) return { headers: [], rows: [], errors: ["empty file"] };

  const headers = (lines[0] || []).map((h) => h.trim().toLowerCase());
  if (headers.length === 0) return { headers: [], rows: [], errors: ["no headers detected"] };

  const colMap: Partial<Record<keyof ParsedRow, number>> = {};
  for (const key of Object.keys(COL_ALIASES) as (keyof ParsedRow)[]) {
    const aliases = COL_ALIASES[key];
    if (!aliases.length) continue;
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx >= 0) colMap[key] = idx;
  }

  if (colMap.email === undefined && colMap.phone === undefined) {
    errors.push("CSV must include an email or phone column");
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i];
    if (!cells || cells.every((c) => c.trim() === "")) continue;
    const get = (k: keyof ParsedRow) =>
      colMap[k] !== undefined ? (cells[colMap[k] as number] ?? "").trim() : "";
    const raw: Record<string, string> = {};
    headers.forEach((h, j) => (raw[h] = (cells[j] ?? "").trim()));
    const balanceStr = get("balance");
    const balance = balanceStr ? Number(balanceStr.replace(/[, $]/g, "")) : null;
    rows.push({
      rowIndex: i,
      first_name: get("first_name") || null,
      last_name: get("last_name") || null,
      email: normEmail(get("email")) || null,
      phone: normPhone(get("phone")) || null,
      birthday: normBirthday(get("birthday")) || null,
      balance: balance != null && Number.isFinite(balance) ? Math.round(balance) : null,
      external_ref: get("external_ref") || null,
      raw,
    });
  }
  return { headers, rows, errors };
}

function splitCsv(s: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); out.push(cur); cur = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    out.push(cur);
  }
  return out;
}

function normEmail(s: string): string {
  return s.toLowerCase().trim();
}

function normPhone(s: string): string {
  // Strip every non-digit. We don't fold to E.164 because the data is
  // already messy — losing a + or country code on roundtrip is worse
  // than letting the matcher use whatever digits exist on both sides.
  return s.replace(/[^\d]/g, "");
}

function normBirthday(s: string): string {
  if (!s) return "";
  // Accept yyyy-mm-dd, mm/dd/yyyy, dd/mm/yyyy (USA-likely so we prefer mm/dd).
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return s;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const [, a, b, y] = m2;
    return `${y}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
  }
  return "";
}

/**
 * Run the import inside a single transaction. Match by email-AND-phone
 * (Kangaroo's default sync key); fall back to email-only or phone-only
 * matches if both aren't present. Insert when no match.
 */
export async function importRows(
  rows: ParsedRow[],
  opts: { creditBalance: boolean; sourceTag: string },
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    total: rows.length,
    matched: 0,
    created: 0,
    skipped: 0,
    errors: 0,
    pointsCredited: 0,
    outcomes: [],
  };

  await withTransaction(async (client) => {
    for (const row of rows) {
      try {
        const outcome = await upsertOne(client, row, opts);
        summary.outcomes.push(outcome);
        if (outcome.status === "matched") summary.matched++;
        if (outcome.status === "created") summary.created++;
        if (outcome.status === "skipped") summary.skipped++;
        if (outcome.status === "error") summary.errors++;
        if (outcome.ledger_id && row.balance != null) summary.pointsCredited += row.balance;
      } catch (err) {
        summary.errors++;
        summary.outcomes.push({
          rowIndex: row.rowIndex,
          status: "error",
          message: (err as Error).message ?? "unknown",
          identity: identityLabel(row),
        });
      }
    }
  });
  return summary;
}

function identityLabel(r: ParsedRow): string {
  if (r.email) return r.email;
  if (r.phone) return r.phone;
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || `row ${r.rowIndex}`;
}

async function upsertOne(
  client: PoolClient,
  row: ParsedRow,
  opts: { creditBalance: boolean; sourceTag: string },
): Promise<RowOutcome> {
  if (!row.email && !row.phone) {
    return {
      rowIndex: row.rowIndex,
      status: "skipped",
      message: "no email or phone — can't dedupe",
      identity: identityLabel(row),
    };
  }

  // Strict match (email AND phone) → fall back to either.
  let matchId: number | null = null;
  if (row.email && row.phone) {
    const r = await client.query<{ id: number }>(
      `SELECT id FROM pos_customers
        WHERE LOWER(email) = $1
          AND (regexp_replace(COALESCE(mobile_phone,''), '[^0-9]', '', 'g') = $2
               OR regexp_replace(COALESCE(phone,''),        '[^0-9]', '', 'g') = $2)
        LIMIT 1`,
      [row.email, row.phone],
    );
    matchId = r.rows[0]?.id ?? null;
  }
  if (!matchId && row.email) {
    const r = await client.query<{ id: number }>(
      `SELECT id FROM pos_customers WHERE LOWER(email) = $1 LIMIT 1`,
      [row.email],
    );
    matchId = r.rows[0]?.id ?? null;
  }
  if (!matchId && row.phone) {
    const r = await client.query<{ id: number }>(
      `SELECT id FROM pos_customers
        WHERE regexp_replace(COALESCE(mobile_phone,''), '[^0-9]', '', 'g') = $1
           OR regexp_replace(COALESCE(phone,''),        '[^0-9]', '', 'g') = $1
        LIMIT 1`,
      [row.phone],
    );
    matchId = r.rows[0]?.id ?? null;
  }

  let customerId: number;
  let status: "matched" | "created";
  if (matchId) {
    customerId = matchId;
    status = "matched";
    // Backfill blank fields without overwriting existing data.
    await client.query(
      `UPDATE pos_customers
          SET first_name = COALESCE(first_name, $1),
              last_name  = COALESCE(last_name,  $2),
              email      = COALESCE(email,      $3),
              mobile_phone = COALESCE(mobile_phone, $4),
              birthday   = COALESCE(birthday,   $5::date)
        WHERE id = $6`,
      [
        row.first_name,
        row.last_name,
        row.email,
        row.phone,
        row.birthday,
        customerId,
      ],
    );
  } else {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO pos_customers
         (first_name, last_name, email, mobile_phone, birthday, created_at)
       VALUES ($1, $2, $3, $4, $5::date, now())
       RETURNING id`,
      [row.first_name, row.last_name, row.email, row.phone, row.birthday],
    );
    customerId = ins.rows[0].id;
    status = "created";
  }

  let ledgerId: number | undefined;
  if (opts.creditBalance && row.balance != null && row.balance > 0) {
    const refKey = row.external_ref || row.email || row.phone || `row${row.rowIndex}`;
    const led = await insertLedger(client, {
      customer_id: customerId,
      shopify_gid: null,
      delta_points: row.balance,
      reason: "migration",
      source: "admin",
      source_ref: `csv:${opts.sourceTag}:${refKey}`,
      amount_basis: null,
    });
    ledgerId = led.id;
  }

  return {
    rowIndex: row.rowIndex,
    status,
    pos_customer_id: customerId,
    ledger_id: ledgerId,
    identity: identityLabel(row),
  };
}
