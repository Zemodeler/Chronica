import { headers } from "next/headers";
import { createDatabase, getCommitmentSafetyNetFiringRate } from "@chronica/db";
import { resolveAccount } from "../../../../lib/account-service";

// Cross-game rollup of the same metric ([gameId]/route.ts's per-game view) --
// the aggregate evidence `commitment-safety-net.ts`'s removal criterion asks
// for. Developer/admin-only; never linked from ordinary player UI.

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function developer() {
  const account = await resolveAccount(await headers());
  return account && (account.role === "developer" || account.role === "admin") ? account : null;
}

export async function GET() {
  if (!await developer()) return Response.json({ error: "Forbidden." }, { status: 403 });

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const rate = await getCommitmentSafetyNetFiringRate(db);
    return Response.json(rate, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
