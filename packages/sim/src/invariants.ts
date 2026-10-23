import { normalizeName, rungOf, type Character, type WorldState } from "@chronica/shared";
import { auditMoney } from "./money-audit";

/**
 * What must hold across the world's records, whatever each record says on
 * its own (E10).
 *
 * Every record can be valid and the world still impossible: two crossings
 * each counting on the one fleet, a man serving in two armies at once, a
 * second Aristodemus of Messana made beside the first. The schema checks each
 * row; these check the rows against each other. Each is a sentence, so a
 * refusal can say what it would have broken, and each names the things it is
 * about, so an act is refused only for what it introduced.
 *
 * Each rule came from a fault a playtest met (docs/plans/engine-guarantees.md,
 * part 2). A sentence names things by what they are, never by what they hold,
 * so a fault already in the world reads the same after every unrelated act and
 * is not taken for a new one.
 */
export interface Violation {
  readonly rule: string;
  readonly sentence: string;
}

interface Invariant {
  readonly id: string;
  /**
   * Checked after every act the applier takes, which is refused if it breaks
   * the rule. A rule that only the engine's own bookkeeping can break, or that
   * costs too much to read after every act, is checked once a tick, a stage or
   * a batch instead.
   */
  readonly gate: boolean;
  /**
   * The collections the rule reads. The world is never changed in place, so a
   * rule whose collections are the very ones it read before gives the same
   * answer, and is not read again: the applier checks after every act, and
   * most acts touch one or two collections.
   */
  readonly reads: (world: WorldState) => readonly object[];
  readonly check: (world: WorldState) => string[];
}

const INVARIANTS: readonly Invariant[] = [
  {
    // One fleet, one voyage: a fleet already carrying an army somewhere cannot
    // be counted on to carry another at the same time.
    id: "fleet.one-voyage", gate: true,
    reads: (world) => [world.projects, world.material.forces],
    check: (world) => {
      const violations: string[] = [];
      const carrying = new Map<string, string>();
      for (const project of world.projects) {
        if (project.status !== "in_progress" && project.status !== "funded") continue;
        const outcome = project.completionOutcome;
        if (outcome?.kind !== "force_move") continue;
        for (const fleetId of outcome.fleetIds ?? []) {
          const other = carrying.get(fleetId);
          // Said by name: "force-hand-0-46 is counted on by both project-..." told
          // the player nothing he could act on.
          const fleet = world.material.forces.find((force) => force.id === fleetId)?.name ?? fleetId;
          const first = world.projects.find((candidate) => candidate.id === other)?.label ?? other;
          if (other !== undefined && other !== project.id) violations.push(`${fleet} is already carrying "${first}" and cannot also carry "${project.label}" at the same time`);
          else carrying.set(fleetId, project.id);
        }
      }
      return violations;
    },
  },
  {
    // A man stands in one army's ranks at a time.
    id: "force.one-army-a-man", gate: true,
    reads: (world) => [world.material.forces],
    check: (world) => {
      const violations: string[] = [];
      const serving = new Map<string, string>();
      for (const force of world.material.forces) {
        for (const memberId of force.memberCharacterIds) {
          const other = serving.get(memberId);
          if (other !== undefined && other !== force.id) violations.push(`${memberId} serves in both ${other} and ${force.id}`);
          else serving.set(memberId, force.id);
        }
      }
      return violations;
    },
  },
  {
    // Two living people of one power with one name are one person made twice,
    // unless the world already had them both.
    id: "person.made-once", gate: true,
    reads: (world) => [world.characters],
    check: (world) => {
      const violations: string[] = [];
      const named = new Map<string, string>();
      for (const character of world.characters) {
        const key = personKey(character);
        if (key === null) continue;
        const other = named.get(key);
        if (other !== undefined) violations.push(`${other} and ${character.id} are the same person of ${character.polityId}, "${character.name}", made twice`);
        else named.set(key, character.id);
      }
      return violations;
    },
  },
  {
    // A seat is held by a living man (hand run L5: the dead stayed in the office list).
    id: "office.held-by-the-living", gate: true,
    reads: (world) => [world.material.officeSeats, world.characters],
    check: (world) => {
      const alive = new Map(world.characters.map((character) => [character.id, character.alive]));
      return world.material.officeSeats
        .filter((seat) => seat.status === "held" && seat.holderCharacterId !== null && alive.get(seat.holderCharacterId) !== true)
        .map((seat) => `${seat.holderCharacterId} holds ${seat.officeId} (seat ${seat.id}) and is not among the living`);
    },
  },
  {
    // One magistracy of the ladder at a time, held or named to (one election day made Arvina praetor and quaestor).
    id: "office.one-magistracy", gate: true,
    reads: (world) => [world.material.officeSeats],
    check: (world) => {
      const violations: string[] = [];
      const first = new Map<string, string>();
      for (const seat of world.material.officeSeats) {
        if (rungOf(seat.officeId) === undefined) continue;
        const men = new Set([seat.status === "held" ? seat.holderCharacterId : null, seat.designateCharacterId ?? null]);
        for (const man of men) {
          if (man === null) continue;
          const other = first.get(man);
          if (other !== undefined && other !== seat.officeId) violations.push(`${man} holds or is named to both ${other} and ${seat.officeId}`);
          else first.set(man, seat.officeId);
        }
      }
      return violations;
    },
  },
  {
    // Two powers are not at once at war and allied, and keep one truce between them at a time (hand run M8; a truce extends).
    id: "diplomacy.one-footing", gate: true,
    reads: (world) => [world.polityAgreements],
    check: (world) => {
      const violations: string[] = [];
      const kinds = new Map<string, string[]>();
      for (const agreement of world.polityAgreements) {
        if (agreement.status !== "active") continue;
        const pair = [agreement.polityId, agreement.otherPolityId].sort().join(" and ");
        kinds.set(pair, [...(kinds.get(pair) ?? []), agreement.kind]);
      }
      for (const [pair, held] of kinds) {
        if (held.includes("war") && held.includes("alliance")) violations.push(`${pair} are both at war and allied`);
        if (held.filter((kind) => kind === "truce").length > 1) violations.push(`${pair} keep more than one truce`);
      }
      return violations;
    },
  },
  {
    // A power that has ended is party to nothing (consul run M7: a united ally kept its foedus) and keeps no army.
    id: "polity.ended-holds-nothing", gate: true,
    reads: (world) => [world.map.polities, world.polityAgreements, world.material.forces],
    check: (world) => {
      const ended = new Set(world.map.polities.filter((polity) => polity.endedAtStep != null).map((polity) => polity.id));
      if (ended.size === 0) return [];
      const violations: string[] = [];
      for (const agreement of world.polityAgreements) {
        if (agreement.status !== "active") continue;
        for (const party of [agreement.polityId, agreement.otherPolityId]) {
          if (ended.has(party)) violations.push(`${party} has ended and is still party to the ${agreement.kind} ${agreement.id}`);
        }
      }
      for (const force of world.material.forces) {
        if (ended.has(force.polityId) && force.outlaw !== true) violations.push(`${force.polityId} has ended and still keeps ${force.name} (${force.id})`);
      }
      return violations;
    },
  },
  {
    // An id names one thing (the handle machinery can make a second row under an id already taken).
    id: "ids.unique", gate: false,
    reads: (world) => [world.characters, world.material.forces, world.material.accounts, world.material.obligations, world.material.officeSeats, world.polityAgreements, world.genericEntities, world.projects, world.orders, world.material.transactions],
    check: (world) => {
      const collections: readonly [string, readonly { readonly id: string }[]][] = [
        ["character", world.characters], ["force", world.material.forces], ["account", world.material.accounts],
        ["obligation", world.material.obligations], ["office seat", world.material.officeSeats], ["agreement", world.polityAgreements],
        ["arrangement", world.genericEntities], ["project", world.projects], ["order", world.orders], ["money line", world.material.transactions],
      ];
      return collections.flatMap(([what, rows]) => duplicateIds(rows).map((id) => `two ${what} rows share the id ${id}`));
    },
  },
];

/**
 * The key a living person of two names or more is known by in his power, or null (`person.made-once`): kept per row, for the
 * characters change with nearly every act and their names almost never.
 */
const personKeys = new WeakMap<Character, string | null>();
function personKey(character: Character): string | null {
  const kept = personKeys.get(character);
  if (kept !== undefined) return kept;
  // A single name is shared by many: Hanno is a dozen men of Carthage.
  const key = !character.alive || character.name.trim().split(/\s+/).length < 2 ? null : `${character.polityId}:${normalizeName(character.name)}`;
  personKeys.set(character, key);
  return key;
}

/** The ids a collection holds twice, kept per collection (`ids.unique`): an act changes one or two, and the rest are not read again. */
const duplicatesIn = new WeakMap<readonly { readonly id: string }[], string[]>();
function duplicateIds(rows: readonly { readonly id: string }[]): string[] {
  const kept = duplicatesIn.get(rows);
  if (kept !== undefined) return kept;
  const seen = new Set<string>();
  const twice: string[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) twice.push(row.id);
    seen.add(row.id);
  }
  duplicatesIn.set(rows, twice);
  return twice;
}

/**
 * What each rule found, by the collections it read: a tree of weak maps, one level a collection. Two readings were kept, and the
 * applier's check after each act, the batch's, the tick's and the stage's took turns pushing out the one the next would ask for.
 */
const readings = new Map<string, WeakMap<object, unknown>>();

function readRule(invariant: Invariant, world: WorldState, reads: readonly object[] = invariant.reads(world)): string[] {
  let level = readings.get(invariant.id);
  if (level === undefined) readings.set(invariant.id, (level = new WeakMap()));
  for (const read of reads.slice(0, -1)) {
    let deeper = level.get(read) as WeakMap<object, unknown> | undefined;
    if (deeper === undefined) level.set(read, (deeper = new WeakMap()));
    level = deeper;
  }
  const last = reads[reads.length - 1]!;
  const kept = level.get(last) as string[] | undefined;
  if (kept !== undefined) return kept;
  const found = invariant.check(world);
  level.set(last, found);
  return found;
}

/** Every rule the world breaks, gate rules and the rest. */
export function findViolations(world: WorldState, only: "gate" | "all" = "all"): Violation[] {
  const violations: Violation[] = [];
  for (const invariant of INVARIANTS) {
    if (only === "gate" && !invariant.gate) continue;
    for (const sentence of readRule(invariant, world)) violations.push({ rule: invariant.id, sentence });
  }
  return violations;
}

/** The rules an act is refused for breaking, as sentences (`applyDeltas`). */
export function findInvariantViolations(world: WorldState): string[] {
  return findViolations(world, "gate").map((violation) => violation.sentence);
}

/** What `after` breaks that `before` did not. A rule whose collections the step left as they were is not read at all. */
export function newViolations(before: WorldState, after: WorldState): Violation[] {
  const violations: Violation[] = [];
  for (const invariant of INVARIANTS) {
    const was = invariant.reads(before);
    const now = invariant.reads(after);
    if (now.every((read, index) => read === was[index])) continue;
    const already = new Set(readRule(invariant, before, was));
    for (const sentence of readRule(invariant, after, now)) if (!already.has(sentence)) violations.push({ rule: invariant.id, sentence });
  }
  return violations;
}

/**
 * Men an act raised or hired are paid by somebody (round 9, E-C: three thousand men raised for Epirus in a fortnight and the
 * treasury never changed). Not a rule of the whole world: the scenario's Campanians at Rhegium are paid by nobody by design, a
 * power that defaults leaves its armies unpaid, a company whose contract ends goes back unpaid to its old master, and an ally's
 * contingent is not Rome's to pay. What an act makes is the thing to hold: a force the applier made, of a power with a treasury,
 * is paid by an obligation or a contract, unless it is outlaw or a man's own.
 */
export function unpaidNewForces(before: WorldState, after: WorldState): Violation[] {
  if (before.material.forces === after.material.forces) return [];
  const existed = new Set(before.material.forces.map((force) => force.id));
  const made = after.material.forces.filter((force) => !existed.has(force.id) && force.outlaw !== true && force.private !== true && force.personnel.some((row) => row.fit > 0));
  if (made.length === 0) return [];
  const active = new Set(after.material.obligations.filter((obligation) => obligation.active).map((obligation) => obligation.id));
  const treasuries = new Set(after.material.accounts.filter((account) => account.owner.kind === "polity" && account.status === "active").map((account) => account.owner.id));
  const hired = new Set(after.material.contracts.filter((contract) => contract.status === "active" && contract.forceId !== null).map((contract) => contract.forceId));
  return made
    .filter((force) => treasuries.has(force.polityId) && !hired.has(force.id) && (force.payObligationId === null || !active.has(force.payObligationId)))
    .map((force) => ({ rule: "force.raised-paid", sentence: `${force.name} (${force.id}) was raised and nobody pays them` }));
}

/** The rule ids, for tests that make sure each one is caught. */
export const INVARIANT_IDS: readonly string[] = INVARIANTS.map((invariant) => invariant.id);

/**
 * Strict: a broken rule stops the engine. Set (`CHRONICA_STRICT=1`) in every
 * test run, sanity script and hand-run harness, so a fault is met where it is
 * made and not five playtests later. Unset, in a player's game, the step that
 * broke it is set aside and the fault is written down and logged.
 */
export function isStrict(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.["CHRONICA_STRICT"] === "1";
}

export class InvariantBroken extends Error {
  constructor(readonly stage: string, readonly violations: readonly Violation[]) {
    super(`[chronica] ${stage} broke ${violations.length} rule(s) of the world: ${violations.slice(0, 5).map((violation) => `${violation.rule}: ${violation.sentence}`).join("; ")}`);
    this.name = "InvariantBroken";
  }
}

/**
 * What one step of the engine broke: the rules, and the money it moved with no
 * line to say why (`auditMoney`). Strict, it throws; otherwise it returns the
 * faults, for the caller to set the step aside and say so.
 */
export function checkStep(stage: string, before: WorldState, after: WorldState, options: { readonly money?: boolean; readonly acts?: boolean } = {}): Violation[] {
  if (before === after) return [];
  const broken = [...newViolations(before, after), ...(options.acts === true ? unpaidNewForces(before, after) : [])];
  // No account and no line changed: no money moved.
  const moved = before.material.accounts !== after.material.accounts || before.material.transactions !== after.material.transactions;
  if (options.money !== false && moved) {
    for (const entry of auditMoney(before, after).unexplained) {
      broken.push({ rule: "money.conserved", sentence: `${entry.accountId ?? "a line with no account"}: ${entry.note} (${entry.amount})` });
    }
  }
  if (broken.length > 0 && isStrict()) throw new InvariantBroken(stage, broken);
  return broken;
}
