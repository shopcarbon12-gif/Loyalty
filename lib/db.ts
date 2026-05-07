import { Pool, PoolClient } from "pg";

let _pool: Pool | null = null;

/**
 * Single shared pg pool. Same Postgres as Carbon-POS and CarbonWMS — we
 * point at the internal Coolify hostname in production
 * (postgresql-database-iogw84scwo0owsco8c8wg4s0:5432) and at the public
 * 178.156.136.112:2040 mapping during laptop dev.
 */
export function getPool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  _pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return _pool;
}

/**
 * Run `fn` inside a BEGIN/COMMIT transaction; ROLLBACK + rethrow on failure.
 * Mirrors Carbon-POS's helper of the same name so the call sites read the
 * same.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  } finally {
    client.release();
  }
}
