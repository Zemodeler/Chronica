import { getBurstStatus } from "../../../../../../lib/simulation-service";

/** Where a burst has got to. The page polls this with `?after=<id>` until the status is no longer `running`. */
export async function GET(request: Request, { params }: { params: Promise<{ gameId: string; burstId: string }> }) {
  const { gameId, burstId } = await params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  const status = await getBurstStatus(gameId, burstId, Number.isFinite(after) && after > 0 ? Math.floor(after) : 0);
  if (status === null) return Response.json({ error: "No such burst." }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "private, no-store" } });
}
