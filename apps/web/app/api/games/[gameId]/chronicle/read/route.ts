import { markTheRecordRead } from "../../../../../../lib/simulation-service";

/**
 * The player has opened the record.
 *
 * read_at has been on the checkpoint row since the table was written and
 * nothing ever wrote it, so the badge counted the length of the chronicle and
 * called it unopened -- a number that only went up. It matters more now that
 * the record sits behind a door: a badge is the only thing telling the player
 * there is something in there.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  // `{ ids }` marks those entries; no body marks the whole record.
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, 500) : undefined;
  const marked = await markTheRecordRead(gameId, ids);
  if (!marked) return Response.json({ error: "You are not playing in this game." }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
