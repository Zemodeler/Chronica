import { buildStation, seesForce, type Station } from "../authority/station";
import type { Office } from "../characters/character";
import { standingEffectiveStrength } from "../warfare/battle-resolver";
import type { ScenarioWarfareRules } from "../warfare/battle";
import { isNavalForce, transportCapacityOf } from "../warfare/sea";
import type { Force, ForcePersonnelCategory } from "../material-state";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import { moraleInWords, payInWords, provisionInWords } from "./in-words";

/**
 * The muster, as the man responsible for it can read it.
 *
 * `ForceViewSchema` has been specified in material-view.ts since the economy
 * was built and never had a consumer but a fixture. Meanwhile the only way a
 * player could learn anything about an army was to click its standard on the
 * map, where they were shown `authorizedStrength` -- the establishment on
 * paper. A legion that had lost half its men at Agrigentum still read as four
 * thousand strong, and the slice's own comment says so: the paper figure
 * diverges from fit personnel the moment anybody fights.
 *
 * Station-filtered like the books, and filtered the way the slice filters --
 * which is two steps, not one. `seesForce` ends in `speaksForPolity`, so on
 * its own it answers true for every force in the world once you speak for a
 * power in military matters: a consul was reading Carthage's morale, supply
 * and pay status off his own muster roll. The hatch is meant to widen your
 * sight *within* your own power, so the polity filter comes first and
 * `seesForce` decides only what you may read of what is yours. `slice.ts`
 * does exactly this, and a player and the model must not be told different
 * things.
 *
 * A force you personally command is yours whatever flag it is under, so it
 * survives the polity filter on its own account.
 *
 * Every reading is in words. A commander knows his men are sullen and short
 * of supply; he does not know they are at 3,500 of 10,000.
 */

/** How many days back counts as "since you last looked". */
const RECENT_STEPS = 30;

/** What a personnel event did, said the way a report would say it. */
const EVENT_WORDS: Readonly<Record<string, (n: number) => string>> = {
  battle_death: (n) => `${n} killed in action`,
  wounds_death: (n) => `${n} dead of their wounds or sent home maimed`,
  attrition_death: (n) => `${n} dead of disease and hardship`,
  desertion: (n) => `${n} deserted`,
  capture: (n) => `${n} taken prisoner`,
  reinforcement: (n) => `${n} joined`,
  unavailable: (n) => `${n} unfit for duty`,
  recovery: (n) => `${n} returned to the ranks`,
};

export interface ForceReading {
  readonly id: string;
  readonly name: string;
  readonly commanderLabel: string;
  /** The establishment on paper. */
  readonly authorizedStrength: number;
  readonly totalHeadcount: number;
  readonly fitStrength: number;
  /** What they are actually worth standing where they are -- the number a battle opens with. */
  readonly effectiveStrength: number;
  readonly unavailable: number;
  readonly moraleLabel: string;
  readonly provisionLabel: string;
  readonly provisionedThroughLabel: string;
  readonly payStatus: string;
  readonly changeExplanation: string;
  readonly locationLabel: string;
  readonly destinationLabel: string;
  readonly arrivalLabel: string | null;
  /**
   * A fleet. Its `fitStrength` is hulls, not men: a naval category counts
   * ships (`transportPerHead` is men per hull), and a squadron of fifty read
   * on the muster as "50 men".
   */
  readonly naval: boolean;
  /** How many men its ships can carry across water. Zero for an army. */
  readonly carries: number;
}

export interface Muster {
  readonly forces: readonly ForceReading[];
  /** True when these are a state's armies rather than one man's retinue. */
  readonly theirGovernments: boolean;
}

const fitOf = (personnel: readonly ForcePersonnelCategory[]): number =>
  personnel.reduce((sum, category) => sum + category.fit, 0);

const unavailableOf = (personnel: readonly ForcePersonnelCategory[]): number =>
  personnel.reduce((sum, category) => sum + category.unavailable.reduce((n, group) => n + group.count, 0), 0);

/**
 * What has happened to these men lately, in one sentence.
 *
 * Folded by kind rather than listed event by event: a commander reads "forty
 * killed, twelve deserted", not forty separate lines. The schema requires a
 * non-empty string, and "nothing" is itself worth saying.
 */
function explainChange(force: Force, elapsedStep: number): string {
  const counts = new Map<string, number>();
  for (const event of force.history) {
    if (event.atStep < elapsedStep - RECENT_STEPS) continue;
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + event.count);
  }
  const clauses = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => EVENT_WORDS[kind]?.(n) ?? `${n} ${kind}`);
  if (clauses.length === 0) return "Nothing has changed since you last looked.";
  return `${clauses.join("; ")}.`;
}

/**
 * Where a force is going.
 *
 * A march is not a field on `Force` -- it is an open project whose completion
 * moves the army. Anyone looking for `destinationProvinceId` will not find
 * one, and inventing a second place to record it would put the map and the
 * muster at odds.
 */
function whereBound(
  world: WorldState,
  force: Force,
  provinceName: (id: string) => string,
  clock: ScenarioClock | undefined,
): { readonly destinationLabel: string; readonly arrivalLabel: string | null } {
  const march = world.projects.find((project) =>
    (project.status === "funded" || project.status === "in_progress")
    && project.completionOutcome?.kind === "force_move"
    && project.completionOutcome.forceId === force.id
    && project.completionOutcome.provinceId !== null);
  const bound = march?.completionOutcome?.provinceId ?? null;
  if (march === undefined || bound === null) return { destinationLabel: "Holding position.", arrivalLabel: null };
  return {
    destinationLabel: `Marching on ${provinceName(bound)}`,
    arrivalLabel: march.targetCompletionStep === null || clock === undefined
      ? null
      : formatWorldDate({ day: march.targetCompletionStep, minute: 0 }, clock),
  };
}

export function musterTheForces(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
  warfare?: ScenarioWarfareRules,
): Muster {
  const station: Station | null = characterId === null ? null : buildStation({ world, characterId, offices });
  const reaches = (forceId: string): boolean => station === null || seesForce(station, forceId);

  const nameOf = (id: string): string => world.characters.find((c) => c.id === id)?.name ?? id;
  const provinceName = (id: string): string => world.map.provinces.find((p) => p.id === id)?.name ?? id;
  const obligationOf = (id: string | null) =>
    id === null ? undefined : world.material.obligations.find((o) => o.id === id);
  /** Whether an army's wages are drawn on its own chest. */
  const paysItself = (forceId: string, obligationId: string | null): boolean => {
    const payer = obligationOf(obligationId)?.payerAccountId;
    if (payer === undefined) return false;
    const account = world.material.accounts.find((candidate) => candidate.id === payer);
    return account?.owner.kind === "force" && account.owner.id === forceId;
  };

  const ownPolity = characterId === null
    ? null
    : world.characters.find((character) => character.id === characterId)?.polityId ?? null;

  const forces = world.material.forces
    .filter((force) => ownPolity === null
      || force.polityId === ownPolity
      || station?.forceIds.has(force.id) === true)
    .filter((force) => reaches(force.id))
    .map((force): ForceReading => {
      const fitStrength = fitOf(force.personnel);
      const unavailable = unavailableOf(force.personnel);
      const bound = whereBound(world, force, provinceName, clock);
      return {
        id: force.id,
        name: force.name,
        commanderLabel: nameOf(force.commanderCharacterId),
        authorizedStrength: force.authorizedStrength,
        fitStrength,
        unavailable,
        totalHeadcount: fitStrength + unavailable,
        effectiveStrength: Math.round(standingEffectiveStrength(force, warfare)),
        moraleLabel: moraleInWords(force.moraleBps),
        provisionLabel: provisionInWords(force.provisionStatus),
        provisionedThroughLabel: clock === undefined
          ? `Day ${force.provisionedThroughStep}`
          : formatWorldDate({ day: force.provisionedThroughStep, minute: 0 }, clock),
        payStatus: payInWords(
          obligationOf(force.payObligationId),
          force.payArrearsPeriods,
          paysItself(force.id, force.payObligationId),
        ),
        changeExplanation: explainChange(force, world.elapsedStep),
        locationLabel: provinceName(force.locationId),
        ...bound,
        naval: isNavalForce(force, warfare),
        carries: isNavalForce(force, warfare) ? transportCapacityOf(force, warfare) : 0,
      };
    })
    .sort((a, b) => b.fitStrength - a.fitStrength || a.name.localeCompare(b.name));

  return { forces, theirGovernments: station !== null && station.polityId !== null };
}
