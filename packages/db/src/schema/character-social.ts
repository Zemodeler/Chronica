import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  Character,
  CommitmentProposal,
  KnowledgeClaimProposal,
  RelationCauseProposal,
  Visibility,
} from "@chronica/shared";
import { games } from "./game";

/**
 * Dialogue-only descriptive projection of a canonical character (character-sim
 * phase 1). Biography, voice, and presentation only -- never relationship
 * score, availability, or location. Those are derived from `WorldState`.
 */
export const characterProfiles = pgTable("character_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  characterId: text("character_id").notNull(),
  version: integer("version").notNull().default(1),
  roleLabel: text("role_label").notNull(),
  biography: text("biography"),
  voiceSummary: text("voice_summary"),
  presentationDetails: jsonb("presentation_details").$type<Record<string, unknown>>().notNull().default({}),
  updatedAtStep: integer("updated_at_step").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("character_profiles_game_character_unique").on(table.gameId, table.characterId),
]);

/**
 * The chat/simulation boundary (character-sim phase 1, docs/TODO).
 *
 * Dialogue may only ever insert a row here with status "proposed" -- it
 * cannot mutate `WorldState.characters` directly. Turn resolution is the sole
 * authority that validates a proposal against canonical state, applies its
 * deterministic deltas via `applySocialEvents`, and flips the row to
 * "applied". The flip is a single `UPDATE ... WHERE status = 'proposed'`; a
 * row already applied or rejected returns zero rows, which is what makes
 * applying the same event twice impossible.
 */
export const characterSocialEvents = pgTable("character_social_events", {
  /** App-assigned, allocated once at proposal time -- never minted during replay. */
  id: text("id").primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  sourceTurnId: text("source_turn_id"),
  sourceSessionId: text("source_session_id"),
  sourceMessageId: text("source_message_id"),
  participantCharacterIds: jsonb("participant_character_ids").$type<string[]>().notNull(),
  kind: text("kind").notNull().$type<"conversation" | "promise" | "insult" | "favour" | "deception" | "discovery" | "rumour">(),
  visibility: text("visibility").notNull().$type<Visibility>(),
  knownByCharacterIds: jsonb("known_by_character_ids").$type<string[]>().notNull().default([]),
  relationCauses: jsonb("relation_causes").$type<RelationCauseProposal[]>().notNull().default([]),
  knowledgeClaims: jsonb("knowledge_claims").$type<KnowledgeClaimProposal[]>().notNull().default([]),
  commitmentProposal: jsonb("commitment_proposal").$type<CommitmentProposal | null>(),
  introducedCharacter: jsonb("introduced_character").$type<Character | null>(),
  introducedProfile: jsonb("introduced_profile").$type<{
    gameId: string;
    characterId: string;
    version: number;
    roleLabel: string;
    biography: string | null;
    voiceSummary: string | null;
    presentationDetails: Record<string, unknown>;
    updatedAtStep: number;
  } | null>(),
  createdAtStep: integer("created_at_step").notNull(),
  appliedAtStep: integer("applied_at_step"),
  appliedInTurnId: text("applied_in_turn_id"),
  status: text("status").notNull().default("proposed").$type<"proposed" | "applied" | "rejected">(),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("character_social_events_game_status_idx").on(table.gameId, table.status),
]);
