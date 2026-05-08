import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { parseCsv, importRows, type ImportSummary, type ParsedRow } from "@/lib/csv-import";

export const dynamic = "force-dynamic";

/**
 * Admin → Customers → Import — bulk customer ingest from CSV. The
 * cutover lever for migrating off Kangaroo: paste the export, hit
 * Preview, hit Import. Idempotent — re-running with the same file
 * is safe (matches existing rows; the unique (source, source_ref)
 * index keeps balance migration rows from double-crediting).
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const sp = await searchParams;
  const cookieJar = await cookies();
  const summaryBlob = cookieJar.get("loyalty_import_summary")?.value;
  const lastSummary: ImportSummary | null = summaryBlob ? JSON.parse(summaryBlob) : null;
  const previewBlob = cookieJar.get("loyalty_import_preview")?.value;
  const preview = previewBlob ? JSON.parse(previewBlob) : null;

  async function previewAction(formData: FormData): Promise<void> {
    "use server";
    const text = String(formData.get("csv_text") ?? "").trim();
    const tag = String(formData.get("source_tag") ?? "import").trim().slice(0, 32) || "import";
    const credit = formData.get("credit_balance") === "on";
    const c = await cookies();
    if (!text) {
      c.delete("loyalty_import_preview");
      revalidatePath("/admin/customers/import");
      return;
    }
    const { rows, errors } = parseCsv(text);
    c.set(
      "loyalty_import_preview",
      JSON.stringify({
        errors,
        rowCount: rows.length,
        sample: rows.slice(0, 10),
        text,
        tag,
        credit,
      }),
      { httpOnly: true, path: "/admin/customers/import", maxAge: 60 * 10 },
    );
    revalidatePath("/admin/customers/import");
  }

  async function commitAction(): Promise<void> {
    "use server";
    const c = await cookies();
    const blob = c.get("loyalty_import_preview")?.value;
    if (!blob) return;
    const p = JSON.parse(blob) as { text?: string; tag?: string; credit?: boolean };
    if (!p.text) return;
    const { rows } = parseCsv(p.text);
    const summary = await importRows(rows, {
      creditBalance: !!p.credit,
      sourceTag: p.tag ?? "import",
      createdVia: "admin",
      actedByUserId: null,
      createdAtLocationId: null,
    });
    c.delete("loyalty_import_preview");
    c.set("loyalty_import_summary", JSON.stringify(summary), {
      httpOnly: true,
      path: "/admin/customers/import",
      maxAge: 60 * 10,
    });
    revalidatePath("/admin/customers/import");
    redirect("/admin/customers/import?done=1");
  }

  async function clearAction(): Promise<void> {
    "use server";
    const c = await cookies();
    c.delete("loyalty_import_preview");
    c.delete("loyalty_import_summary");
    revalidatePath("/admin/customers/import");
    redirect("/admin/customers/import");
  }

  return (
    <AdminShell active="customers">
      <section className="p-8 max-w-5xl">
        <Link href="/admin/customers" className="text-sm text-[var(--carbon-muted)] hover:underline">
          ‹ Back to customers
        </Link>
        <h1 className="text-2xl font-bold mt-3 mb-3">Import customers from CSV</h1>
        <p className="text-sm text-[var(--carbon-muted)] mb-6">
          Paste any customer CSV (Shopify export, vendor list, event
          signup sheet, or any spreadsheet). Match by email + phone,
          then fall back to either alone. Re-running the same file is
          safe — matched rows update missing fields; the unique{" "}
          <code>(source, source_ref)</code> index on the ledger keeps
          balance migrations from double-crediting.
        </p>
        <p className="text-xs text-[var(--carbon-muted)] mb-6 italic">
          Customer-ops normally happens in WMS Members. This admin route
          stays for emergencies / break-glass.
        </p>

        <div className="carbon-card p-5 mb-4">
          <h2 className="text-base font-bold mb-2">Recognised columns</h2>
          <p className="text-sm">
            <code>first_name</code>, <code>last_name</code>, <code>email</code>,{" "}
            <code>phone</code> (or <code>mobile</code>), <code>birthday</code>{" "}
            (yyyy-mm-dd or mm/dd/yyyy), <code>balance</code> (current point
            balance — written as a single migration ledger row),{" "}
            <code>external_ref</code> (Kangaroo <code>user_uid</code> or
            similar — used as the idempotency key on the migration row).
          </p>
          <p className="text-xs text-[var(--carbon-muted)] mt-2">
            Aliases recognised: <code>firstname</code>, <code>lastname</code>,{" "}
            <code>mobile_phone</code>, <code>dob</code>,{" "}
            <code>user_balance</code>, <code>kangaroo_id</code>.
          </p>
        </div>

        {sp.done === "1" && lastSummary ? (
          <ResultBlock summary={lastSummary} clear={clearAction} />
        ) : null}

        {!preview ? (
          <form action={previewAction} className="carbon-card p-5 space-y-4">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
                Source tag
              </span>
              <input
                name="source_tag"
                defaultValue="import"
                maxLength={32}
                className="carbon-input"
                placeholder="shopify / vendor-list / event-signup / etc."
              />
              <span className="text-[11px] text-[var(--carbon-muted)]">
                Stamped onto the ledger source_ref so re-imports dedupe.
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
                CSV
              </span>
              <textarea
                name="csv_text"
                rows={14}
                required
                className="carbon-input font-mono text-xs"
                placeholder={`first_name,last_name,email,phone,birthday,balance,external_ref\nSarah,Chen,sarah.chen@example.com,3055550142,1992-06-14,450,11e696...`}
              />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="credit_balance" defaultChecked />
              <span className="text-sm">
                Credit the <code>balance</code> column as a migration ledger row per matched/created customer
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="submit" className="carbon-btn-primary">Preview</button>
            </div>
          </form>
        ) : (
          <PreviewBlock preview={preview} commit={commitAction} clear={clearAction} />
        )}
      </section>
    </AdminShell>
  );
}

function PreviewBlock({
  preview,
  commit,
  clear,
}: {
  preview: {
    errors: string[];
    rowCount: number;
    sample: ParsedRow[];
  };
  commit: () => Promise<void>;
  clear: () => Promise<void>;
}) {
  if (preview.errors?.length) {
    return (
      <div className="carbon-card p-5 mb-4">
        <h2 className="text-base font-bold mb-2 text-[var(--carbon-danger)]">Couldn&rsquo;t parse</h2>
        <ul className="text-sm list-disc list-inside">
          {preview.errors.map((e: string) => <li key={e}>{e}</li>)}
        </ul>
        <form action={clear} className="mt-3">
          <button className="carbon-btn-secondary">Try again</button>
        </form>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="carbon-card p-5">
        <h2 className="text-base font-bold mb-2">Preview · {preview.rowCount.toLocaleString()} rows</h2>
        <p className="text-xs text-[var(--carbon-muted)] mb-3">
          Showing first {preview.sample.length} rows. Hit Import to commit all{" "}
          {preview.rowCount.toLocaleString()}.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--carbon-surface-soft)] text-xs uppercase tracking-wider font-bold">
              <tr>
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">First</th>
                <th className="text-left px-3 py-2">Last</th>
                <th className="text-left px-3 py-2">Email</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Birthday</th>
                <th className="text-right px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--carbon-border-soft)]">
              {preview.sample.map((r) => (
                <tr key={r.rowIndex}>
                  <td className="px-3 py-2 text-[var(--carbon-muted)]">{r.rowIndex}</td>
                  <td className="px-3 py-2">{r.first_name ?? "—"}</td>
                  <td className="px-3 py-2">{r.last_name ?? "—"}</td>
                  <td className="px-3 py-2">{r.email ?? "—"}</td>
                  <td className="px-3 py-2">{r.phone ?? "—"}</td>
                  <td className="px-3 py-2">{r.birthday ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">
                    {r.balance ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <form action={clear}>
          <button className="carbon-btn-secondary" type="submit">Cancel</button>
        </form>
        <form action={commit}>
          <button className="carbon-btn-primary" type="submit">
            Import {preview.rowCount.toLocaleString()} rows
          </button>
        </form>
      </div>
    </div>
  );
}

function ResultBlock({
  summary,
  clear,
}: {
  summary: ImportSummary;
  clear: () => Promise<void>;
}) {
  const issues = summary.outcomes.filter((o) => o.status === "error" || o.status === "skipped");
  return (
    <div className="carbon-card p-5 mb-4 border-l-4 border-[var(--carbon-success)]">
      <h2 className="text-base font-bold mb-2">Import complete</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
        <Stat label="Rows" value={summary.total.toLocaleString()} />
        <Stat label="Matched" value={summary.matched.toLocaleString()} />
        <Stat label="Created" value={summary.created.toLocaleString()} />
        <Stat label="Skipped" value={summary.skipped.toLocaleString()} />
        <Stat
          label="Errors"
          value={summary.errors.toLocaleString()}
          tone={summary.errors > 0 ? "bad" : undefined}
        />
      </div>
      <p className="text-sm mt-3">
        Points credited: <b>{summary.pointsCredited.toLocaleString()}</b>
      </p>
      {issues.length > 0 ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-bold">
            Issues ({issues.length})
          </summary>
          <ul className="text-xs mt-2 space-y-1">
            {issues.slice(0, 50).map((o) => (
              <li key={o.rowIndex}>
                <b>row {o.rowIndex}</b> · {o.identity ?? "—"} · {o.status} ·{" "}
                {o.message ?? ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <form action={clear} className="mt-4">
        <button className="carbon-btn-secondary" type="submit">Import another file</button>
      </form>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="border border-[var(--carbon-border-soft)] p-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--carbon-muted)]">
        {label}
      </p>
      <p
        className={`text-xl font-bold tabular-nums mt-1 ${
          tone === "bad" ? "text-[var(--carbon-danger)]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
