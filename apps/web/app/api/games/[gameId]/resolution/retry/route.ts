import { headers } from "next/headers";
import { after } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { createDatabase, retryFailedTurn, schema } from "@chronica/db";
import { isAuthenticationConfigured, getAuthentication } from "../../../../../../lib/authentication";
import { dispatchQueuedTurn } from "../../../../../../lib/resolution/dispatch";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// POST /api/games/[gameId]/resolution/retry — give a permanently failed turn
// another MAX_TURN_RESOLVE_ATTEMPTS. The player's already-submitted orders
// are untouched (they live in `orders`, keyed by this same turn id), so
// requeuing is enough; nothing here re-collects or re-validates them.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;

  if (!isAuthenticationConfigured()) return Response.json({ error: "Auth not configured." }, { status: 503 });
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  if (!userId) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [player] = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
      .limit(1);
    if (!player) return Response.json({ error: "Unauthorized." }, { status: 401 });

    const [latestTurn] = await db
      .select({ id: schema.turns.id, status: schema.turns.status })
      .from(schema.turns)
      .where(eq(schema.turns.gameId, gameId))
      .orderBy(desc(schema.turns.index))
      .limit(1);
    if (!latestTurn || latestTurn.status !== "failed") {
      return Response.json({ error: "There is no failed turn to retry." }, { status: 409 });
    }

    const retried = await retryFailedTurn(db, latestTurn.id);
    if (!retried) return Response.json({ error: "There is no failed turn to retry." }, { status: 409 });

    after(async () => {
      try { await dispatchQueuedTurn(gameId); }
      catch (error) { console.error("[resolution-dispatch] retried turn failed", error); }
    });
    return Response.json({ retried: true });
  } finally {
    await close();
  }
}
