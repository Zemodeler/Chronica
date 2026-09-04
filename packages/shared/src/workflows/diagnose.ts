import type { WorldState } from "../world/world-state";

// Why a workflow declined, worked out after the fact.
//
// `apply` returning `null` says only "cannot be applied", which gives the
// caller nothing to correct: an order dies, the Game Master reports the
// failure, and the player reads a Chronicle entry about nothing happening.
// Converting ninety workflows to name their own reason is the thorough fix
// (see `refuse` in ./types); this is the one that covers all of them at once,
// because the overwhelmingly common cause is an id that does not exist.
//
// It reads the invocation's own arguments against the world's id space and
// reports the ones that resolve to nothing. It never guesses at logic: a
// workflow that declined for a real reason of its own simply produces no
// diagnosis here, and the caller falls back to the generic message.

/** Every id the world actually contains, by the kind of thing it names. */
function idIndex(world: WorldState): Map<string, string> {
  const index = new Map<string, string>();
  const add = (id: string | null | undefined, kind: string) => {
    if (typeof id === "string" && id.length > 0 && !index.has(id)) index.set(id, kind);
  };

  for (const polity of world.map.polities) add(polity.id, "polity");
  for (const province of world.map.provinces) {
    add(province.id, "province");
    for (const settlement of province.settlements) add(settlement.id, "settlement");
  }
  for (const character of world.characters) add(character.id, "character");
  for (const force of world.material.forces) add(force.id, "force");
  for (const account of world.material.accounts) add(account.id, "account");
  for (const institution of world.material.institutions) add(institution.id, "institution");
  for (const procedure of world.material.politicalProcedures) add(procedure.id, "political procedure");
  for (const requirement of world.material.eligibilityRequirements) add(requirement.id, "eligibility requirement");
  for (const seat of world.material.officeSeats) add(seat.id, "office seat");
  for (const battle of world.conflicts.battles) add(battle.battleId, "battle");
  for (const contract of world.lifeContracts) add(contract.id, "life contract");
  for (const storyline of world.storylines ?? []) add(storyline.id, "storyline");
  for (const goal of world.characterGoals ?? []) add(goal.id, "goal");
  for (const commitment of world.commitments ?? []) add(commitment.id, "commitment");
  return index;
}

/**
 * Parameters that name something new rather than something existing. An id
 * a workflow is about to *create* is supposed not to exist yet, so a
 * complaint that it is unknown would be exactly backwards.
 */
const CREATED_ID_KEYS = new Set([
  "battleId",
  "procedureId",
  "characterId",
  "storylineId",
  "contractId",
  "messageId",
  "forceId",
  "accountId",
  "goalId",
  "settlementId",
]);

/** Workflows that bring their key entity into being; their id arguments are names, not lookups. */
const CREATING_ACTIONS = new Set([
  "create_force",
  "create_world_character",
  "sponsor_procedure",
  "start_battle",
  "create_storyline",
  "open_account",
  "create_goal",
  "send_diplomatic_message",
  "found_settlement",
]);

export interface WorkflowDiagnosis {
  /** Reader-facing sentence naming what did not resolve, or null when nothing is obviously wrong. */
  readonly message: string | null;
}

export function diagnoseFailedInvocation(
  world: WorldState,
  actionId: string,
  parameters: unknown,
): WorkflowDiagnosis {
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) return { message: null };
  const index = idIndex(world);
  const creating = CREATING_ACTIONS.has(actionId);
  const unknown: string[] = [];

  for (const [key, value] of Object.entries(parameters as Record<string, unknown>)) {
    if (!/Id$|Ids$/.test(key)) continue;
    if (creating && CREATED_ID_KEYS.has(key)) continue;
    const candidates = typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    for (const candidate of candidates) {
      if (index.has(candidate)) continue;
      unknown.push(`${key} "${candidate}"`);
    }
  }

  if (unknown.length === 0) return { message: null };
  return {
    message: `Nothing in the world answers to ${unknown.join(", ")}. Inspect the entity to get its real id, then call ${actionId} again.`,
  };
}
