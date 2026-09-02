import { and, eq } from "drizzle-orm";
import type { CharacterSocialEvent, CharacterSocialEventDraft, CharacterProfile } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { characterProfiles, characterSocialEvents } from "../schema/character-social";

// ── Character profiles (dialogue-only descriptive projection) ──────────────

export async function getCharacterProfile(
  db: ChronicaDatabase,
  gameId: string,
  characterId: string,
): Promise<CharacterProfile | undefined> {
  const [row] = await db
    .select()
    .from(characterProfiles)
    .where(and(eq(characterProfiles.gameId, gameId), eq(characterProfiles.characterId, characterId)))
    .limit(1);
  if (row === undefined) return undefined;
  return {
    gameId: row.gameId,
    characterId: row.characterId,
    version: row.version,
    roleLabel: row.roleLabel,
    biography: row.biography,
    voiceSummary: row.voiceSummary,
    presentationDetails: row.presentationDetails,
    updatedAtStep: row.updatedAtStep,
  };
}

export async function listCharacterProfiles(db: ChronicaDatabase, gameId: string): Promise<readonly CharacterProfile[]> {
  const rows = await db.select().from(characterProfiles).where(eq(characterProfiles.gameId, gameId));
  return rows.map((row) => ({
    gameId: row.gameId,
    characterId: row.characterId,
    version: row.version,
    roleLabel: row.roleLabel,
    biography: row.biography,
    voiceSummary: row.voiceSummary,
    presentationDetails: row.presentationDetails,
    updatedAtStep: row.updatedAtStep,
  }));
}

/** Upserts by (gameId, characterId). Bumps `version` on every write after the first. */
export async function upsertCharacterProfile(db: ChronicaDatabase, profile: CharacterProfile): Promise<void> {
  await db
    .insert(characterProfiles)
    .values({
      gameId: profile.gameId,
      characterId: profile.characterId,
      version: profile.version,
      roleLabel: profile.roleLabel,
      biography: profile.biography,
      voiceSummary: profile.voiceSummary,
      presentationDetails: profile.presentationDetails,
      updatedAtStep: profile.updatedAtStep,
    })
    .onConflictDoUpdate({
      target: [characterProfiles.gameId, characterProfiles.characterId],
      set: {
        roleLabel: profile.roleLabel,
        biography: profile.biography,
        voiceSummary: profile.voiceSummary,
        presentationDetails: profile.presentationDetails,
        updatedAtStep: profile.updatedAtStep,
        version: profile.version,
        updatedAt: new Date(),
      },
    });
}

// ── Character social events (the chat/simulation boundary) ─────────────────

function toSocialEvent(row: typeof characterSocialEvents.$inferSelect): CharacterSocialEvent {
  return {
    id: row.id,
    gameId: row.gameId,
    sourceTurnId: row.sourceTurnId,
    sourceSessionId: row.sourceSessionId,
    sourceMessageId: row.sourceMessageId,
    participantCharacterIds: row.participantCharacterIds,
    kind: row.kind,
    visibility: row.visibility,
    knownByCharacterIds: row.knownByCharacterIds,
    relationCauses: row.relationCauses,
    knowledgeClaims: row.knowledgeClaims,
    commitmentProposal: row.commitmentProposal,
    introducedCharacter: row.introducedCharacter,
    introducedProfile: row.introducedProfile,
    createdAtStep: row.createdAtStep,
    appliedAtStep: row.appliedAtStep,
    appliedInTurnId: row.appliedInTurnId,
    status: row.status,
    rejectionReason: row.rejectionReason,
  };
}

/** Inserts a dialogue-proposed social event. The id must be pre-allocated by the caller (never during replay). */
export async function insertCharacterSocialEvent(
  db: ChronicaDatabase,
  id: string,
  gameId: string,
  draft: CharacterSocialEventDraft & {
    sourceTurnId?: string | null;
    sourceSessionId?: string | null;
    sourceMessageId?: string | null;
  },
): Promise<void> {
  await db.insert(characterSocialEvents).values({
    id,
    gameId,
    sourceTurnId: draft.sourceTurnId ?? null,
    sourceSessionId: draft.sourceSessionId ?? null,
    sourceMessageId: draft.sourceMessageId ?? null,
    participantCharacterIds: draft.participantCharacterIds,
    kind: draft.kind,
    visibility: draft.visibility,
    knownByCharacterIds: draft.knownByCharacterIds,
    relationCauses: draft.relationCauses,
    knowledgeClaims: draft.knowledgeClaims,
    commitmentProposal: draft.commitmentProposal,
    introducedCharacter: draft.introducedCharacter,
    introducedProfile: draft.introducedProfile,
    createdAtStep: draft.createdAtStep,
    status: "proposed",
  });
}

export async function listUnappliedCharacterSocialEvents(
  db: ChronicaDatabase,
  gameId: string,
): Promise<readonly CharacterSocialEvent[]> {
  const rows = await db
    .select()
    .from(characterSocialEvents)
    .where(and(eq(characterSocialEvents.gameId, gameId), eq(characterSocialEvents.status, "proposed")));
  return rows.map(toSocialEvent);
}

/**
 * Flips proposed events to "applied". Guarded by `WHERE status = 'proposed'`,
 * so calling this twice with the same ids only ever applies them once — the
 * second call's `RETURNING` is empty for anything already flipped.
 */
export async function markCharacterSocialEventsApplied(
  db: ChronicaDatabase,
  ids: readonly string[],
  atStep: number,
  turnId: string,
): Promise<readonly string[]> {
  if (ids.length === 0) return [];
  const applied: string[] = [];
  for (const id of ids) {
    const [row] = await db
      .update(characterSocialEvents)
      .set({ status: "applied", appliedAtStep: atStep, appliedInTurnId: turnId })
      .where(and(eq(characterSocialEvents.id, id), eq(characterSocialEvents.status, "proposed")))
      .returning({ id: characterSocialEvents.id });
    if (row !== undefined) applied.push(row.id);
  }
  return applied;
}

export async function markCharacterSocialEventsRejected(
  db: ChronicaDatabase,
  rejections: readonly { id: string; reason: string }[],
): Promise<void> {
  for (const { id, reason } of rejections) {
    await db
      .update(characterSocialEvents)
      .set({ status: "rejected", rejectionReason: reason })
      .where(and(eq(characterSocialEvents.id, id), eq(characterSocialEvents.status, "proposed")));
  }
}
