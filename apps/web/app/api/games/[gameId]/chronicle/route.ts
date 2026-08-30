import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { createDatabase, getChronicleForLatestTurn, schema } from "@chronica/db";
import { isAuthenticationConfigured, getAuthentication } from "../../../../../lib/authentication";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// GET /api/games/[gameId]/chronicle  — chronicle entries for the latest turn
export async function GET(
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

    const chronicle = await getChronicleForLatestTurn(db, gameId);
    if (!chronicle) return Response.json({ error: "Game not found." }, { status: 404 });

    return Response.json(chronicle, { headers: { "Cache-Control": "private, no-store" } });
  } finally {
    await close();
  }
}
