import { actAtPeaceTable, readPeaceTableAction } from "../../../../../lib/peace-table-service";

/** An act at the peace table: talks proposed, terms put, an offer taken, demands accepted, a bribe, or leaving. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const action = readPeaceTableAction(await request.json().catch(() => null));
  if (typeof action === "string") return Response.json({ error: action }, { status: 400 });
  const outcome = await actAtPeaceTable(gameId, action);
  if (outcome.status === "error") return Response.json({ error: outcome.message }, { status: outcome.code });
  return Response.json({ answer: outcome.answer, words: outcome.words }, { headers: { "Cache-Control": "private, no-store" } });
}
