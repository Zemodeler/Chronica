import { z } from "zod";
import { queryBeliefs, type CharacterBelief } from "../characters/beliefs";

// Player knowledge & Chronicle projection (character-sim phase 6).
//
// Chronicle prose is written once per entry and shared by its whole audience
// -- there is no per-viewer narrative variance anywhere in the pipeline, so
// classification is entry-intrinsic metadata rather than something computed
// per reader. What *is* per-viewer is whether the entry is shown at all: an
// "all_players" entry is always visible, a "knowledge_scoped" one only to a
// character who already holds a matching belief (character-sim phase 2's
// `CharacterBelief`/`queryBeliefs`, wired into Chronicle visibility for the
// first time here).

export const ChronicleKnowledgeStatusSchema = z.enum(["confirmed", "report", "rumour", "suspicion"]);
export type ChronicleKnowledgeStatus = z.infer<typeof ChronicleKnowledgeStatusSchema>;

export interface ChronicleDirectConsequence {
  readonly kind: string;
  readonly label: string;
  readonly entityId: string | null;
  readonly quantified: boolean;
}

export interface ChroniclePoliticalOutcomeFact {
  readonly procedureId: string;
  readonly procedureType: string;
  readonly institutionName: string | null;
  readonly sponsorName: string;
  readonly outcome: "passed" | "failed" | "blocked" | "withdrawn";
  readonly publicReason: string;
  readonly netSupportWeight: number;
  readonly netOppositionWeight: number;
}

export interface ChronicleLifeEventFact {
  readonly characterId: string;
  readonly characterName: string;
  readonly kind: "death" | "incapacitation" | "recovery";
  readonly cause: string;
  readonly estateOutcome: string | null;
  readonly vacatedOfficeIds: readonly string[];
}

export interface ChronicleCommandChangeFact {
  readonly forceName: string;
  readonly previousCommanderName: string | null;
  readonly newCommanderName: string | null;
  readonly reason: string;
}

export interface ChronicleFamilyEventFact {
  readonly contractId: string;
  readonly type: string;
  readonly partyNames: readonly string[];
  readonly outcome: string;
}

/**
 * The narrow, already-projected shape a Chronicle row is read into before
 * `projectChronicleEntry` decides what a given viewer may see of it. Callers
 * (packages/db's `getChronicleForLatestTurn`) adapt their stored `facts` jsonb
 * into this shape; nothing here ever sees a raw `WorldState`.
 */
export interface ChronicleFactRecord {
  readonly id: string;
  readonly sequence: number;
  readonly audience: "all_players" | "knowledge_scoped";
  readonly body: string;
  readonly title?: string;
  readonly knowledgeStatus?: ChronicleKnowledgeStatus;
  /** The belief subject this entry is scoped to, for knowledge-gated visibility. */
  readonly scopeRef?: string | null;
  readonly chainId?: string | null;
  readonly chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null;
  readonly materialConsequence?: boolean;
  readonly displayPatch?: unknown;
  readonly atStep: number;
  readonly eventDate?: string | null;
  readonly location?: string | null;
  readonly directConsequences?: readonly ChronicleDirectConsequence[];
  readonly sourceDirector?: string;
  readonly openPressure?: boolean;
  readonly participants?: readonly { readonly name: string; readonly role?: string }[];
  readonly places?: readonly { readonly name: string }[];
  readonly institutions?: readonly { readonly name: string }[];
  readonly playerRelevance?: "high" | "medium" | "low" | "none";
  readonly politicalOutcome?: ChroniclePoliticalOutcomeFact;
  readonly lifeEvent?: ChronicleLifeEventFact;
  readonly commandChange?: ChronicleCommandChangeFact;
  readonly familyEvent?: ChronicleFamilyEventFact;
}

/**
 * The real visibility gate. An `"all_players"` entry is always shown. A
 * `"knowledge_scoped"` entry is shown only if the viewer holds an active
 * belief about the entry's subject -- closing the gap where Chronicle
 * visibility never actually consulted the belief system.
 */
export function resolveChronicleVisibility(
  entry: Pick<ChronicleFactRecord, "audience" | "scopeRef" | "chainId">,
  viewerCharacterId: string | null,
  characterBeliefs: readonly CharacterBelief[],
): boolean {
  if (entry.audience === "all_players") return true;
  if (viewerCharacterId === null) return false;
  const subjectId = entry.scopeRef ?? entry.chainId ?? null;
  if (subjectId === null) return false;
  return queryBeliefs({ characterBeliefs }, viewerCharacterId, subjectId).length > 0;
}

export interface PlayerFacingChronicleFacts {
  readonly title: string;
  readonly knowledgeStatus: ChronicleKnowledgeStatus;
  readonly body: string;
  readonly atStep: number;
  readonly materialConsequence: boolean;
  readonly displayPatch?: unknown;
  readonly eventDate?: string | null;
  readonly location?: string | null;
  readonly chainId?: string | null;
  readonly chainPosition?: "root" | "reaction" | "spread" | "distant" | "pressure" | null;
  readonly directConsequences?: readonly ChronicleDirectConsequence[];
  readonly openPressure?: boolean;
  readonly participants: readonly { readonly name: string; readonly role?: string }[];
  readonly places: readonly { readonly name: string }[];
  readonly institutions: readonly { readonly name: string }[];
  readonly playerRelevance: "high" | "medium" | "low" | "none";
  readonly politicalOutcome?: ChroniclePoliticalOutcomeFact;
  readonly lifeEvent?: ChronicleLifeEventFact;
  readonly commandChange?: ChronicleCommandChangeFact;
  readonly familyEvent?: ChronicleFamilyEventFact;
}

/**
 * An explicit allowlist, never a spread of the input: a `facts` blob carrying
 * an unrecognised key (a bug, or a future private field added elsewhere
 * without updating this file) simply never reaches the player.
 */
export function redactChronicleFacts(entry: ChronicleFactRecord): PlayerFacingChronicleFacts {
  return {
    title: entry.title ?? "Chronicle entry",
    knowledgeStatus: entry.knowledgeStatus ?? "confirmed",
    body: entry.body,
    atStep: entry.atStep,
    materialConsequence: entry.materialConsequence ?? false,
    ...(entry.displayPatch !== undefined ? { displayPatch: entry.displayPatch } : {}),
    ...(entry.eventDate != null ? { eventDate: entry.eventDate } : {}),
    ...(entry.location != null ? { location: entry.location } : {}),
    ...(entry.chainId != null ? { chainId: entry.chainId } : {}),
    ...(entry.chainPosition != null ? { chainPosition: entry.chainPosition } : {}),
    ...(entry.directConsequences && entry.directConsequences.length > 0 ? { directConsequences: entry.directConsequences } : {}),
    ...(entry.openPressure ? { openPressure: true } : {}),
    participants: entry.participants ?? [],
    places: entry.places ?? [],
    institutions: entry.institutions ?? [],
    playerRelevance: entry.playerRelevance ?? "none",
    ...(entry.politicalOutcome !== undefined ? { politicalOutcome: entry.politicalOutcome } : {}),
    ...(entry.lifeEvent !== undefined ? { lifeEvent: entry.lifeEvent } : {}),
    ...(entry.commandChange !== undefined ? { commandChange: entry.commandChange } : {}),
    ...(entry.familyEvent !== undefined ? { familyEvent: entry.familyEvent } : {}),
  };
}

export interface ChronicleEntryProjection extends PlayerFacingChronicleFacts {
  readonly id: string;
  readonly sequence: number;
  readonly audience: "all_players" | "knowledge_scoped";
}

/**
 * The single choke point every Chronicle-serving route must call: `null`
 * means the viewer may not see this entry at all (not merely a field-redacted
 * version of it).
 */
export function projectChronicleEntry(
  entry: ChronicleFactRecord,
  viewerCharacterId: string | null,
  characterBeliefs: readonly CharacterBelief[],
): ChronicleEntryProjection | null {
  if (!resolveChronicleVisibility(entry, viewerCharacterId, characterBeliefs)) return null;
  return {
    id: entry.id,
    sequence: entry.sequence,
    audience: entry.audience,
    ...redactChronicleFacts(entry),
  };
}
