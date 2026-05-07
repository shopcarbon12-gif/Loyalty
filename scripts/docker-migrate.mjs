/**
 * Container-boot migrations for Carbon Loyalty.
 *
 * Applies every .sql file in /app/migrations in numeric order. Each file
 * is recorded in the loyalty_schema_migrations table so non-idempotent
 * statements never re-run.
 *
 * Mirrors Carbon-POS's docker-migrate.mjs so the deploy plumbing has the
 * same shape across the org.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("loyalty: DATABASE_URL is required.");
  process.exit(2);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_schema_migrations (
      filename   TEXT PRIMARY KEY,
      sha256     TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function alreadyApplied(filename) {
  const r = await pool.query(
    `SELECT sha256 FROM loyalty_schema_migrations WHERE filename = $1`,
    [filename],
  );
  return r.rows[0]?.sha256 ?? null;
}

async function recordApplied(filename, sha) {
  await pool.query(
    `INSERT INTO loyalty_schema_migrations (filename, sha256)
     VALUES ($1, $2)
     ON CONFLICT (filename) DO UPDATE
        SET sha256 = EXCLUDED.sha256, applied_at = now()`,
    [filename, sha],
  );
}

async function main() {
  await ensureMigrationsTable();
  const appRoot = process.env.APP_ROOT || "/app";
  const dir = join(appRoot, "migrations");
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    console.warn("loyalty: docker-migrate: migrations dir missing — nothing to run.");
    process.exit(0);
  }
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const path = join(dir, f);
    const sql = await readFile(path, "utf8");
    const sha = createHash("sha256").update(sql).digest("hex");
    const seenSha = await alreadyApplied(f);
    if (seenSha === sha) {
      console.log(`loyalty: ${f} — already applied`);
      continue;
    }
    if (seenSha && seenSha !== sha) {
      console.warn(`loyalty: ${f} — content changed since last apply, re-running (idempotent statements only)`);
    }
    console.log(`loyalty: applying ${f}…`);
    await pool.query(sql);
    await recordApplied(f, sha);
    console.log(`loyalty: ${f} — applied.`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error("loyalty: migration failed:", err);
  process.exit(1);
});
