import { DiscoverContactRequestSchema } from "@chronica/shared";
import { discoverContact, InsufficientCoinsError, resolveDialogueContext } from "../../../../../../lib/dialogue-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const ctx = await resolveDialogueContext(gameId);
  if (ctx === null) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = DiscoverContactRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request body." }, { status: 400 });

  const { db, close, userId, playerId, characterId, characterName, locationProvinceId, roleLabel, period } = ctx;
  try {
    const result = await discoverContact({
      db, userId, gameId, playerId, playerCharacterId: characterId, playerCharacterName: characterName,
      playerLocationProvinceId: locationProvinceId, playerRoleLabel: roleLabel, period,
      query: parsed.data.query, ...(parsed.data.characterId === undefined ? {} : { characterId: parsed.data.characterId }),
    });

    if (result.status === "unavailable") {
      return Response.json({ status: "unavailable", explanation: result.explanation });
    }
    if (result.status === "choice") return Response.json(result);
    return Response.json({ status: "found", sessionId: result.sessionId, knownName: result.knownName });
  } catch (error) {
    if (error instanceof InsufficientCoinsError) {
      return Response.json({ error: "Insufficient coins." }, { status: 402 });
    }
    throw error;
  } finally {
    await close();
  }
}
