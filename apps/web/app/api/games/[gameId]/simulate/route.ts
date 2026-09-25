import { TIME_SPANS, getGameView, startDetachedBurst } from "../../../../../lib/simulation-service";

/**
 * The order box: one natural-language instruction, one simulation burst.
 *
 * The burst does not run inside this request. The request checks the order,
 * opens the burst, and answers with its id at once; the burst carries on in
 * the server after the response has gone, and the page follows it at
 * `/bursts/<id>`. A tab closed is not a burst nobody can watch, and a turn is
 * no longer bounded by how long a connection may stay open.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const field = (key: string): unknown => (typeof body === "object" && body !== null && key in body ? (body as Record<string, unknown>)[key] : undefined);
  const orderText = typeof field("orderText") === "string" ? String(field("orderText")) : "";
  // Letting time pass is an order of its own, and the only one with no words.
  const waiting = field("wait") === true;
  if (!waiting && orderText.trim().length === 0) return Response.json({ error: "An order is required." }, { status: 400 });
  if (orderText.length > 2_000) return Response.json({ error: "That order is too long." }, { status: 400 });
  const requestedSpan = field("spanDays");
  const spanDays = typeof requestedSpan === "number" && (TIME_SPANS as readonly number[]).includes(requestedSpan) ? requestedSpan : undefined;
  if (waiting && spanDays === undefined) return Response.json({ error: "Say how long to wait." }, { status: 400 });

  const text = orderText.trim();
  const outcome = await startDetachedBurst(gameId, text.length === 0 ? null : text, { spanDays });
  if (outcome.status === "error") {
    const busy = outcome.message.startsWith("The world is already moving");
    return Response.json({ error: outcome.message }, { status: busy ? 409 : 400 });
  }
  return Response.json({ burstId: outcome.burstId }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const view = await getGameView(gameId);
  if (view === null) return Response.json({ error: "Unauthorized." }, { status: 401 });
  return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
