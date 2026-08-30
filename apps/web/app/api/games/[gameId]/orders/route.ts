import { headers } from "next/headers";
import { eq, and, desc } from "drizzle-orm";
import { createDatabase, submitPlayerOrder, schema } from "@chronica/db";
import { OrderBatchSchema } from "@chronica/shared";
import { isAuthenticationConfigured, getAuthentication } from "../../../../../lib/authentication";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// GET /api/games/[gameId]/orders  — current order for the open turn
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

    const [openTurn] = await db
      .select({ id: schema.turns.id, status: schema.turns.status })
      .from(schema.turns)
      .where(eq(schema.turns.gameId, gameId))
      .orderBy(desc(schema.turns.index))
      .limit(1);

    if (!openTurn) return Response.json({ order: null, turnStatus: null });

    const [order] = await db
      .select({ rawText: schema.orders.rawText, directives: schema.orders.directives })
      .from(schema.orders)
      .where(and(eq(schema.orders.turnId, openTurn.id), eq(schema.orders.playerId, player.id)))
      .limit(1);

    return Response.json(
      { turnId: openTurn.id, turnStatus: openTurn.status, order: order ?? null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } finally {
    await close();
  }
}

// POST /api/games/[gameId]/orders  — submit an order batch
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;

  if (!isAuthenticationConfigured()) return Response.json({ error: "Auth not configured." }, { status: 503 });
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  if (!userId) return Response.json({ error: "Unauthorized." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }

  const batchParse = OrderBatchSchema.safeParse(body);
  if (!batchParse.success) return Response.json({ error: batchParse.error.message }, { status: 422 });

  const batch = batchParse.data;
  const rawText = batch.directives
    .map((d) => ("text" in d ? d.text : `[cancel ${d.actionId}]`))
    .join("\n");

  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [player] = await db
      .select({ id: schema.players.id })
      .from(schema.players)
      .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active")))
      .limit(1);
    if (!player) return Response.json({ error: "Unauthorized." }, { status: 401 });

    const result = await submitPlayerOrder(db, { gameId, playerId: player.id, rawText, batch });
    if (!result.accepted) return Response.json({ error: result.reason ?? "Order rejected." }, { status: 409 });
    return Response.json({ accepted: true, enqueued: result.enqueued });
  } finally {
    await close();
  }
}
