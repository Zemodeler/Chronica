import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { ChronicaDatabase } from "./database";
import { authAccounts, authSessions, authVerifications, users } from "./schema/auth";

export function createBetterAuthDatabaseAdapter(db: ChronicaDatabase) {
  return drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  });
}
