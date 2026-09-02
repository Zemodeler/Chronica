import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";
import type { Character } from "./character";

// Character pressures (character-sim phase 2).
//
// A pressure is what makes a character's next line or next decision urgent
// rather than merely colorful: a debt coming due, a public humiliation still
// raw, a war at the border. Every pressure names the event that caused it and
// decays on a schedule the same way a `RelationCause` does -- nothing here is
// a bare mood dial.

export const CharacterPressureKindSchema = z.enum([
  "debt",
  "threat",
  "grief",
  "illness",
  "political_danger",
  "family_obligation",
  "opportunity",
  "humiliation",
  "military_emergency",
]);
export type CharacterPressureKind = z.infer<typeof CharacterPressureKindSchema>;

export const CharacterPressureStatusSchema = z.enum(["active", "resolved", "expired"]);
export type CharacterPressureStatus = z.infer<typeof CharacterPressureStatusSchema>;

export const CharacterPressureSchema = z
  .object({
    id: EntityIdSchema,
    characterId: EntityIdSchema,
    kind: CharacterPressureKindSchema,
    intensity: z.number().int().min(0).max(100),
    label: z.string().trim().min(1).max(200),
    sourceEventId: EntityIdSchema.nullable(),
    createdAtStep: ElapsedStepSchema,
    reviewAtStep: ElapsedStepSchema,
    expiresAtStep: ElapsedStepSchema.nullable(),
    visibility: VisibilitySchema,
    status: CharacterPressureStatusSchema,
  })
  .strict();
export type CharacterPressure = z.infer<typeof CharacterPressureSchema>;

/** The minimal shape every helper below needs -- kept narrow so this module never has to import `WorldState`. */
export interface PressureWorldView {
  readonly characters: readonly Character[];
  readonly characterPressures: readonly CharacterPressure[];
}

const MAX_CURRENT_PRESSURES = 8;

function withUpdatedPressureList(
  world: PressureWorldView,
  characterId: string,
  next: readonly CharacterPressure[],
): Pick<PressureWorldView, "characters" | "characterPressures"> {
  const activeIds = next
    .filter((p) => p.characterId === characterId && p.status === "active")
    .sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id))
    .slice(0, MAX_CURRENT_PRESSURES)
    .map((p) => p.id);

  return {
    characterPressures: next,
    characters: world.characters.map((c) =>
      c.id === characterId ? { ...c, mind: { ...c.mind, currentPressures: activeIds } } : c,
    ),
  };
}

export interface CreatePressureInput {
  readonly id: string;
  readonly characterId: string;
  readonly kind: CharacterPressureKind;
  readonly intensity: number;
  readonly label: string;
  readonly sourceEventId: string | null;
  readonly atStep: number;
  readonly reviewInSteps: number;
  readonly expiresInSteps: number | null;
  readonly visibility: "public" | "polity" | "private";
}

/** Creates a new active pressure and updates the owning character's pointer cache. */
export function createPressure(
  world: PressureWorldView,
  input: CreatePressureInput,
): Pick<PressureWorldView, "characters" | "characterPressures"> {
  const pressure: CharacterPressure = {
    id: input.id,
    characterId: input.characterId,
    kind: input.kind,
    intensity: Math.max(0, Math.min(100, input.intensity)),
    label: input.label,
    sourceEventId: input.sourceEventId,
    createdAtStep: input.atStep,
    reviewAtStep: input.atStep + Math.max(1, input.reviewInSteps),
    expiresAtStep: input.expiresInSteps === null ? null : input.atStep + input.expiresInSteps,
    visibility: input.visibility,
    status: "active",
  };
  return withUpdatedPressureList(world, input.characterId, [...world.characterPressures, pressure]);
}

/** Raises intensity and pushes the review/expiry window out -- the same pressure recurring, not a new one. */
export function refreshPressure(
  world: PressureWorldView,
  pressureId: string,
  atStep: number,
  intensityDelta: number,
  reviewInSteps: number,
): Pick<PressureWorldView, "characters" | "characterPressures"> {
  const existing = world.characterPressures.find((p) => p.id === pressureId);
  if (existing === undefined) return world;
  const next = world.characterPressures.map((p) =>
    p.id === pressureId
      ? { ...p, intensity: Math.max(0, Math.min(100, p.intensity + intensityDelta)), reviewAtStep: atStep + Math.max(1, reviewInSteps) }
      : p,
  );
  return withUpdatedPressureList(world, existing.characterId, next);
}

/** A no-op decision to keep the pressure active, pushing its next review out. Distinct from decay/expiry. */
export function reviewPressure(
  world: PressureWorldView,
  pressureId: string,
  atStep: number,
  reviewInSteps: number,
): Pick<PressureWorldView, "characters" | "characterPressures"> {
  const existing = world.characterPressures.find((p) => p.id === pressureId);
  if (existing === undefined || existing.status !== "active") return world;
  const next = world.characterPressures.map((p) =>
    p.id === pressureId ? { ...p, reviewAtStep: atStep + Math.max(1, reviewInSteps) } : p,
  );
  return withUpdatedPressureList(world, existing.characterId, next);
}

/** Lowers intensity with time; a pressure that decays to zero is resolved, not merely quiet. */
export function decayPressure(
  world: PressureWorldView,
  pressureId: string,
  atStep: number,
  amount: number,
  reviewInSteps: number,
): Pick<PressureWorldView, "characters" | "characterPressures"> {
  const existing = world.characterPressures.find((p) => p.id === pressureId);
  if (existing === undefined || existing.status !== "active") return world;
  const nextIntensity = Math.max(0, existing.intensity - Math.max(0, amount));
  const next = world.characterPressures.map((p) =>
    p.id === pressureId
      ? { ...p, intensity: nextIntensity, status: nextIntensity === 0 ? ("resolved" as const) : p.status, reviewAtStep: atStep + Math.max(1, reviewInSteps) }
      : p,
  );
  return withUpdatedPressureList(world, existing.characterId, next);
}

export function expirePressure(
  world: PressureWorldView,
  pressureId: string,
): Pick<PressureWorldView, "characters" | "characterPressures"> {
  const existing = world.characterPressures.find((p) => p.id === pressureId);
  if (existing === undefined) return world;
  const next = world.characterPressures.map((p) => (p.id === pressureId ? { ...p, status: "expired" as const } : p));
  return withUpdatedPressureList(world, existing.characterId, next);
}

export function resolvePressure(
  world: PressureWorldView,
  pressureId: string,
): Pick<PressureWorldView, "characters" | "characterPressures"> {
  const existing = world.characterPressures.find((p) => p.id === pressureId);
  if (existing === undefined) return world;
  const next = world.characterPressures.map((p) => (p.id === pressureId ? { ...p, status: "resolved" as const } : p));
  return withUpdatedPressureList(world, existing.characterId, next);
}

/** Standard decay/review cadence applied to every active pressure due for review this step. Deterministic, no AI call. */
const DEFAULT_DECAY_AMOUNT = 8;
const DEFAULT_REVIEW_INTERVAL_STEPS = 4;

/**
 * Reviews every active pressure whose `reviewAtStep`/`expiresAtStep` has come
 * due: expires anything past its expiry, otherwise decays it and schedules
 * its next review. Called once per turn, before character selection.
 */
export function advancePressureLifecycle(world: PressureWorldView, atStep: number): Pick<PressureWorldView, "characters" | "characterPressures"> {
  let current: Pick<PressureWorldView, "characters" | "characterPressures"> = world;
  for (const pressure of world.characterPressures) {
    if (pressure.status !== "active") continue;
    if (pressure.expiresAtStep !== null && pressure.expiresAtStep <= atStep) {
      current = expirePressure(current, pressure.id);
      continue;
    }
    if (pressure.reviewAtStep <= atStep) {
      current = decayPressure(current, pressure.id, atStep, DEFAULT_DECAY_AMOUNT, DEFAULT_REVIEW_INTERVAL_STEPS);
    }
  }
  return current;
}

export function getActivePressures(
  world: { readonly characterPressures: readonly CharacterPressure[] },
  characterId: string,
): readonly CharacterPressure[] {
  return world.characterPressures.filter((p) => p.characterId === characterId && p.status === "active");
}

// ── Initial triggers ─────────────────────────────────────────────────────
//
// Each trigger reads only outcomes already validated and applied this same
// turn -- an injury already reflected in `healthBps`, a social event already
// accepted by `applySocialEvents`, a commitment already resolved -- so no new
// AI call or unvalidated inference is involved. Ids are derived from the
// triggering event/step rather than randomly generated, so replaying the
// same turn produces the same pressures.

const HEALTH_DROP_THRESHOLD_BPS = 2_000;

export interface PressureTriggerInputs {
  readonly atStep: number;
  readonly charactersBefore: readonly Character[];
  readonly charactersAfter: readonly Character[];
  /** characterId -> personal account balance, resolved by the caller. */
  readonly accountBalanceBefore: ReadonlyMap<string, number>;
  readonly accountBalanceAfter: ReadonlyMap<string, number>;
  readonly appliedSocialEvents: readonly { readonly id: string; readonly kind: string; readonly participantCharacterIds: readonly string[] }[];
  readonly failedOrCancelledCommitments: readonly { readonly id: string; readonly npcCharacterId: string; readonly playerCharacterId: string }[];
  /** Polity ids currently party to an active war. */
  readonly warringPolityIds: ReadonlySet<string>;
}

/** The six initial triggers (docs/11 follow-up). Pure and deterministic -- no AI call. */
export function derivePressureTriggers(input: PressureTriggerInputs): readonly CreatePressureInput[] {
  const { atStep } = input;
  const proposals: CreatePressureInput[] = [];
  const beforeById = new Map(input.charactersBefore.map((c) => [c.id, c]));

  for (const after of input.charactersAfter) {
    const before = beforeById.get(after.id);
    if (before === undefined) continue;

    // Illness/injury: a sharp drop in health this turn.
    if (after.alive && before.healthBps - after.healthBps >= HEALTH_DROP_THRESHOLD_BPS) {
      proposals.push({
        id: `pressure-illness-${after.id}-${atStep}`,
        characterId: after.id,
        kind: "illness",
        intensity: Math.min(100, Math.round((before.healthBps - after.healthBps) / 100)),
        label: "Recovering from a serious injury.",
        sourceEventId: null,
        atStep,
        reviewInSteps: 4,
        expiresInSteps: null,
        visibility: "polity",
      });
    }

    // Debt: the character's personal account went negative this turn.
    const balanceBefore = input.accountBalanceBefore.get(after.id);
    const balanceAfter = input.accountBalanceAfter.get(after.id);
    if (balanceAfter !== undefined && balanceAfter < 0 && (balanceBefore === undefined || balanceBefore >= 0)) {
      proposals.push({
        id: `pressure-debt-${after.id}-${atStep}`,
        characterId: after.id,
        kind: "debt",
        intensity: Math.min(100, Math.round(Math.abs(balanceAfter) / 10)),
        label: "Personal finances have gone into debt.",
        sourceEventId: null,
        atStep,
        reviewInSteps: 6,
        expiresInSteps: null,
        visibility: "private",
      });
    }

    // Military emergency: the character's polity is at war.
    if (after.alive && after.polityId !== null && input.warringPolityIds.has(after.polityId)) {
      proposals.push({
        id: `pressure-military-${after.id}-${atStep}`,
        characterId: after.id,
        kind: "military_emergency",
        intensity: 60,
        label: "Their polity is at war.",
        sourceEventId: null,
        atStep,
        reviewInSteps: 4,
        expiresInSteps: null,
        visibility: "public",
      });
    }
  }

  // Public insult/humiliation: an applied social event of kind "insult".
  for (const event of input.appliedSocialEvents) {
    if (event.kind !== "insult") continue;
    for (const characterId of event.participantCharacterIds) {
      proposals.push({
        id: `pressure-humiliation-${event.id}-${characterId}`,
        characterId,
        kind: "humiliation",
        intensity: 55,
        label: "Publicly insulted.",
        sourceEventId: event.id,
        atStep,
        reviewInSteps: 5,
        expiresInSteps: 20,
        visibility: "public",
      });
    }
  }

  // Broken commitment: a promise resolved failed or cancelled this turn. The
  // pressure kind vocabulary has no dedicated "broken promise" entry; the
  // reputational cost of a broken promise is modeled as humiliation.
  for (const commitment of input.failedOrCancelledCommitments) {
    proposals.push({
      id: `pressure-broken-commitment-${commitment.id}`,
      characterId: commitment.npcCharacterId,
      kind: "humiliation",
      intensity: 40,
      label: "A promise was broken.",
      sourceEventId: commitment.id,
      atStep,
      reviewInSteps: 5,
      expiresInSteps: 20,
      visibility: "polity",
    });
  }

  // Political opportunity: an office vacated this turn (holder died) that
  // another living character's ambitions actively target.
  const vacatedOfficeIds = new Set<string>();
  for (const before of input.charactersBefore) {
    if (before.officeId === null) continue;
    const after = input.charactersAfter.find((c) => c.id === before.id);
    if (after !== undefined && !after.alive) vacatedOfficeIds.add(before.officeId);
  }
  if (vacatedOfficeIds.size > 0) {
    for (const character of input.charactersAfter) {
      if (!character.alive) continue;
      for (const ambition of character.ambitions) {
        if (ambition.status !== "active" || ambition.targetId === null || !vacatedOfficeIds.has(ambition.targetId)) continue;
        proposals.push({
          id: `pressure-opportunity-${character.id}-${ambition.targetId}-${atStep}`,
          characterId: character.id,
          kind: "opportunity",
          intensity: 65,
          label: `An office they seek, ${ambition.targetId}, has fallen vacant.`,
          sourceEventId: null,
          atStep,
          reviewInSteps: 3,
          expiresInSteps: 10,
          visibility: "private",
        });
      }
    }
  }

  return proposals;
}
