import type { CharacterKnowledgebase } from "@chronica/shared";
import { and, eq } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { characterKnowledgebases } from "../schema/character";

export async function upsertCharacterKnowledgebase(
  db: ChronicaDatabase,
  input: Readonly<{
    gameId: string;
    playerId: string;
    characterId: string;
    knowledgebase: CharacterKnowledgebase;
  }>,
): Promise<void> {
  await db
    .insert(characterKnowledgebases)
    .values({
      gameId: input.gameId,
      playerId: input.playerId,
      characterId: input.characterId,
      knowledgebase: input.knowledgebase,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [characterKnowledgebases.gameId, characterKnowledgebases.playerId],
      set: {
        knowledgebase: input.knowledgebase,
        updatedAt: new Date(),
      },
    });
}

export async function getCharacterKnowledgebase(
  db: ChronicaDatabase,
  gameId: string,
  playerId: string,
): Promise<CharacterKnowledgebase | null> {
  const [row] = await db
    .select({ knowledgebase: characterKnowledgebases.knowledgebase })
    .from(characterKnowledgebases)
    .where(
      and(
        eq(characterKnowledgebases.gameId, gameId),
        eq(characterKnowledgebases.playerId, playerId),
      ),
    )
    .limit(1);
  return row?.knowledgebase ?? null;
}
