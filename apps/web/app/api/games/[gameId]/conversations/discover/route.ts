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
      // With the ladder: what it would take is the whole point of refusing
      // (slice 10), and this route used to drop it, so the tray never showed it.
      return Response.json({ status: "unavailable", explanation: result.explanation, ladder: "ladder" in result ? result.ladder ?? [] : [] });
    }
    if (result.status === "choice") return Response.json(result);
    // Out of the player's region: found, and written to rather than spoken with.
    if (result.status === "letter") return Response.json({ status: "letter", characterId: result.characterId, knownName: result.knownName });
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
