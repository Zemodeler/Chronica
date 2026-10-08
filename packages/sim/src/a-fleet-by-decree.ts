import {
  WorldDeltaSchema,
  nearestShore,
  fitStrengthOf,
  monthlyTakings,
  warsOf,
  type Character,
  type Doctrine,
  type MilitaryReform,
  type PoliticalProcedure,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { weigh, type Matter } from "./fiscal-officers";
import { chestOfPower } from "./supply-plan";
import { safeLocalId } from "./safe-local-id";
import type { StatecraftDecision, StatecraftInput } from "./statecraft";

/**
 * A fleet by decree, and the corvus (docs/plans/war-plans.md, "Rome at sea"; the sources are Polybius 1.20-23).
 *
 * Rome in 270 had no fleet of its own: the hulls of Tarentum, Neapolis, Locri and Velia carried its armies (`socii-navales.ts`). When the war with Carthage was on
 * and the sea was Carthage's, the Senate had a hundred quinqueremes and twenty triremes built on the model of a wrecked Carthaginian ship, the rowers trained on
 * benches ashore (Polybius 1.20.9-16); and the sailors found the boarding-bridge, the corvus, which turned a sea fight into a land fight (1.22). Here a power by rule that is at war with
 * a sea power and has no fleet of its own lays the question before the chamber that holds the purse -- or builds it, where the ruler may -- and, once it has its ships, the
 * boarding-bridge is put to the chamber the same way as a way of war (`MilitaryReform`, `military-reform.ts`). The player's order "build a fleet" is read by the same
 * measure (`order-templates.ts`). The hulls are men of the levy (the project's outcome raises them, `tick.ts`), and cost their price in the chest.
 */

/** A hundred quinqueremes and twenty triremes (Polybius 1.20.9). */
export const FLEET_HULLS = 120;
/** What a hull costs the chest, building and fitting, in the scenario's drachmae: a quinquereme was some two talents of timber, iron and labour in the age, six thousand drachmae to the talent. */
export const HULL_COST = 12_000;
/** The least a fleet's yard takes: timber to fell and season, then the building, then the benches. */
/** Each stage falls due this many days after the work begins: sixty, a hundred and ten, a hundred and fifty. */
const STAGES: readonly { readonly label: string; readonly days: number; readonly share: number }[] = [
  { label: "Timber felled and the keels laid on the model of the Carthaginian ship", days: 60, share: 0.4 },
  { label: "The hulls built and launched", days: 110, share: 0.35 },
  { label: "The rowers trained on benches ashore, and the ships manned", days: 150, share: 0.25 },
];

/** The words of the question the chamber is asked. */
export const FLEET_MOTION = "a fleet of a hundred quinqueremes and twenty triremes be built";
export const CORVUS_MOTION = "the boarding-bridge be fitted to the ships of the fleet";

/** The boarding-bridge as a way of war (Polybius 1.22): a gain at sea in close, paid for in the speed and the sea-keeping of the ship. */
export const THE_CORVUS: MilitaryReform = {
  adopt: [{
    label: "The corvus",
    description: "A boarding-bridge raised on a mast in the bow, with a spike to bite the enemy's deck: a ship that closes is held fast, and the legionaries cross to fight it out as on land (Polybius 1.22). The ship is heavy in the bows, slow and unsafe in a sea.",
    effects: [{ lever: "boarding", direction: "raise", band: "marked" }, { lever: "march_speed", direction: "lower", band: "marked" }],
    kinds: ["warship"],
  }],
};

/** Whether one power's ships are the better handled: it holds a way of war that raises what its crews' drill can come to, and the other holds none. */
const seamanshipOf = (world: WorldState, polityId: string): boolean => world.doctrines.some((doctrine) => doctrine.polityId === polityId && doctrine.lapsedAtStep === null
  && doctrine.appliesTo?.categoryIds?.includes("warship") === true && doctrine.effects.some((effect) => effect.lever === "drill_ceiling" && effect.direction === "raise"));
const beatsAtSeamanship = (world: WorldState, polityId: string, otherId: string): boolean => seamanshipOf(world, polityId) && !seamanshipOf(world, otherId);

const warships = (world: WorldState, polityId: string) => world.material.forces.filter((force) => force.polityId === polityId && force.outlaw !== true && force.personnel.some((row) => row.categoryId === "warship" && row.fit > 0));

/** Whether a shipbuilding work of this power is on, or was moved and not yet decided. */
function buildingAFleet(world: WorldState, polityId: string): boolean {
  const chest = chestOfPower(world, polityId);
  if (world.projects.some((project) => project.kind === "shipbuilding" && project.status !== "completed" && project.status !== "cancelled"
    && (project.fundingAccountId === chest || project.sponsorEntityRef.id === polityId))) return true;
  return world.material.politicalProcedures.some((procedure) => procedure.outcome === null && procedure.resolvedAtStep === null && /\ba fleet of\b/iu.test(procedure.label)
    && world.material.institutions.some((institution) => institution.id === procedure.institutionId && institution.polityId === polityId));
}

/** The sea powers a power is at war with: the enemies that have ships of war afloat. */
export const navalEnemiesOf = (world: WorldState, polityId: string): string[] => warsOf(world.polityAgreements, polityId)
  .filter((enemy) => warships(world, enemy).reduce((sum, force) => sum + fitStrengthOf(force), 0) >= 40).sort();

/** The shore a fleet is built on: the nearest harbour to the power's capital that is its own. */
export function yardOf(world: WorldState, polityId: string): string | null {
  const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  const home = world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))
    ?? world.map.provinces.find((province) => province.controllerPolityId === polityId);
  if (home === undefined) return null;
  const shore = nearestShore(world, home.id);
  return world.map.provinces.some((province) => province.id === shore) ? shore : home.id;
}

export interface FleetWork {
  readonly kind: "shipbuilding";
  readonly label: string;
  readonly fundingAccountRef: string;
  readonly milestones: readonly { readonly label: string; readonly dueInDays: number; readonly costAmount: number }[];
  readonly completionOutcome: { readonly kind: "force"; readonly label: string; readonly amount: number; readonly provinceId: string; readonly polityId: string; readonly commanderCharacterRef: string; readonly categoryId: "warship" };
  readonly total: number;
}

/**
 * The shipbuilding work for a fleet of this many hulls, paid out of the power's chest, or null where the power has no chest or no harbour. The cost is the hulls' price, and
 * never more than the chest can bear in a season (three-fifths of it), so that a poor power builds a smaller fleet and says so.
 */
export function fleetWork(world: WorldState, polityId: string, commanderId: string, wanted = FLEET_HULLS): FleetWork | null {
  const chest = chestOfPower(world, polityId);
  const yard = yardOf(world, polityId);
  if (chest === null || yard === null) return null;
  const balance = world.material.accounts.find((account) => account.id === chest)?.balance ?? 0;
  const hulls = Math.max(0, Math.min(wanted, Math.floor((balance * 0.6) / HULL_COST)));
  if (hulls < 10) return null;
  const total = hulls * HULL_COST;
  const polity = world.map.polities.find((candidate) => candidate.id === polityId)?.name ?? polityId;
  const milestones = STAGES.map((stage, index) => ({ label: stage.label, dueInDays: stage.days, costAmount: index === STAGES.length - 1 ? total - STAGES.slice(0, -1).reduce((sum, earlier) => sum + Math.round(total * earlier.share), 0) : Math.round(total * stage.share) }));
  const label = `The new fleet of ${polity}`.slice(0, 120);
  return { kind: "shipbuilding", label, fundingAccountRef: chest, milestones, completionOutcome: { kind: "force", label, amount: hulls, provinceId: yard, polityId, commanderCharacterRef: commanderId, categoryId: "warship" }, total };
}

/** The work, written as the act that begins it. */
export const fleetBegun = (work: FleetWork, polityId: string, by: Character): WorldDelta => WorldDeltaSchema.parse({
  op: "project_create", localId: safeLocalId(`fleet_${polityId}`).slice(0, 60), kind: work.kind, label: work.label, sponsorRef: { kind: "polity", id: polityId }, fundingAccountRef: work.fundingAccountRef,
  milestones: work.milestones, completionOutcome: work.completionOutcome, reason: `${by.name} has the keels laid.`.slice(0, 240),
});

const motionOf = (world: WorldState, polityId: string): readonly PoliticalProcedure[] => world.material.politicalProcedures.filter((procedure) => world.material.institutions.some((institution) => institution.id === procedure.institutionId && institution.polityId === polityId));

/** What the chamber is moved, with the work or the reform it will carry out the day it carries. */
function withWhatItEnacts(asked: { readonly delta: WorldDelta }, enacts: Record<string, unknown>): WorldDelta {
  return WorldDeltaSchema.parse({ ...asked.delta, enacts });
}

/**
 * A power at war with a sea power, with no fleet and none begun, moves the building of one; with a fleet and no boarding-bridge, moves that. For a ruler nobody plays.
 * One decision a month for a power, none while the thing is before the chamber, and none for a season after it was refused (`weigh`).
 */
export function decideAFleet(input: Pick<StatecraftInput, "world" | "excludedPolityIds" | "playedByModel" | "playerCharacterId" | "offices">, rulerOf: (polityId: string) => Character | undefined): StatecraftDecision[] {
  const { world } = input;
  const day = world.instant.day;
  const decisions: StatecraftDecision[] = [];
  for (const polity of world.map.polities) {
    if (decisions.length >= 2 || input.excludedPolityIds.has(polity.id)) continue;
    const ruler = rulerOf(polity.id);
    // A fleet is the state's decree, not the man's play: it is moved for a power whose consul the model plays as well (he is in the cast, and the rules stand back from him in everything else), unless the player is the ruler (`excludedPolityIds`).
    if (ruler === undefined) continue;
    const enemies = navalEnemiesOf(world, polity.id);
    if (enemies.length === 0) continue;
    const war = world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active" && enemies.some((enemy) => [agreement.polityId, agreement.otherPolityId].includes(enemy)) && [agreement.polityId, agreement.otherPolityId].includes(polity.id));
    // Not in the first weeks of a war: a power that has been beaten at sea or has waited a season on the shore begins it.
    if (war === undefined || day - war.sinceStep < 90) continue;
    const mine = warships(world, polity.id);
    const enemyName = world.map.polities.find((candidate) => candidate.id === enemies[0])?.name ?? enemies[0]!;
    const mineAfloat = mine.reduce((sum, force) => sum + fitStrengthOf(force), 0);
    const mineMotions = new Map<string, readonly PoliticalProcedure[]>([[polity.id, motionOf(world, polity.id)]]);
    const asked = (matter: Matter): "own" | { readonly kind: string; readonly why: string; readonly delta: WorldDelta } | null => weigh(world, ruler, { id: polity.id, name: polity.name }, matter, { offices: input.offices ?? [], mine: mineMotions.get(polity.id) ?? [], day, month: String(Math.floor(day / 30)), carriedDay: undefined, asked: [] });

    if (mineAfloat === 0 && !buildingAFleet(world, polity.id)) {
      const work = fleetWork(world, polity.id, ruler.id);
      if (work === null) continue;
      const takings = monthlyTakings(world, polity.id);
      const matter: Matter = { kind: "fleet", act: "spending", magnitude: takings <= 0 ? Number.POSITIVE_INFINITY : work.total / takings, concerns: ["spending", "war"], label: FLEET_MOTION, deltas: [], text: FLEET_MOTION, why: `${enemyName} holds the sea, and ${polity.name} has no ships` };
      const way = asked(matter);
      if (way === null) continue;
      const enacts = { project: { kind: work.kind, label: work.label, fundingAccountRef: work.fundingAccountRef, milestones: work.milestones, completionOutcome: work.completionOutcome } };
      decisions.push(way === "own"
        ? { polityId: polity.id, actorCharacterId: ruler.id, act: "magistrate", targetPolityId: null, why: `${enemyName} holds the sea and ${polity.name} has no ships: ${ruler.name} has a fleet of ${work.completionOutcome.amount} hulls laid down`.slice(0, 400), deltas: [fleetBegun(work, polity.id, ruler)], facts: [] }
        : { polityId: polity.id, actorCharacterId: ruler.id, act: "magistrate", targetPolityId: null, why: `${way.why}: ${enemyName} holds the sea`.slice(0, 400), deltas: [withWhatItEnacts(way, enacts)], facts: [] });
      continue;
    }
    // Ships, and no way yet to close with the enemy's: the boarding-bridge, once, as a way of war.
    const has = world.doctrines.some((doctrine: Doctrine) => doctrine.polityId === polity.id && doctrine.lapsedAtStep === null && /corvus|boarding/iu.test(doctrine.label));
    // Only a power whose enemy has the better seamen needs it: Rome against the Carthaginians, who row and manoeuvre as nobody else can; Carthage had no use for it.
    const betterSeamen = enemies.some((enemy) => beatsAtSeamanship(world, enemy, polity.id));
    if (mineAfloat > 0 && !has && betterSeamen) {
      const matter: Matter = { kind: "corvus", act: "war", concerns: ["war"], label: CORVUS_MOTION, deltas: [], text: CORVUS_MOTION, why: `${enemyName}'s ships are better handled, and the way to beat them is to hold them fast and fight them as on land` };
      const way = asked(matter);
      if (way === null || way === "own") continue;
      decisions.push({ polityId: polity.id, actorCharacterId: ruler.id, act: "magistrate", targetPolityId: null, why: `${way.why}: to hold ${enemyName}'s ships fast and fight them as on land`.slice(0, 400), deltas: [withWhatItEnacts(way, { military: THE_CORVUS })], facts: [] });
    }
  }
  return decisions;
}
