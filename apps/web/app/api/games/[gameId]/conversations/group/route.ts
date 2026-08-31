import { createDialogueGroup, resolveDialogueContext } from "../../../../../../lib/dialogue-service";

export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = await request.json().catch(() => null) as { participantIds?: unknown } | null;
  const participantIds = Array.isArray(body?.participantIds) && body.participantIds.every((id) => typeof id === "string") ? body.participantIds : null;
  if (!participantIds) return Response.json({ error: "Invalid group participants." }, { status: 400 });
  const ctx = await resolveDialogueContext(gameId);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const group = await createDialogueGroup(ctx.db, gameId, ctx.playerId, participantIds);
    return Response.json({ sessionId: group.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create group." }, { status: 400 });
  } finally { await ctx.close(); }
}
