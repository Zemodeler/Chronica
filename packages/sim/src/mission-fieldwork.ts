import {
  atWar,
  engagementOf,
  goalMet,
  kmBetween,
  landKmBetween,
  marchDaysFor,

  type FactProposalDraft,
  type Force,
  type OrderGoal,
  type OrderPart,
  type ScenarioClock,
  type ScenarioWarfareRules,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { BattleAccount } from "./battle";
import type { ElectionGovernment } from "./elections";
import { WorldDeltaSchema } from "@chronica/shared";
import { proportionalDraw } from "./apply/detachments";
import { SIEGE_NEEDED_AT } from "./occupation";
import type { IdFactory } from "./ports";
import { safeLocalId } from "./safe-local-id";

/**
 * The field work behind "send two thousand men to claim their territory",
 * carried on from day to day until the ground is held or something real stops it.
 *
 * The order was answered by an army "watching the approaches": the part kept
 * its goal -- the territory in Roman hands -- and nothing was ever done towards
 * it. Preserving the goal does not move a man. So for an order that wants
 * ground taken from a power at war with the giver:
 *
 *  1. **The detachment is made** from the actor's own army, of the strength the
 *     order named, and set as the part's mission (its `force_at` goal).
 *  2. **It marches** to the ground, and the journey is the part's work.
 *  3. **At a walled city it lays siege**; in open country the occupation rule
 *     (`occupation.ts`) takes the ground once nothing defends it.
 *  4. **What stops it is said**: no war to take it in, no men to spare, no road,
 *     an army in the way. Written on the part, never put in place of the order.
 *
 * Idempotent: every step looks for the work it would do and does not do it twice.
 * A fight is not forced: an army standing in the way is for the player to decide.
 */

const MISSION_DAYS = 365;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const isFleet = (force: Force): boolean => force.personnel.length > 0 && force.personnel.every((group) => /ship|galley|hull|fleet|transport/i.test(group.categoryId));

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** The men a part names: "2,000 men", "two thousand soldiers". Null where it names none. */
export function menNamedIn(said: string): number | null {
  const figure = /\b(\d{1,3}(?:,\d{3})+|\d+)\s*(?:men|soldiers|troops|legionaries|infantry|horse)\b/i.exec(said);
  if (figure !== null) return Number(figure[1]!.replace(/,/g, ""));
  const words = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(hundred|thousand)\s+(?:men|soldiers|troops|legionaries)\b/i.exec(said);
  if (words === null) return null;
  return WORDS[words[1]!.toLowerCase()]! * (words[2]!.toLowerCase() === "thousand" ? 1_000 : 100);
}

export interface FieldworkInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  /** What the engine needs to carry out a battle order for the actor. Without the scenario's rules of war, kill orders are left alone. */
  readonly warfare?: ScenarioWarfareRules | undefined;
  readonly government?: ElectionGovernment | undefined;
  readonly clock?: ScenarioClock | undefined;
  readonly playerCharacterId?: string | null | undefined;
}

/**
 * Whether the actor has since said something about this mission's army that
 * overrides the order: a later order with a part that deals with it, or tells
 * it to stand, withdraw or stop. The latest word stands.
 */
function overtakenByLater(world: WorldState, orderId: string, actorId: string, forceIds: ReadonlySet<string>, targetNames: readonly string[]): boolean {
  const order = world.orders.find((candidate) => candidate.id === orderId);
  if (order === undefined) return false;
  const stops = /\b(hold|stand down|withdraw|halt|stop|cease|abandon|call off|recall|do not attack|spare)\b/i;
  return world.orders.some((later) => later.id !== orderId && later.actorCharacterId === actorId && later.givenAtStep > order.givenAtStep
    && later.parts.some((part) => part.goals.some((goal) => (goal.kind === "force_at" || goal.kind === "force_strength" || goal.kind === "force_commanded" || goal.kind === "force_named") && forceIds.has(goal.forceId))
      || (stops.test(part.said) && targetNames.some((name) => part.said.toLowerCase().includes(name.toLowerCase())))));
}

export function continueMissions(input: FieldworkInput): { world: WorldState; facts: FactProposalDraft[]; battles: BattleAccount[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const placeName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;

  const updatePart = (orderId: string, index: number, change: (part: OrderPart) => OrderPart): void => {
    world = { ...world, orders: world.orders.map((order) => order.id !== orderId ? order
      : { ...order, parts: order.parts.map((part, at) => at === index ? change(part) : part) }) };
  };
  const obstructed = (orderId: string, index: number, why: string): void => {
    if (world.orders.find((order) => order.id === orderId)?.parts[index]?.whyNot === why.slice(0, 300)) return;
    updatePart(orderId, index, (part) => ({ ...part, whyNot: why.slice(0, 300) }));
  };

  for (const original of input.world.orders) {
    if (input.toDay - original.givenAtStep > MISSION_DAYS) continue;
    const actor = world.characters.find((character) => character.id === original.actorCharacterId);
    if (actor === undefined || !actor.alive || actor.polityId === null) continue;
    const polityId = actor.polityId;
    for (const [index, seen] of original.parts.entries()) {
      const part = world.orders.find((order) => order.id === original.id)?.parts[index] ?? seen;
      if (part.closedAtStep !== null || part.refusal !== null) continue;
      // A killing ordered is fought for: the army sent, the hold lifted, the battle offered.
      const killing = part.goals.find((goal): goal is Extract<OrderGoal, { kind: "force_killed" }> => goal.kind === "force_killed" && goalMet(world, goal) === "not_yet");
      if (killing !== undefined && input.warfare !== undefined) {
        const quarry = world.material.forces.find((force) => force.id === killing.forceId);
        if (quarry === undefined || quarry.polityId === polityId) continue;
        const own = world.material.forces.filter((force) => force.polityId === polityId && !isFleet(force) && fitOf(force) > 0);
        const missionIds = new Set(part.goals.flatMap((goal) => goal.kind === "force_at" ? [goal.forceId] : []));
        const army = own.find((force) => missionIds.has(force.id)) ?? own.find((force) => force.commanderCharacterId === actor.id || force.controllerCharacterId === actor.id);
        if (army === undefined) { obstructed(original.id, index, `No army of ${nameOf(polityId)} answers to you to send against ${quarry.name}.`); continue; }
        if (overtakenByLater(world, original.id, actor.id, new Set([army.id]), [quarry.name, quarry.name.split(/\s+of\s+/i)[0]!])) continue;
        const reference = (id: string): string => id;
        const deltas: WorldDelta[] = [];
        if (army.hold === true) deltas.push({ op: "force_modify", forceRef: reference(army.id), hold: false, reason: `The order to destroy ${quarry.name} lifts the hold on ${army.name}.` } as WorldDelta);
        const journeys = world.projects.filter((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === army.id);
        const sentThere = journeys.some((project) => project.completionOutcome?.provinceId === quarry.locationId || project.completionOutcome?.embarkProvinceId === quarry.locationId);
        if (army.locationId !== quarry.locationId) {
          if (!sentThere) deltas.push({ op: "force_modify", forceRef: reference(army.id), locationId: quarry.locationId, reason: `To find and destroy ${quarry.name}, as ordered.` } as WorldDelta);
        } else if (engagementOf(world.engagements, army.id) === undefined) {
          deltas.push({ op: "force_engage", forceRef: reference(army.id), targetForceRef: reference(quarry.id), posture: "offer_battle", tactic: null, reason: `To destroy ${quarry.name}, as ordered.` } as WorldDelta);
        }
        if (deltas.length === 0) continue;
        const context = {
          now: world.instant, actorRef: { kind: "character" as const, id: actor.id }, offices: input.government?.offices ?? [], successionRules: input.government?.successionRules ?? [],
          warfare: input.warfare, clock: input.clock, ids: input.ids, gameId: "fieldwork", playerCharacterId: input.playerCharacterId ?? null,
        };
        // One act at a time: a refusal of the march must not hide what the hold's lifting did.
        for (const delta of deltas) {
          const done = applyDeltas(world, [WorldDeltaSchema.parse(delta)], context);
          world = done.world;
          facts.push(...done.factProposals);
          battles.push(...done.battleAccounts);
          if (done.rejected.length > 0) {
            obstructed(original.id, index, `${army.name} could not be sent against ${quarry.name}: ${done.rejected[0]!.reason}`);
            break;
          }
          updatePart(original.id, index, (current) => current.whyNot === null ? current : { ...current, whyNot: null });
        }
        continue;
      }

      const target = part.goals.find((goal): goal is Extract<OrderGoal, { kind: "control" }> => goal.kind === "control" && goal.polityId === polityId && goalMet(world, goal) === "not_yet");
      if (target === undefined) continue;
      const province = world.map.provinces.find((candidate) => candidate.id === target.provinceId);
      if (province === undefined) continue;
      const city = target.settlementId === null ? null : province.settlements.find((candidate) => candidate.id === target.settlementId) ?? null;
      const holder = city?.controllerPolityId ?? province.controllerPolityId;
      const place = city?.name ?? province.name;
      if (holder === null || holder === polityId) continue;
      if (!atWar(world.polityAgreements, polityId, holder)) {
        obstructed(original.id, index, `${nameOf(holder)} is not at war with ${nameOf(polityId)}: taking ${place} from it is an act of war, and the war stands undeclared or ended in a treaty.`);
        continue;
      }

      // 1. The mission's own force, made if the order has none yet.
      const missionIds = new Set(part.goals.flatMap((goal) => goal.kind === "force_at" || (goal.kind === "exists" && goal.of === "force") ? [goal.kind === "force_at" ? goal.forceId : goal.id] : []));
      let mission = world.material.forces.find((force) => missionIds.has(force.id) && force.polityId === polityId && fitOf(force) > 0);
      if (mission === undefined) {
        const men = menNamedIn(part.said);
        if (men === null) continue;
        const own = world.material.forces.filter((force) => force.polityId === polityId && !isFleet(force) && fitOf(force) > men);
        const source = own.find((force) => force.commanderCharacterId === actor.id || force.controllerCharacterId === actor.id)
          ?? own.sort((a, b) => fitOf(b) - fitOf(a) || a.id.localeCompare(b.id))[0];
        if (source === undefined) {
          obstructed(original.id, index, `No army of ${nameOf(polityId)} has more than ${men} fit men to spare for ${place}.`);
          continue;
        }
        const shares = proportionalDraw(source.personnel, men);
        const id = input.ids.next("force");
        const names = new Set(world.material.forces.map((force) => force.name));
        const base = `Detachment of ${source.name}`.slice(0, 110);
        const name = names.has(base) ? `${base} (${place})`.slice(0, 120) : base;
        const detachment: Force = {
          id, name, polityId, commanderCharacterId: source.commanderCharacterId, controllerCharacterId: source.controllerCharacterId,
          locationId: source.locationId, positionId: null, authorizedStrength: men,
          personnel: source.personnel.map((group, at) => ({ ...group, fit: shares[at]!, unavailable: [] })).filter((group) => group.fit > 0),
          moraleBps: source.moraleBps, cohesionBps: source.cohesionBps, fatigueBps: source.fatigueBps,
          provisionStatus: source.provisionStatus, provisionedThroughStep: source.provisionedThroughStep,
          payObligationId: source.payObligationId, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
        };
        world = {
          ...world,
          material: {
            ...world.material,
            forces: [...world.material.forces.map((force) => force.id === source.id
              ? { ...force, personnel: force.personnel.map((group, at) => ({ ...group, fit: group.fit - shares[at]! })), authorizedStrength: Math.max(1, force.authorizedStrength - men) } : force), detachment],
            accounts: [...world.material.accounts, { id: input.ids.next("account"), owner: { kind: "force" as const, id }, currencyId: world.material.currency.id, balance: 0, status: "active" as const, visibility: "polity" as const }],
          },
        };
        updatePart(original.id, index, (current) => ({
          ...current,
          goals: [...current.goals, { kind: "force_at" as const, forceId: id, provinceId: province.id }].slice(-12),
          workRefs: [...current.workRefs, { kind: "force" as const, id }].slice(-12),
          whyNot: null,
        }));
        facts.push({
          localId: safeLocalId(`mission_made_${id}`).slice(0, 60), kind: "force_reformed",
          summary: `${men} men of ${source.name} were detached as ${name}, to take ${place} from ${nameOf(holder)}.`.slice(0, 600),
          affectedRefs: [{ kind: "force", id }, { kind: "force", id: source.id }, { kind: "province", id: province.id }, { kind: "polity", id: polityId }],
          visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 45,
        });
        mission = detachment;
      }

      // 2. The march.
      if (mission.locationId !== province.id) {
        const journeys = world.projects.filter((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === mission!.id);
        if (journeys.length > 0) {
          const known = new Set(part.workRefs.filter((ref) => ref.kind === "project").map((ref) => ref.id));
          const fresh = journeys.filter((project) => !known.has(project.id));
          if (fresh.length > 0) updatePart(original.id, index, (current) => ({ ...current, workRefs: [...current.workRefs, ...fresh.map((project) => ({ kind: "project" as const, id: project.id }))].slice(-12) }));
          continue;
        }
        const km = landKmBetween(world, mission.locationId, province.id);
        if (km === null) {
          obstructed(original.id, index, kmBetween(world, mission.locationId, province.id) === null
            ? `No road or sea lane leads from ${placeName(mission.locationId)} to ${place}.`
            : `${place} lies over water from ${placeName(mission.locationId)}, and a crossing has to be arranged before ${mission.name} can march there.`);
          continue;
        }
        const days = Math.max(1, Math.ceil(marchDaysFor(km)));
        const id = input.ids.next("project");
        world = {
          ...world,
          projects: [...world.projects, {
            id, kind: "march", sponsorEntityRef: { kind: "character" as const, id: actor.id }, label: `${mission.name} marches on ${placeName(province.id)}`.slice(0, 160),
            status: "in_progress" as const, fundingAccountId: null, overseerCharacterId: null, reservationId: null,
            milestones: [{ id: `${id}-m1`, label: `Arrives in ${placeName(province.id)}`.slice(0, 160), requiredAtElapsedOffset: days, costAmount: 0, status: "pending" as const, completedAtStep: null }],
            completionOutcome: {
              kind: "force_move" as const, label: `${mission.name} arrives in ${placeName(province.id)}`.slice(0, 160), amount: 0,
              provinceId: province.id, polityId: null, commanderCharacterId: null, forceId: mission.id,
              beneficiaryAccountId: null, cadenceDays: null, agreementKind: null, withPolityId: null,
            },
            linkedEntityIds: [], startedAtStep: input.toDay, targetCompletionStep: input.toDay + days, completedAtStep: null, provenanceEventIds: [],
          }],
        };
        updatePart(original.id, index, (current) => ({ ...current, workRefs: [...current.workRefs, { kind: "project" as const, id }].slice(-12), whyNot: null }));
        facts.push({
          localId: safeLocalId(`mission_march_${mission.id}`).slice(0, 60), kind: "march_begun",
          summary: `${mission.name} set out from ${placeName(mission.locationId)} for ${placeName(province.id)} to take ${place} from ${nameOf(holder)}: about ${days} days on the road.`.slice(0, 600),
          affectedRefs: [{ kind: "force", id: mission.id }, { kind: "province", id: province.id }, { kind: "polity", id: polityId }],
          visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 35,
        });
        continue;
      }

      // 3. On the ground: a walled city is besieged; open country is occupied by the army standing in it.
      const walled = province.settlements.filter((candidate) => (city === null || candidate.id === city.id)
        && candidate.controllerPolityId === holder && candidate.fortificationLevel >= SIEGE_NEEDED_AT);
      const defended = world.material.forces.find((force) => force.locationId === province.id && force.polityId !== polityId && fitOf(force) > 0 && atWar(world.polityAgreements, polityId, force.polityId));
      if (defended !== undefined && walled.length === 0) {
        obstructed(original.id, index, `${defended.name} of ${nameOf(defended.polityId)} stands in ${province.name}: ${mission.name} will not take the ground until it is dealt with, and that is for you to order.`);
        continue;
      }
      for (const wall of walled) {
        const standing = world.sieges.some((siege) => siege.status === "active" && siege.forceId === mission!.id && siege.provinceId === province.id && siege.settlementId === wall.id);
        if (standing) continue;
        const siegeId = input.ids.next("siege");
        world = { ...world, sieges: [...world.sieges, {
          id: siegeId, forceId: mission.id, provinceId: province.id, settlementId: wall.id, besiegerPolityId: polityId, defenderPolityId: holder,
          startedAtStep: input.toDay, pressedToStep: input.toDay, reportedAtStep: input.toDay,
          pressureBps: 0, awaiting: null, works: [], told: [], status: "active" as const, endedAtStep: null, endedReason: null,
        }] };
        updatePart(original.id, index, (current) => ({ ...current, workRefs: [...current.workRefs, { kind: "siege" as const, id: siegeId }].slice(-12), whyNot: null }));
        facts.push({
          localId: safeLocalId(`mission_siege_${siegeId}`).slice(0, 60), kind: "siege_laid",
          summary: `${mission.name} laid siege to ${wall.name}, held by ${nameOf(holder)}, as the order to take it required.`.slice(0, 600),
          affectedRefs: [{ kind: "force", id: mission.id }, { kind: "province", id: province.id }, { kind: "polity", id: polityId }, { kind: "polity", id: holder }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 55,
        });
      }
    }
  }
  return { world, facts, battles };
}
