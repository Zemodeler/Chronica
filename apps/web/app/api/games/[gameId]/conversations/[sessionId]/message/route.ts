import { getSession } from "@chronica/db";
import { SendChatMessageRequestSchema } from "@chronica/shared";
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

  const { db, close, userId, playerId, characterId, characterName, period, currentStep, continuityTier, worldCharacters } = ctx;
  try {
    const session = await getSession(db, sessionId, playerId);
    if (session === undefined) return Response.json({ error: "Session not found." }, { status: 404 });
    if (session.isClosed) return Response.json({ error: "This conversation is closed." }, { status: 409 });
    if (session.npcCharacterId === null && !session.isGroup) {
      return Response.json({ error: "Session has no NPC assigned." }, { status: 409 });
    }

    if (session.isGroup) {
      // Group chat: generate replies from each participant sequentially
      const results = [];
      for (const npcCharacterId of session.participantIds) {
        const result = await generateDialogueReply({
          db, userId, gameId, playerId, playerCharacterId: characterId, playerCharacterName: characterName,
          npcCharacterId, sessionId, channel: session.channel, playerMessageBody: parsed.data.body,
          period, currentStep, continuityTier, worldCharacters,
        });
        results.push(result);
      }
      return Response.json({ playerMessage: results[0]?.playerMessage ?? null, npcReplies: results.map((r) => r.npcReply).filter(Boolean) });
    }

    const result = await generateDialogueReply({
      db, userId, gameId, playerId, playerCharacterId: characterId, playerCharacterName: characterName,
      npcCharacterId: session.npcCharacterId!,
      sessionId, channel: session.channel, playerMessageBody: parsed.data.body,
      period, currentStep, continuityTier, worldCharacters,
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
