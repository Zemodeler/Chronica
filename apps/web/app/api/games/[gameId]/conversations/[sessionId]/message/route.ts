import { appendMessage, getSession } from "@chronica/db";
import { SendChatMessageRequestSchema, inTheSameRegion } from "@chronica/shared";
import { generateDialogueReply, InsufficientCoinsError, resolveDialogueContext } from "../../../../../../../lib/dialogue-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string; sessionId: string }> },
) {
  const { gameId, sessionId } = await params;
  const ctx = await resolveDialogueContext(gameId);
  if (ctx === null) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = SendChatMessageRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request body." }, { status: 400 });

  const { db, close, userId, playerId, characterId, characterName, playerKnowledgebase, locationProvinceId, period, currentStep, continuityTier, worldCharacters, characterPressures, characterBeliefs } = ctx;
  // Speech carries only as far as the room. Anybody out of the player's region
  // is written to instead, and answers when the world next moves.
  const here = (npcCharacterId: string): boolean => {
    const npc = worldCharacters.find((character) => character.id === npcCharacterId);
    return npc !== undefined && inTheSameRegion(npc, { locationProvinceId });
  };
  const nameOf = (npcCharacterId: string): string => worldCharacters.find((character) => character.id === npcCharacterId)?.name ?? "They";
  try {
    const session = await getSession(db, sessionId, playerId);
    if (session === undefined) return Response.json({ error: "Session not found." }, { status: 404 });
    if (session.isClosed) return Response.json({ error: "This conversation is closed." }, { status: 409 });
    if (session.npcCharacterId === null && !session.isGroup) {
      return Response.json({ error: "Session has no NPC assigned." }, { status: 409 });
    }

    if (session.isGroup) {
      // Those who have left the region are not in the room to answer.
      const present = session.participantIds.filter(here);
      if (present.length === 0) {
        return Response.json({ error: "Nobody in this gathering is here any longer. Write to them instead.", byLetter: true }, { status: 409 });
      }
      const playerMessage = await appendMessage(db, sessionId, characterId, true, parsed.data.body);
      // Replies share one persisted player input and are generated in participant order.
      const results = [];
      for (const npcCharacterId of present) {
        const result = await generateDialogueReply({
          db, userId, gameId, playerId, playerCharacterId: characterId, playerCharacterName: characterName, playerKnowledgebase,
          npcCharacterId, sessionId, channel: session.channel, playerMessageBody: parsed.data.body,
          period, currentStep, continuityTier, worldCharacters, characterPressures, characterBeliefs, appendPlayerMessage: false,
        });
        results.push(result);
      }
      return Response.json({ playerMessage, npcReplies: results.map((r) => r.npcReply).filter(Boolean) });
    }

    if (!here(session.npcCharacterId!)) {
      return Response.json({ error: `${nameOf(session.npcCharacterId!)} is not here. Write to them instead.`, byLetter: true }, { status: 409 });
    }
    const result = await generateDialogueReply({
      db, userId, gameId, playerId, playerCharacterId: characterId, playerCharacterName: characterName, playerKnowledgebase,
      npcCharacterId: session.npcCharacterId!,
      sessionId, channel: session.channel, playerMessageBody: parsed.data.body,
      period, currentStep, continuityTier, worldCharacters, characterPressures, characterBeliefs,
    });
    return Response.json({ playerMessage: result.playerMessage, npcReply: result.npcReply });
  } catch (error) {
    if (error instanceof InsufficientCoinsError) {
      return Response.json({ error: "Insufficient coins." }, { status: 402 });
    }
    throw error;
  } finally {
    await close();
  }
}
