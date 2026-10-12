import { appendMessage, findOrOpenSession, listSessionMessages, touchSession, type ChronicaDatabase } from "@chronica/db";

/**
 * Opens (or reuses) the 1:1 session for a character who flagged, this turn,
 * that they want to talk -- and seeds their own opening line as the first
 * message, so the player lands in a conversation the character actually
 * started rather than a blank thread. Idempotent: a repeat call against a
 * session that already has messages does not reseed it, so clicking the
 * affordance twice never duplicates the opening line.
 */
export async function openInitiatedDialogue(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
  npcCharacterId: string,
  openingLine: string,
): Promise<{ sessionId: string }> {
  const session = await findOrOpenSession(db, gameId, playerId, npcCharacterId, "messenger");
  const existing = await listSessionMessages(db, session.id, 1);
  if (existing.length === 0) {
    await appendMessage(db, session.id, npcCharacterId, false, openingLine);
  }
  await touchSession(db, session.id);
  return { sessionId: session.id };
}
