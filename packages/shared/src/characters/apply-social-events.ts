import type { WorldState } from "../world/world-state";
import type { Character, DirectedRelation, RelationCause } from "./character";
import type { CharacterProfile } from "./character-profile";
import type { CharacterSocialEvent } from "./social-events";
import type { SocialLink } from "./relationship-dimensions";
import type { CharacterBelief } from "./beliefs";
import { KNOWLEDGE_CHANNEL_DEFAULTS, resolveRecipients } from "./beliefs";
import { createPressure, refreshPressure, resolvePressure } from "./pressures";
import type { Commitment } from "./commitments";
import { createCommitment } from "./commitments";

// The single point where a proposed social event becomes canonical world
// state (character-sim phase 1, extended in phase 2 with beliefs, pressure
// changes, and typed social links). Pure and deterministic: given the same
// world, the same unapplied events, and the same `atStep`, it always produces
// the same result -- safe to call from inside turn resolution and safe to
// replay.

export interface ApplySocialEventsOutcome {
  readonly world: WorldState;
  readonly appliedIds: readonly string[];
  readonly rejectedIds: readonly { id: string; reason: string }[];
  /** Profiles paired with a newly-introduced character, for the caller to persist (DB-side, not part of `WorldState`). */
  readonly introducedProfiles: readonly CharacterProfile[];
}

function findRelation(character: Character, targetCharacterId: string): DirectedRelation | undefined {
  return character.relations.find((relation) => relation.subjectCharacterId === targetCharacterId);
}

function withAppendedCause(character: Character, targetCharacterId: string, cause: RelationCause): Character {
  const existing = findRelation(character, targetCharacterId);
  if (existing === undefined) {
    return {
      ...character,
      relations: [...character.relations, { subjectCharacterId: targetCharacterId, causes: [cause] }],
    };
  }
  return {
    ...character,
    relations: character.relations.map((relation) =>
      relation.subjectCharacterId === targetCharacterId
        ? { ...relation, causes: [...relation.causes, cause] }
        : relation,
    ),
  };
}

/**
 * Validates and applies a batch of unapplied `CharacterSocialEvent`s against
 * `world`. Never touches `material`, `officeId`, territories, or any field
 * outside `characters`/`continuity`/`encounters`/`characterBeliefs`/
 * `characterPressures`/`socialLinks`/`commitments` -- the event schema itself
 * has no field to carry any other effect, so this is structural, not just a
 * runtime check. A commitment proposal only ever *reads* `material` (to
 * confirm the promisor genuinely controls what they promise); it never
 * spends it -- that only happens later, when the commitment is fulfilled
 * (`character-agency/commitments.ts`).
 */
export function applySocialEvents(
  world: WorldState,
  events: readonly CharacterSocialEvent[],
  atStep: number,
  turnId: string,
): ApplySocialEventsOutcome {
  let characters: readonly Character[] = world.characters;
  let encounters = world.encounters;
  let characterBeliefs: readonly CharacterBelief[] = world.characterBeliefs;
  let characterPressures: readonly WorldState["characterPressures"][number][] = world.characterPressures;
  let socialLinks: readonly SocialLink[] = world.socialLinks;
  let commitments: readonly Commitment[] = world.commitments;
  const appliedIds: string[] = [];
  const rejectedIds: { id: string; reason: string }[] = [];
  const introducedProfiles: CharacterProfile[] = [];

  for (const event of events) {
    if (event.status !== "proposed") continue;

    const knownCharacterIds = new Set(characters.map((c) => c.id));
    const introducing = event.kind === "discovery" && event.introducedCharacter !== null
      ? event.introducedCharacter
      : null;

    const unknownParticipant = event.participantCharacterIds.find(
      (id) => !knownCharacterIds.has(id) && id !== introducing?.id,
    );
    if (unknownParticipant !== undefined) {
      rejectedIds.push({ id: event.id, reason: `Unknown participant "${unknownParticipant}".` });
      continue;
    }

    const invalidCause = event.relationCauses.find(
      (cause) =>
        (!knownCharacterIds.has(cause.subjectCharacterId) && cause.subjectCharacterId !== introducing?.id)
        || (!knownCharacterIds.has(cause.targetCharacterId) && cause.targetCharacterId !== introducing?.id),
    );
    if (invalidCause !== undefined) {
      rejectedIds.push({ id: event.id, reason: "Relation cause references an unknown character." });
      continue;
    }

    // Beliefs: every explicit recipient must be a participant/witness of this
    // event -- a proposal cannot grant knowledge to someone with no plausible
    // connection to it.
    const eligibleBeliefRecipients = new Set([...event.participantCharacterIds, ...event.knownByCharacterIds]);
    const invalidBelief = event.proposedBeliefs.find((belief) =>
      belief.explicitRecipientCharacterIds.some((id) => !eligibleBeliefRecipients.has(id) && id !== introducing?.id),
    );
    if (invalidBelief !== undefined) {
      rejectedIds.push({ id: event.id, reason: "Belief proposal names a recipient with no connection to this event." });
      continue;
    }

    // Pressure changes: only ever about a known participant, never a bystander.
    const invalidPressureChange = event.pressureChanges.find(
      (change) => !knownCharacterIds.has(change.characterId) && change.characterId !== introducing?.id,
    );
    if (invalidPressureChange !== undefined) {
      rejectedIds.push({ id: event.id, reason: "Pressure change references an unknown character." });
      continue;
    }

    // A commitment proposal must name only known participants, and its
    // promisor must genuinely control what it names -- checked in full
    // before any of this event's other effects apply, so a promise no one
    // can keep never leaves a partially-applied event behind.
    let commitmentToAppend: Commitment | null = null;
    if (event.commitmentProposal !== null) {
      const proposal = event.commitmentProposal;
      if (
        (!knownCharacterIds.has(proposal.promisorCharacterId) && proposal.promisorCharacterId !== introducing?.id)
        || (!knownCharacterIds.has(proposal.beneficiaryCharacterId) && proposal.beneficiaryCharacterId !== introducing?.id)
      ) {
        rejectedIds.push({ id: event.id, reason: "Commitment proposal names an unknown character." });
        continue;
      }
      const authorityCheck = createCommitment(
        { characters, commitments, material: world.material },
        {
          id: `${event.id}:commitment`,
          promisorCharacterId: proposal.promisorCharacterId,
          beneficiaryCharacterId: proposal.beneficiaryCharacterId,
          actionKind: proposal.actionKind,
          description: proposal.promisedResult,
          conditions: proposal.conditions,
          requiredOfficeId: proposal.requiredOfficeId,
          requiredResource: proposal.requiredResource,
          visibility: event.visibility,
          sourceEventId: event.id,
          atStep,
          reviewInSteps: proposal.reviewInSteps,
        },
      );
      if ("rejectionReason" in authorityCheck) {
        rejectedIds.push({ id: event.id, reason: `Commitment cannot be kept: ${authorityCheck.rejectionReason}` });
        continue;
      }
      commitmentToAppend = authorityCheck.commitment;
    }

    // Discovery: append the introduced character (idempotent by id).
    if (introducing !== null && !knownCharacterIds.has(introducing.id)) {
      characters = [...characters, introducing];
      knownCharacterIds.add(introducing.id);
      if (event.introducedProfile !== null) introducedProfiles.push(event.introducedProfile);
    }

    const consequenceRefs = event.relationCauses.map((cause, index) => ({
      id: `${event.id}:cause:${index}`,
      kind: "relationship_cause" as const,
      explanation: cause.label,
    }));

    for (const cause of event.relationCauses) {
      const subject = characters.find((c) => c.id === cause.subjectCharacterId);
      if (subject === undefined) continue;
      const relationCause: RelationCause = {
        id: `${event.id}:cause:${cause.subjectCharacterId}:${cause.targetCharacterId}`,
        label: cause.label,
        score: cause.score,
        occurredAtStep: atStep,
        decayPerYearBps: cause.decayPerYearBps,
        encounterMemoryId: event.id,
        ...(cause.dimensions !== undefined ? { dimensions: cause.dimensions } : {}),
      };
      characters = characters.map((c) =>
        c.id === subject.id ? withAppendedCause(c, cause.targetCharacterId, relationCause) : c,
      );

      if (cause.socialLinkKind !== undefined) {
        const alreadyLinked = socialLinks.some((link) =>
          link.subjectCharacterId === cause.subjectCharacterId
          && link.targetCharacterId === cause.targetCharacterId
          && link.kind === cause.socialLinkKind,
        );
        if (!alreadyLinked) {
          socialLinks = [...socialLinks, {
            id: `${event.id}:link:${cause.subjectCharacterId}:${cause.targetCharacterId}:${cause.socialLinkKind}`,
            subjectCharacterId: cause.subjectCharacterId,
            targetCharacterId: cause.targetCharacterId,
            kind: cause.socialLinkKind,
            sourceEventId: event.id,
            createdAtStep: atStep,
            visibility: event.visibility,
          }];
        }
      }
    }

    // Beliefs: resolve recipients per channel and grant/reinforce a belief for each.
    for (const [beliefIndex, beliefProposal] of event.proposedBeliefs.entries()) {
      const recipients = resolveRecipients({
        channel: beliefProposal.channel,
        participantCharacterIds: event.participantCharacterIds,
        witnessCharacterIds: event.knownByCharacterIds,
        sourceCharacterId: event.participantCharacterIds[0] ?? null,
        sourceSocialLinkTargetIds: [],
        explicitRecipientIds: beliefProposal.explicitRecipientCharacterIds,
      });
      const defaults = KNOWLEDGE_CHANNEL_DEFAULTS[beliefProposal.channel];
      for (const holderCharacterId of recipients) {
        const id = `${event.id}:belief:${beliefIndex}:${holderCharacterId}`;
        const existing = characterBeliefs.find((b) =>
          b.holderCharacterId === holderCharacterId && b.status === "active"
          && b.claim === beliefProposal.claim && b.subjectEntityId === beliefProposal.subjectEntityId,
        );
        if (existing !== undefined) {
          const confidence = Math.max(0, Math.min(100, beliefProposal.confidenceOverride ?? defaults.defaultConfidence));
          characterBeliefs = characterBeliefs.map((b) =>
            b.id === existing.id ? { ...b, confidence: Math.max(0, Math.min(100, b.confidence + Math.round((confidence - b.confidence) / 2))) } : b,
          );
        } else {
          characterBeliefs = [...characterBeliefs, {
            id,
            holderCharacterId,
            subjectEntityId: beliefProposal.subjectEntityId,
            claim: beliefProposal.claim,
            kind: beliefProposal.kind,
            sourceCharacterId: event.participantCharacterIds.find((p) => p !== holderCharacterId) ?? null,
            sourceEventId: event.id,
            confidence: Math.max(0, Math.min(100, beliefProposal.confidenceOverride ?? defaults.defaultConfidence)),
            visibility: defaults.defaultVisibility,
            learnedAtStep: atStep,
            expiresAtStep: beliefProposal.expiresInSteps === null ? null : atStep + beliefProposal.expiresInSteps,
            supersedesBeliefIds: [],
            status: "active",
          }];
        }
      }
    }

    // Pressure changes.
    for (const [changeIndex, change] of event.pressureChanges.entries()) {
      const worldSlice = { characters, characterPressures };
      if (change.action === "create") {
        if (change.kind === undefined || change.intensity === undefined || change.label === undefined) continue;
        const result = createPressure(worldSlice, {
          id: `${event.id}:pressure:${changeIndex}`,
          characterId: change.characterId,
          kind: change.kind,
          intensity: change.intensity,
          label: change.label,
          sourceEventId: event.id,
          atStep,
          reviewInSteps: change.reviewInSteps,
          expiresInSteps: change.expiresInSteps,
          visibility: change.visibility,
        });
        characters = result.characters;
        characterPressures = result.characterPressures;
      } else {
        const target = characterPressures.find(
          (p) => p.characterId === change.characterId && p.status === "active" && (change.kind === undefined || p.kind === change.kind),
        );
        if (target === undefined) continue;
        const result = change.action === "refresh"
          ? refreshPressure(worldSlice, target.id, atStep, change.intensity ?? 15, change.reviewInSteps)
          : resolvePressure(worldSlice, target.id);
        characters = result.characters;
        characterPressures = result.characterPressures;
      }
    }

    if (commitmentToAppend !== null) {
      commitments = [...commitments, commitmentToAppend];
    }

    encounters = [
      ...encounters,
      {
        id: event.id,
        participantIds: event.participantCharacterIds,
        occurredAtStep: event.createdAtStep,
        turnId,
        kind: event.kind === "discovery" ? "meeting" : "conversation",
        outcome: event.commitmentProposal !== null
          ? `${event.kind}: ${event.commitmentProposal.promisedResult}`
          : `${event.kind} between ${event.participantCharacterIds.join(", ")}.`,
        visibility: event.visibility,
        witnessIds: event.knownByCharacterIds,
        salience: event.relationCauses.length > 0 ? 500 : 100,
        consequences: consequenceRefs,
        chronicleFactId: null,
      },
    ];

    appliedIds.push(event.id);
  }

  return {
    world: {
      ...world,
      characters: [...characters],
      encounters,
      characterBeliefs: [...characterBeliefs],
      characterPressures: [...characterPressures],
      socialLinks: [...socialLinks],
      commitments: [...commitments],
    },
    appliedIds,
    rejectedIds,
    introducedProfiles,
  };
}
