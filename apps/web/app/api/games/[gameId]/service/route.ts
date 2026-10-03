import { setConduct, type Conduct } from "../../../../../lib/conduct-service";

const CONDUCTS: readonly Conduct[] = ["steady", "glory", "cautious"];

/** How the player, serving in an army's ranks, means to bear himself in the next battle. */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body: unknown = await request.json().catch(() => null);
  const conduct = typeof body === "object" && body !== null ? (body as Record<string, unknown>).conduct : undefined;
  if (typeof conduct !== "string" || !CONDUCTS.includes(conduct as Conduct)) {
    return Response.json({ error: "Say how you mean to bear yourself: steady, glory or cautious." }, { status: 400 });
  }
  const outcome = await setConduct(gameId, conduct as Conduct);
  if (outcome.status === "error") return Response.json({ error: outcome.message }, { status: outcome.code });
  return Response.json({ conduct: outcome.conduct }, { headers: { "Cache-Control": "private, no-store" } });
}
