import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import type { SessionPayload } from "@/lib/session";

/**
 * Verify a sign-in attempt against the `rewards_employees` table that
 * WMS manages (migration 0079_rewards_access.sql). The rules:
 *   - users row exists, lookup case-insensitive on email
 *   - rewards_employees row exists for the user (i.e. credentials
 *     provisioned for this app)
 *   - is_active = true (toggle in WMS soft-disables without deleting)
 *   - rewards_password_hash is set
 *   - bcrypt verifies the submitted password
 *
 * Returns the SessionPayload to sign on success, null on any failure.
 * We deliberately don't differentiate failure reasons — the login page
 * shows a single generic "Email or password didn't match" so a wrong
 * email can't be distinguished from a wrong password.
 */
export async function findRewardsUserForLogin(
  pool: Pool,
  email: string,
  password: string,
): Promise<SessionPayload | null> {
  const r = await pool.query<{
    user_id: string;
    email: string;
    password_hash: string | null;
    is_active: boolean;
    role_name: string | null;
  }>(
    `SELECT u.id::text                  AS user_id,
            u.email                     AS email,
            re.rewards_password_hash    AS password_hash,
            re.is_active                AS is_active,
            ur.name                     AS role_name
       FROM users u
       INNER JOIN rewards_employees re ON re.user_id = u.id
       LEFT JOIN user_roles ur          ON ur.id = re.rewards_role_id
                                       AND ur.scope = 'rewards'
      WHERE lower(u.email) = lower($1)
      LIMIT 1`,
    [email],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (!row.is_active) return null;
  if (!row.password_hash) return null;
  let ok = false;
  try {
    ok = await bcrypt.compare(password, row.password_hash);
  } catch {
    return null;
  }
  if (!ok) return null;
  return {
    sub: row.user_id,
    email: row.email,
    role: row.role_name?.trim() || "member",
  };
}
