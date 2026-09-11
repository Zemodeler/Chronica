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

interface IndexedEntity {
  readonly kind: string;
  /** The entity's display name, when it has one. Used only for repair, never for diagnosis. */
  readonly name: string | null;
}

/** Every id the world actually contains, by the kind of thing it names. */
function idIndex(world: WorldState): Map<string, IndexedEntity> {
  const index = new Map<string, IndexedEntity>();
  const add = (id: string | null | undefined, kind: string, name?: string | null) => {
    if (typeof id === "string" && id.length > 0 && !index.has(id)) index.set(id, { kind, name: name ?? null });
  };

  for (const polity of world.map.polities) add(polity.id, "polity", polity.name);
  for (const province of world.map.provinces) {
    add(province.id, "province", province.name);
    for (const settlement of province.settlements) add(settlement.id, "settlement", settlement.name);
  }
  for (const character of world.characters) add(character.id, "character", character.name);
  for (const force of world.material.forces) add(force.id, "force", force.name);
  for (const account of world.material.accounts) add(account.id, "account");
  for (const institution of world.material.institutions) add(institution.id, "institution");
  for (const procedure of world.material.politicalProcedures) add(procedure.id, "political procedure");
  for (const requirement of world.material.eligibilityRequirements) add(requirement.id, "eligibility requirement");
  for (const seat of world.material.officeSeats) add(seat.id, "office seat");
  for (const battle of world.conflicts.battles) add(battle.battleId, "battle");
  for (const contract of world.lifeContracts) add(contract.id, "life contract");
  for (const storyline of world.storylines ?? []) add(storyline.id, "storyline", storyline.title);
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

// -- automatic repair --------------------------------------------------------
//
// Diagnosis tells the caller what did not resolve. Repair goes one step
// further and resolves it, when the world leaves exactly one possible answer.
//
// The failure this exists for: a siege ordered against "messana" is refused
// because the authoritative id is "settlement-messana". Nothing about the
// world said no -- one string was written the way a person says it rather
// than the way the record stores it. Left alone that becomes a Chronicle
// entry about an order nobody heard, which is a lie about the world.
//
// Deliberately conservative. A guess is repaired only when the world contains
// exactly one entity it could mean, of the kind the parameter requires. Two
// candidates, or none, and this returns null: an ambiguous repair that picks
// the wrong province is far worse than a failure the caller can see.

/**
 * Parameter-key suffix -> the kind of entity that key must name, so
 * `answeredByCharacterId` can only ever be repaired to a character. Keys with
 * no entry here (`targetId`) are matched against the whole id space instead.
 */
const KEY_KIND_BY_SUFFIX: readonly (readonly [string, string])[] = [
  ["settlementid", "settlement"],
  ["provinceid", "province"],
  ["polityid", "polity"],
  ["characterid", "character"],
  ["forceid", "force"],
  ["accountid", "account"],
  ["institutionid", "institution"],
  ["procedureid", "political procedure"],
  ["battleid", "battle"],
  ["storylineid", "storyline"],
  ["goalid", "goal"],
  ["commitmentid", "commitment"],
  ["seatid", "office seat"],
  ["contractid", "life contract"],
];

function expectedKind(key: string): string | null {
  const normalized = key.toLowerCase().replace(/s$/, "");
  for (const [suffix, kind] of KEY_KIND_BY_SUFFIX) {
    if (normalized.endsWith(suffix)) return kind;
  }
  return null;
}

/** Casing, underscores, and hyphens are spelling, not identity. */
function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function segments(id: string): string[] {
  return id.split(/[-_]/).map(normalizeToken).filter((segment) => segment.length > 0);
}

/**
 * Whether `outer` is `inner` plus a type prefix or suffix, and nothing else:
 * "settlement-messana" against "messana". Segment-aligned on purpose, so
 * "rome" may resolve to "polity-rome" but never to "romeo-of-syracuse" on a
 * bare substring match.
 */
function isAffixOf(inner: string, outer: string, outerSegments: readonly string[]): boolean {
  const normalizedInner = normalizeToken(inner);
  const normalizedOuter = normalizeToken(outer);
  if (!normalizedOuter.endsWith(normalizedInner) && !normalizedOuter.startsWith(normalizedInner)) return false;
  return outerSegments.includes(normalizedInner);
}

/**
 * Every real id the guess could plausibly be a misspelling of: the same id in
 * different punctuation, the same id with a type prefix the guess dropped (or
 * added), or the entity's own display name written instead of its id.
 */
function resolutionCandidates(guess: string, index: Map<string, IndexedEntity>, kind: string | null): string[] {
  const normalizedGuess = normalizeToken(guess);
  if (normalizedGuess.length === 0) return [];
  const guessSegments = segments(guess);
  const matches = new Set<string>();

  for (const [id, entity] of index) {
    if (kind !== null && entity.kind !== kind) continue;
    if (normalizeToken(id) === normalizedGuess) {
      matches.add(id);
      continue;
    }
    // Either direction: the guess dropped the type prefix the real id
    // carries, or it invented one the real id does not.
    if (isAffixOf(guess, id, segments(id)) || isAffixOf(id, guess, guessSegments)) {
      matches.add(id);
      continue;
    }
    if (entity.name !== null && normalizeToken(entity.name) === normalizedGuess) matches.add(id);
  }
  return [...matches];
}

export interface InvocationRepair {
  /** The parameters with every unresolvable id replaced by the one it could have meant. */
  readonly parameters: Record<string, unknown>;
  /** `provinceId "messana" -> "settlement-messana"`, for the audit trail. */
  readonly repairs: readonly string[];
}

/**
 * Rewrite an invocation's unresolvable ids into the real ones, or return null
 * when that cannot be done unambiguously for every one of them.
 *
 * All-or-nothing on purpose: repairing two ids out of three produces a call
 * that fails for the remaining one anyway, having spent a retry to get there.
 */
export function repairInvocationIds(
  world: WorldState,
  actionId: string,
  parameters: unknown,
): InvocationRepair | null {
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) return null;
  const index = idIndex(world);
  const creating = CREATING_ACTIONS.has(actionId);
  const repaired: Record<string, unknown> = { ...(parameters as Record<string, unknown>) };
  const repairs: string[] = [];

  for (const [key, value] of Object.entries(parameters as Record<string, unknown>)) {
    if (!/Id$|Ids$/.test(key)) continue;
    if (creating && CREATED_ID_KEYS.has(key)) continue;
    const kind = expectedKind(key);

    if (typeof value === "string") {
      if (index.has(value)) continue;
      const candidates = resolutionCandidates(value, index, kind);
      if (candidates.length !== 1) return null;
      repaired[key] = candidates[0]!;
      repairs.push(`${key} "${value}" -> "${candidates[0]!}"`);
      continue;
    }

    if (!Array.isArray(value)) continue;
    const entries = [...value];
    let changed = false;
    for (let position = 0; position < entries.length; position += 1) {
      const entry = entries[position];
      if (typeof entry !== "string" || index.has(entry)) continue;
      const candidates = resolutionCandidates(entry, index, kind);
      if (candidates.length !== 1) return null;
      entries[position] = candidates[0]!;
      repairs.push(`${key} "${entry}" -> "${candidates[0]!}"`);
      changed = true;
    }
    if (changed) repaired[key] = entries;
  }

  return repairs.length === 0 ? null : { parameters: repaired, repairs };
}
