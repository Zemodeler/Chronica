import { followTheThread } from "../../../../../lib/simulation-service";

/** Follow a thread of history, or stop following it: `{ storylineId, followed }`. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = (await request.json().catch(() => null)) as { storylineId?: unknown; followed?: unknown } | null;
  const storylineId = typeof body?.storylineId === "string" && ID.test(body.storylineId) ? body.storylineId : null;
  if (storylineId === null || typeof body?.followed !== "boolean") return Response.json({ error: "Name a thread, and whether to follow it." }, { status: 400 });
  const done = await followTheThread(gameId, storylineId, body.followed);
  if (!done) return Response.json({ error: "You are not playing in this game." }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}

const ID = /^[A-Za-z0-9_:.-]{1,120}$/;
