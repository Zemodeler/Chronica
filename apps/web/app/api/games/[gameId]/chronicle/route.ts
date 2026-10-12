import { getChroniclePage } from "../../../../../lib/simulation-service";

/**
 * The record before a place in it: `?before=<orderKey>&limit=<n>`, oldest
 * first, with `older` naming where the page before this one starts (null at
 * the first entry of the reign). The view (`/simulate`) carries the newest
 * page; this is how the reader turns back past it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const search = new URL(request.url).searchParams;
  const before = search.get("before");
  if (before === null || before.length === 0) return Response.json({ error: "Say where in the record to read back from." }, { status: 400 });
  const limit = Number(search.get("limit") ?? "200");
  const page = await getChroniclePage(gameId, before, Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200);
  if (page.status === "not-found") return Response.json({ error: "You are not playing in this game." }, { status: 404 });
  if (page.status === "bad-cursor") return Response.json({ error: "That is not a place in the record." }, { status: 400 });
  return Response.json({ entries: page.entries, older: page.older }, { headers: { "Cache-Control": "private, no-store" } });
}
