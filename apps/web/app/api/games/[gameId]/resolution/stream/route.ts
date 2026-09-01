import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { createDatabase, schema } from "@chronica/db";
import { isAuthenticationConfigured, getAuthentication } from "../../../../../../lib/authentication";

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}

// Observation only. Resolution is dispatched by the server after order submission.
export async function GET(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  if (!isAuthenticationConfigured()) return new Response("Authentication not configured.", { status: 503 });
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  const userId = session?.user.id;
  if (!userId) return new Response("Unauthorized.", { status: 401 });

  const { db, close } = createDatabase(requiredDatabaseUrl());
  const encoder = new TextEncoder();
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const finish = async () => {
        if (closed) return;
        closed = true;
        if (interval !== undefined) clearInterval(interval);
        controller.close();
        await close();
      };
      const send = (data: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const poll = async () => {
        try {
          const [turn] = await db.select({ status: schema.turns.status }).from(schema.turns)
            .where(eq(schema.turns.gameId, gameId)).orderBy(desc(schema.turns.index)).limit(1);
          if (turn === undefined) { send({ error: "Game not found." }); await finish(); return; }
          if (turn.status === "failed") { send({ error: "Resolution failed." }); await finish(); return; }
          if (turn.status === "news" || turn.status === "resolved") {
            send({ step: "done", label: "Complete", done: true });
            await finish();
            return;
          }
          send({ step: turn.status, label: turn.status === "queued" ? "Resolution is queued on the server…" : "Resolving on the server…", done: false });
        } catch (error) {
          send({ error: String(error) });
          await finish();
        }
      };
      const [player] = await db.select({ id: schema.players.id }).from(schema.players)
        .where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active"))).limit(1);
      if (player === undefined) { send({ error: "Player not found." }); await finish(); return; }
      request.signal.addEventListener("abort", () => { void finish(); }, { once: true });
      await poll();
      if (!closed) interval = setInterval(() => { void poll(); }, 1_000);
    },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no",
  } });
}
