import { getOrdersUnderWay } from "../../../../../lib/under-way-service";

/**
 * What the player's orders are doing: their projects, their armies on the
 * march, and what their orders set them to. Station-filtered, in words.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const items = await getOrdersUnderWay(gameId);
  return Response.json({ items: items ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
}
