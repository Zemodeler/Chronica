/**
 * Provision (or repair) the local administrator account used to sign in as
 * "Zemodeler". This script never prints the password or its hash.
 *
 * Usage:
 *   DATABASE_URL=<your-url> node scripts/check-zemodeler-account.mjs
 */

import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "@better-auth/utils/password";
import postgres from "postgres";

const USERNAME = "zemodeler";
const DISPLAY_NAME = "Zemodeler";
const EMAIL = "andrei.dodu@icloud.com";
const PASSWORD = "Andre2st";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required. No account changes were made.");
  process.exit(1);
}

const sql = postgres(databaseUrl);

try {
  const passwordHash = await hashPassword(PASSWORD);
  const result = await sql.begin(async (transaction) => {
    // The username is how Chronica's credential login finds the account. The
    // email check retains the original bootstrap identity if it already exists.
    const matches = await transaction`
      SELECT id, username, email
      FROM users
      WHERE lower(username) = ${USERNAME} OR lower(email) = ${EMAIL}
      FOR UPDATE
    `;

    const ids = [...new Set(matches.map((row) => row.id))];
    if (ids.length > 1) {
      throw new Error("The Zemodeler username and bootstrap email belong to different accounts; resolve the duplicate manually before running this script.");
    }

    const userId = ids[0] ?? randomUUID();
    const created = ids.length === 0;
    if (created) {
      await transaction`
        INSERT INTO users (id, display_name, email, email_verified, email_verified_at, username, role, avatar_key)
        VALUES (${userId}, ${DISPLAY_NAME}, ${EMAIL}, true, now(), ${USERNAME}, 'admin', 'laurel')
      `;
    } else {
      await transaction`
        UPDATE users
        SET display_name = ${DISPLAY_NAME}, username = ${USERNAME}, role = 'admin', updated_at = now()
        WHERE id = ${userId}
      `;
    }

    const accounts = await transaction`
      SELECT id
      FROM auth_accounts
      WHERE user_id = ${userId} AND provider_id = 'credential' AND issuer = 'local:credential'
      FOR UPDATE
    `;
    if (accounts.length > 1) throw new Error("More than one local credential account exists for Zemodeler.");

    if (accounts.length === 0) {
      await transaction`
        INSERT INTO auth_accounts (id, account_id, provider_id, issuer, user_id, password)
        VALUES (${randomUUID()}, ${userId}, 'credential', 'local:credential', ${userId}, ${passwordHash})
      `;
    } else {
      await transaction`
        UPDATE auth_accounts
        SET password = ${passwordHash}, updated_at = now()
        WHERE id = ${accounts[0].id}
      `;
    }

    const [verification] = await transaction`
      SELECT u.username, u.role, a.password
      FROM users u
      JOIN auth_accounts a ON a.user_id = u.id
      WHERE u.id = ${userId}
        AND a.provider_id = 'credential'
        AND a.issuer = 'local:credential'
    `;
    if (!verification || verification.username !== USERNAME || verification.role !== "admin" || !verification.password || !await verifyPassword(verification.password, PASSWORD)) {
      throw new Error("Account verification failed; the transaction was rolled back.");
    }
    return { created };
  });

  console.log(`Zemodeler administrator account ${result.created ? "created" : "updated"} and its credential login was verified.`);
} finally {
  await sql.end();
}
