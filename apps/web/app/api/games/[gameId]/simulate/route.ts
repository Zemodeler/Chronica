import { getGameView, submitOrder } from "../../../../../lib/simulation-service";

/** The order box: one natural-language instruction, one simulation burst. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const orderText = typeof body === "object" && body !== null && "orderText" in body ? String((body as { orderText: unknown }).orderText) : "";
  if (orderText.trim().length === 0) return Response.json({ error: "An order is required." }, { status: 400 });
  if (orderText.length > 2_000) return Response.json({ error: "That order is too long." }, { status: 400 });

  const result = await submitOrder(gameId, orderText.trim());
  if (result.status === "error") return Response.json({ error: result.message }, { status: 400 });
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const view = await getGameView(gameId);
  if (view === null) return Response.json({ error: "Unauthorized." }, { status: 401 });
  return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
}
