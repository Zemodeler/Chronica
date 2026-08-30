import { headers } from "next/headers";
import { eq, and } from "drizzle-orm";
import {
  createDatabase,
  getWorldView,
  getQueuedTurn,
  getOrdersForTurn,
  schema,
} from "@chronica/db";
import { createAiAdapter } from "@chronica/ai";
import { OrderBatchSchema } from "@chronica/shared";
import { isAuthenticationConfigured, getAuthentication } from "../../../../../../lib/authentication";
import { resolveTurn } from "../../../../../../lib/resolution/pipeline";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// GET /api/games/[gameId]/resolution/stream
// SSE endpoint. Subscribe then POST to /orders. Emits { step, label, done } events.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;

  if (!isAuthenticationConfigured()) {
    return new Response("Authentication not configured.", { status: 503 });
  }
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  if (!userId) return new Response("Unauthorized.", { status: 401 });

  const { db, close } = createDatabase(requiredDatabaseUrl());
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream already closed
        }
      }

      try {
        const [player] = await db
          .select({ id: schema.players.id, characterId: schema.players.characterId })
          .from(schema.players)
          .where(
            and(
              eq(schema.players.gameId, gameId),
              eq(schema.players.userId, userId),
              eq(schema.players.status, "active"),
            ),
          )
          .limit(1);

        if (!player) { send({ error: "Player not found." }); controller.close(); return; }

        const worldView = await getWorldView(db, gameId);
        if (!worldView) { send({ error: "Game not found." }); controller.close(); return; }

        const queuedTurn = await getQueuedTurn(db, gameId);
        if (!queuedTurn) { send({ error: "No queued turn to resolve." }); controller.close(); return; }

        const orderRows = await getOrdersForTurn(db, queuedTurn.id);
        const playerOrder = orderRows.find((o) => o.playerId === player.id);
        if (!playerOrder) { send({ error: "No orders found for this player." }); controller.close(); return; }

        const batchParse = OrderBatchSchema.safeParse(playerOrder.directives);
        if (!batchParse.success) { send({ error: "Invalid order batch." }); controller.close(); return; }

        const characterId = player.characterId ?? worldView.world.characters[0]?.id ?? "";
        const adapter = createAiAdapter();

        await resolveTurn(
          db,
          adapter,
          {
            gameId,
            turnId: queuedTurn.id,
            world: worldView.world,
            batch: batchParse.data,
            actorCharacterId: characterId,
            playerId: player.id,
          },
          (progress) => {
            send({ step: progress.step, label: progress.label, done: progress.done });
          },
        );

        send({ step: "done", label: "Complete", done: true });
      } catch (error) {
        send({ error: String(error) });
      } finally {
        controller.close();
        await close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
