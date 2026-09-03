import { headers } from "next/headers";
import { createDatabase, getWorldView } from "@chronica/db";
import { buildPoliticalInspectorView } from "@chronica/shared";
import { resolveAccount } from "../../../../../../lib/account-service";

// Developer/admin-only diagnostics (character-sim phase 4): every eligibility
// check, every recorded support position (public and private alike), group
// membership/influence, and legitimacy modifiers behind one political
// procedure. Never linked from ordinary player UI -- the player-facing
// account of the same procedure is the Chronicle's public politicalOutcome
// fact, which deliberately omits everything private this view exposes.

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

async function developer() {
  const account = await resolveAccount(await headers());
  return account && (account.role === "developer" || account.role === "admin") ? account : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string; procedureId: string }> }) {
  if (!await developer()) return Response.json({ error: "Forbidden." }, { status: 403 });
  const { gameId, procedureId } = await params;
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const worldView = await getWorldView(db, gameId);
    if (worldView === undefined) return Response.json({ error: "Game not found." }, { status: 404 });

    const view = buildPoliticalInspectorView(worldView.world, procedureId);
    if (view === undefined) return Response.json({ error: "Procedure not found." }, { status: 404 });

    return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
