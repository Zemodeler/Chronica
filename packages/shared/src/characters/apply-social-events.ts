import type { WorldState } from "../world/world-state";
import type { Character, DirectedRelation, RelationCause } from "./character";
import type { CharacterProfile } from "./character-profile";
import type { CharacterSocialEvent } from "./social-events";
import { listSocialLinks, type SocialLink } from "./relationship-dimensions";
import type { CharacterBelief } from "./beliefs";
import { KNOWLEDGE_CHANNEL_DEFAULTS, resolveRecipients } from "./beliefs";
import { createPressure, refreshPressure, resolvePressure } from "./pressures";
import { boundedId, stableHash } from "../determinism";
import { MAX_TRAITS, observeTraits, type TraitObservation } from "./traits";
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
  /** Traits that two people have now independently seen, so they are who somebody is. */
  readonly traitsConfirmed: readonly { readonly characterId: string; readonly traitId: string; readonly observerCharacterIds: readonly string[] }[];
  /** Traits two people have now seen the opposite of, so they are no longer who somebody is. */
  readonly traitsLost: readonly { readonly characterId: string; readonly traitId: string; readonly contradictedBy: string }[];
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
/**
 * A short, stable id for something scoped to an event and two people.
 *
 * Built by concatenation, these ran past `EntityIdSchema`'s 120 characters
 * the moment real ids were involved -- an event id, a `declared-<uuid>`
 * player and a `character-<burst uuid>-<n>` NPC come to well over that -- and
 * the whole batch was then rejected with "characters.21.relations.0.causes.0.id:
 * Too big", which names neither the event nor the people nor the cause. It
 * was reachable only from dialogue until the simulation started writing
 * relation causes of its own, and then it began throwing away whole answers,
 * battles included.
 *
 * Hashed rather than truncated: truncating two ids that share a prefix gives
 * one id, and `stableHash` keeps a replay identical.
 */
const scopedId = (eventId: string, kind: string, ...parts: readonly string[]): string =>
  `${eventId.slice(0, 40)}:${kind}:${stableHash([eventId, kind, ...parts]).toString(36)}`;

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
  let traitObservations: readonly TraitObservation[] = world.traitObservations;
  const traitsConfirmed: { characterId: string; traitId: string; observerCharacterIds: readonly string[] }[] = [];
  const traitsLost: { characterId: string; traitId: string; contradictedBy: string }[] = [];
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
          id: scopedId(event.id, "commitment"),
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
      id: scopedId(event.id, "cause", String(index)),
      kind: "relationship_cause" as const,
      explanation: cause.label,
    }));

    for (const cause of event.relationCauses) {
      const subject = characters.find((c) => c.id === cause.subjectCharacterId);
      if (subject === undefined) continue;
      const relationCause: RelationCause = {
        id: scopedId(event.id, "cause", cause.subjectCharacterId, cause.targetCharacterId),
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
            id: scopedId(event.id, "link", cause.subjectCharacterId, cause.targetCharacterId, cause.socialLinkKind),
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
    //
    // A rumour travels along the source's own social links -- resolveRecipients
    // takes at most four of them, sorted, so the spread stays bounded and
    // deterministic. This argument was [] from the day it was written, which
    // meant ordinary_rumour resolved to nobody and the one broad channel in
    // the knowledge model never moved a thing. The other channels name their
    // recipients outright and do not read it.
    const rumourSource = event.participantCharacterIds[0] ?? null;
    const sourceSocialLinkTargetIds = rumourSource === null
      ? []
      : listSocialLinks({ socialLinks }, rumourSource)
        .map((link) => (link.subjectCharacterId === rumourSource ? link.targetCharacterId : link.subjectCharacterId))
        .filter((id) => id !== rumourSource);

    for (const [beliefIndex, beliefProposal] of event.proposedBeliefs.entries()) {
      const recipients = resolveRecipients({
        channel: beliefProposal.channel,
        participantCharacterIds: event.participantCharacterIds,
        witnessCharacterIds: event.knownByCharacterIds,
        sourceCharacterId: rumourSource,
        sourceSocialLinkTargetIds,
        explicitRecipientIds: beliefProposal.explicitRecipientCharacterIds,
      });
      const defaults = KNOWLEDGE_CHANNEL_DEFAULTS[beliefProposal.channel];
      for (const holderCharacterId of recipients) {
        const id = boundedId(event.id, "belief", beliefIndex, holderCharacterId);
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
          id: scopedId(event.id, "pressure", String(changeIndex)),
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

    // What the people in this event now think somebody is like (slice 11).
    //
    // An observer has to have been there -- a trait is what somebody saw, not
    // what they heard -- and two of them have to say it before it is who
    // anybody is. Refused observations do not fail the event: an NPC naming a
    // trait the registry has no word for has simply said something the engine
    // cannot write down.
    const witnesses = new Set(event.participantCharacterIds);
    const proposals = event.observedTraits.filter((proposal) => witnesses.has(proposal.observerCharacterId));
    if (proposals.length > 0) {
      const traitsOf = (characterId: string): readonly string[] =>
        characters.find((candidate) => candidate.id === characterId)?.traits ?? [];
      const outcome = observeTraits(
        traitObservations,
        proposals.map((proposal) => ({
          characterId: proposal.subjectCharacterId,
          observerCharacterId: proposal.observerCharacterId,
          traitId: proposal.traitId,
          note: proposal.note,
        })),
        traitsOf,
        atStep,
        (prefix) => `${event.id}:${prefix}:${traitObservations.length}`,
      );
      traitObservations = outcome.observations;
      for (const entry of outcome.confirmed) {
        traitsConfirmed.push(entry);
        characters = characters.map((candidate) => (candidate.id === entry.characterId
          ? { ...candidate, traits: [...candidate.traits, entry.traitId].slice(0, MAX_TRAITS) }
          : candidate));
      }
      for (const entry of outcome.lost) {
        traitsLost.push({ characterId: entry.characterId, traitId: entry.traitId, contradictedBy: entry.contradictedBy });
        characters = characters.map((candidate) => (candidate.id === entry.characterId
          ? { ...candidate, traits: candidate.traits.filter((held) => held !== entry.traitId) }
          : candidate));
      }
    }

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
      traitObservations: [...traitObservations],
    },
    appliedIds,
    rejectedIds,
    introducedProfiles,
    traitsConfirmed,
    traitsLost,
  };
}
