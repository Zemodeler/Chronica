import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import { createDatabase, markChronicleRead, schema } from "@chronica/db";
import { isAuthenticationConfigured, getAuthentication } from "../../../../../../lib/authentication";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// POST /api/games/[gameId]/chronicle/read  — mark the news turn as read
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

    await markChronicleRead(db, gameId, player.id);
    return Response.json({ ok: true });
  } finally {
    await close();
  }
}
