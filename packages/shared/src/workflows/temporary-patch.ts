import { z } from "zod";
import { EntityIdSchema, VisibilitySchema } from "../material-state";
import type { WorldState } from "../world/world-state";

// A temporary patch is deliberately data, not generated JavaScript. It gives a
// one-off workflow bounded, reviewable powers for the current turn only.
const AccountDeltaPatchSchema = z.object({
  kind: z.literal("account_delta"),
  accountId: EntityIdSchema,
  amount: z.number().int().refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(240),
}).strict();

const ProvinceControlPatchSchema = z.object({
  kind: z.literal("province_control"),
  provinceId: EntityIdSchema,
  controllerPolityId: EntityIdSchema,
  firmnessBps: z.number().int().min(0).max(10_000),
}).strict();

const CharacterStatePatchSchema = z.object({
  kind: z.literal("character_state"),
  characterId: EntityIdSchema,
  healthBps: z.number().int().min(0).max(10_000).optional(),
  locationProvinceId: EntityIdSchema.optional(),
  polityId: EntityIdSchema.optional(),
}).strict().refine((value) => value.healthBps !== undefined || value.locationProvinceId !== undefined || value.polityId !== undefined, {
  message: "Character patch must change at least one field.",
});

const StorylinePatchSchema = z.object({
  kind: z.literal("create_storyline"),
  storylineId: EntityIdSchema,
  title: z.string().trim().min(1).max(160),
  participantIds: z.array(EntityIdSchema).max(16),
  provinceId: EntityIdSchema.nullable(),
  phase: z.string().trim().min(1).max(80),
  stakes: z.string().trim().min(1).max(320),
  nextDevelopment: z.string().trim().min(1).max(320),
  visibility: VisibilitySchema,
}).strict();

export const TemporaryWorkflowPatchSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  rationale: z.string().trim().min(1).max(600),
  actorId: EntityIdSchema,
  operations: z.array(z.discriminatedUnion("kind", [
    AccountDeltaPatchSchema,
    ProvinceControlPatchSchema,
    CharacterStatePatchSchema,
    StorylinePatchSchema,
  ])).min(1).max(6),
}).strict();
export type TemporaryWorkflowPatch = z.infer<typeof TemporaryWorkflowPatchSchema>;

export interface TemporaryPatchResult {
  readonly world: WorldState;
  readonly summary: string;
}

/** Apply a validated patch atomically, or return null when any target is invalid. */
export function applyTemporaryWorkflowPatch(
  world: WorldState,
  patch: TemporaryWorkflowPatch,
  atStep: number,
): TemporaryPatchResult | null {
  if (!world.characters.some((character) => character.id === patch.actorId && character.alive)) return null;
  let current = world;

  for (const operation of patch.operations) {
    if (operation.kind === "account_delta") {
      const account = current.material.accounts.find((candidate) => candidate.id === operation.accountId);
      if (!account || account.balance + operation.amount < 0) return null;
      const transaction = operation.amount > 0
        ? { id: globalThis.crypto.randomUUID(), atStep, kind: "income" as const, amount: operation.amount, destinationAccountId: account.id, cause: { kind: "action" as const, id: patch.actorId, explanation: operation.reason }, visibility: "private" as const }
        : { id: globalThis.crypto.randomUUID(), atStep, kind: "purchase" as const, amount: Math.abs(operation.amount), sourceAccountId: account.id, cause: { kind: "action" as const, id: patch.actorId, explanation: operation.reason }, visibility: "private" as const };
      current = {
        ...current,
        material: {
          ...current.material,
          accounts: current.material.accounts.map((candidate) => candidate.id === account.id ? { ...candidate, balance: candidate.balance + operation.amount } : candidate),
          transactions: [...current.material.transactions, transaction],
        },
      };
    } else if (operation.kind === "province_control") {
      if (!current.map.polities.some((polity) => polity.id === operation.controllerPolityId)) return null;
      if (!current.map.provinces.some((province) => province.id === operation.provinceId)) return null;
      current = {
        ...current,
        map: {
          ...current.map,
          provinces: current.map.provinces.map((province) => province.id === operation.provinceId
            ? { ...province, controllerPolityId: operation.controllerPolityId, controlFirmnessBps: operation.firmnessBps }
            : province),
        },
      };
    } else if (operation.kind === "character_state") {
      const character = current.characters.find((candidate) => candidate.id === operation.characterId);
      if (!character) return null;
      if (operation.locationProvinceId && !current.map.provinces.some((province) => province.id === operation.locationProvinceId)) return null;
      if (operation.polityId && !current.map.polities.some((polity) => polity.id === operation.polityId)) return null;
      current = {
        ...current,
        characters: current.characters.map((candidate) => candidate.id === operation.characterId
          ? { ...candidate, ...(operation.healthBps !== undefined ? { healthBps: operation.healthBps } : {}), ...(operation.locationProvinceId ? { locationProvinceId: operation.locationProvinceId } : {}), ...(operation.polityId ? { polityId: operation.polityId } : {}) }
          : candidate),
      };
    } else {
      if (current.storylines?.some((storyline) => storyline.id === operation.storylineId)) return null;
      if (operation.provinceId && !current.map.provinces.some((province) => province.id === operation.provinceId)) return null;
      if (operation.participantIds.some((id) => !current.characters.some((character) => character.id === id))) return null;
      current = {
        ...current,
        storylines: [...(current.storylines ?? []), {
          id: operation.storylineId,
          title: operation.title,
          participantIds: operation.participantIds,
          provinceId: operation.provinceId,
          phase: operation.phase,
          stakes: operation.stakes,
          history: [patch.rationale],
          nextDevelopment: operation.nextDevelopment,
          visibility: operation.visibility,
          updatedAtStep: atStep,
          type: "simulator" as const,
          initialPlan: null,
          causalEntryIds: [],
          turnsActive: 0,
          sourceDirector: "world_director" as const,
        }],
      };
    }
  }
  return { world: current, summary: `Temporary workflow patch applied: ${patch.title}.` };
}
