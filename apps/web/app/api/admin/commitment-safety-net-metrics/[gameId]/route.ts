import { headers } from "next/headers";
import { createDatabase, getCommitmentSafetyNetFiringRate } from "@chronica/db";
import { resolveAccount } from "../../../../../lib/account-service";

// Developer/admin-only diagnostics (docs/30, docs/31): how often
// `commitment-safety-net.ts` actually fired for this campaign. Its own
// removal criterion asks for shadow-turn or production evidence, not a
// code-reading audit -- this is that evidence, read from the per-turn
// `workflow_audit` every turn already carries. Never linked from ordinary
// player UI.

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function developer() {
  const account = await resolveAccount(await headers());
  return account && (account.role === "developer" || account.role === "admin") ? account : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  if (!await developer()) return Response.json({ error: "Forbidden." }, { status: 403 });
  const { gameId } = await params;

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const rate = await getCommitmentSafetyNetFiringRate(db, gameId);
    return Response.json({ gameId, ...rate }, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
