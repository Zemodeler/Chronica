/**
 * One-time admin utility — check if the Zemodeler account exists and reset its password.
 *
 * Usage (run once, do not commit the password):
 *   DATABASE_URL=<your-url> BETTER_AUTH_SECRET=<secret> node scripts/check-zemodeler-account.mjs
 *
 * Requires: bcryptjs (install temporarily: npm install -g bcryptjs)
 * or use the bcrypt hash approach below with node:crypto.
 */

import postgres from "postgres";
import { createHash } from "node:crypto";

const ZEMODELER_EMAIL = "andrei.dodu@icloud.com";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required."); process.exit(1); }

const sql = postgres(url);

const [row] = await sql`
  SELECT u.id, u.email, u.display_name, u.username, u.role, u.email_verified
  FROM users u
  WHERE u.email = ${ZEMODELER_EMAIL}
  LIMIT 1
`;

if (!row) {
  console.log("Zemodeler account does NOT exist.");
  await sql.end();
  process.exit(0);
}

console.log("Zemodeler account found:");
console.log(JSON.stringify(row, null, 2));

// To reset the password, update the auth_accounts table's password column.
// better-auth stores bcrypt hashes. Use better-auth's admin API or hash manually.
//
// Example (requires bcrypt):
//   import bcrypt from "bcryptjs";
//   const hash = await bcrypt.hash("Andre2st", 10);
//   await sql`UPDATE auth_accounts SET password = ${hash} WHERE account_id = ${row.id} AND provider_id = 'credential'`;
//
// Or call the better-auth admin endpoint if it's configured.

console.log("\nTo reset the password, run the UPDATE query shown above with a bcrypt hash of 'Andre2st'.");
await sql.end();
