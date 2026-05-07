/**
 * Local-dev migration runner. Same as scripts/docker-migrate.mjs but
 * invocable as `npm run db:migrate` for laptop dev.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (.env.local)");
  process.exit(2);
}
const pool = new Pool({ connectionString: url });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_schema_migrations (
      filename   TEXT PRIMARY KEY,
      sha256     TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const dir = join(process.cwd(), "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await readFile(join(dir, f), "utf8");
    const sha = createHash("sha256").update(sql).digest("hex");
    const r = await pool.query<{ sha256: string }>(
      `SELECT sha256 FROM loyalty_schema_migrations WHERE filename = $1`,
      [f],
    );
    if (r.rows[0]?.sha256 === sha) {
      console.log(`✓ ${f} (already applied)`);
      continue;
    }
    console.log(`→ applying ${f}…`);
    await pool.query(sql);
    await pool.query(
      `INSERT INTO loyalty_schema_migrations (filename, sha256)
       VALUES ($1, $2)
       ON CONFLICT (filename) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = now()`,
      [f, sha],
    );
    console.log(`✓ ${f}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
