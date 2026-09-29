import {
  SIEGE_BASE_DAYS,
  siegeRatio,
  siegeWalls,
  sameConfederation,
  warfareWith,
  type ScenarioWarfareRules,
  SIEGE_HUNGER_AFTER_DAYS,
  SIEGE_HUNGER_BPS_PER_DAY,
  SIEGE_REPORT_DAYS,
  atWar,
  boundedId,
  disbandForces,
  type FactProposalDraft,
  type Force,
  type Siege,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement, type BattleAccount } from "./battle";
import type { IdFactory } from "./ports";

/**
 * Sieges, pressed day by day (`world/siege.ts`).
 *
 * Deterministic, like the rest of the tick: the city holds out about
 * `SIEGE_BASE_DAYS` against besiegers three times its garrison, longer against
 * fewer and shorter against more, and faster still with nobody on the walls --
 * and longer again behind real walls (`siegeWalls`). The besiegers are an army
 * in the field like any other, fed off the country round the city or not at
 * all, and sickening in their lines (`campaign.ts`).
 *
 * An army of the city's own side that comes up after the siege began is a
 * relief. Strong enough -- half as strong again as the besiegers -- and they
 * draw off without waiting for it; otherwise it falls on their lines, and the
 * battle decides whether the siege goes on.
 * After a month the garrison starts to die of hunger and sickness. The
 * besieger hears how it goes every fortnight, in figures; the city opens its
 * gates when the pressure is full. An army that leaves, or a war that ends,
 * raises the siege.
 */

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

/** Men taken off a force by hunger, shared among its groups by strength. */
function starve(force: Force, lost: number, atStep: number, siegeId: string): Force {
  const total = fitOf(force);
  if (lost <= 0 || total <= 0) return force;
  let left = Math.min(lost, total);
  const personnel = force.personnel.map((group, index, all) => {
    const share = index === all.length - 1 ? left : Math.min(left, Math.round((lost * group.fit) / total));
    left -= share;
    return { ...group, fit: group.fit - share };
  });
  const taken = Math.min(lost, total);
  return {
    ...force,
    personnel,
    authorizedStrength: Math.max(1, force.authorizedStrength - taken),
    history: [...force.history, {
      id: boundedId(siegeId, force.id, "hunger", atStep), atStep, kind: "attrition_death" as const,
      categoryId: force.personnel[0]?.categoryId ?? "infantry", count: taken, causeId: siegeId,
    }].slice(-64),
  };
}

function howItGoes(pressureBps: number): string {
  if (pressureBps < 3_000) return "the city still has food, and its walls are manned";
  if (pressureBps < 6_000) return "rations in the city are short";
  if (pressureBps < 8_500) return "there is hunger in the city, and men are slipping over the walls";
  return "the city is starving";
}

/** A relief this much stronger than the besiegers makes them draw off without a battle. */
const RELIEF_LIFTS_AT = 1.5;
/** A relief weaker than this share of the besiegers waits for more, and does not attack. */
const RELIEF_ATTACKS_AT = 0.25;

export interface PressSiegesOptions {
  /** Without them a relief can make the besiegers draw off, but cannot fight them. */
  readonly warfare?: ScenarioWarfareRules | undefined;
  readonly ids?: IdFactory | undefined;
  readonly playerCharacterId?: string | null | undefined;
}

/** Armies of the city's side that came up after the siege began. */
function reliefOf(world: WorldState, siege: Siege): Force[] {
  if (siege.garrisonForceIds === undefined) return [];
  const inside = new Set(siege.garrisonForceIds);
  return world.material.forces.filter((force) => force.locationId === siege.provinceId && !inside.has(force.id) && fitOf(force) > 0
    && (force.polityId === siege.defenderPolityId || sameConfederation(world.polityAgreements, force.polityId, siege.defenderPolityId))
    && atWar(world.polityAgreements, force.polityId, siege.besiegerPolityId));
}

export function pressSieges(given: WorldState, toDay: number, options: PressSiegesOptions = {}): { world: WorldState; facts: FactProposalDraft[]; battles: BattleAccount[] } {
  if (!given.sieges.some((siege) => siege.status === "active")) return { world: given, facts: [], battles: [] };
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  let world = given;

  // A relief falls on the lines first: whether the siege is pressed today is
  // what the battle decides.
  for (const siege of given.sieges) {
    if (siege.status !== "active" || options.warfare === undefined || options.ids === undefined) continue;
    const besieger = world.material.forces.find((force) => force.id === siege.forceId && force.locationId === siege.provinceId);
    const relief = reliefOf(world, siege).sort((a, b) => fitOf(b) - fitOf(a) || a.id.localeCompare(b.id));
    if (besieger === undefined || relief.length === 0) continue;
    const coming = relief.reduce((sum, force) => sum + fitOf(force), 0);
    if (coming >= fitOf(besieger) * RELIEF_LIFTS_AT || coming < fitOf(besieger) * RELIEF_ATTACKS_AT) continue;
    const engagement = resolveEngagement({
      world,
      attacker: relief[0]!,
      attackerAllies: relief.slice(1),
      defender: besieger,
      posture: "offer_battle",
      tactic: null,
      warfare: warfareWith(world, options.warfare),
      battleId: options.ids.next("battle"),
      seed: `${siege.id}:relief:${toDay}`,
      playerCharacterId: options.playerCharacterId ?? null,
    }, 0);
    // Fought, the relief is part of the city's defence from here on: it does
    // not fall on the same lines again tomorrow.
    world = {
      ...engagement.world,
      sieges: engagement.world.sieges.map((candidate) => (candidate.id === siege.id
        ? { ...candidate, garrisonForceIds: [...(candidate.garrisonForceIds ?? []), ...relief.map((force) => force.id)].slice(0, 40) }
        : candidate)),
    };
    facts.push(...engagement.facts);
    if (engagement.account !== undefined) battles.push(engagement.account);
  }

  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  let forces = world.material.forces;
  let provinces = world.map.provinces;

  const yielded: string[] = [];
  const sieges = world.sieges.map((siege): Siege => {
    if (siege.status !== "active" || toDay <= siege.pressedToStep) return siege;
    const province = provinces.find((candidate) => candidate.id === siege.provinceId);
    const settlement = siege.settlementId === null ? null : province?.settlements.find((city) => city.id === siege.settlementId) ?? null;
    const place = settlement?.name ?? province?.name ?? siege.provinceId;
    const holder = settlement?.controllerPolityId ?? province?.controllerPolityId ?? null;
    const besieger = forces.find((force) => force.id === siege.forceId);
    const refs = [
      { kind: "province" as const, id: siege.provinceId },
      { kind: "polity" as const, id: siege.besiegerPolityId },
      { kind: "polity" as const, id: siege.defenderPolityId },
      ...(besieger === undefined ? [] : [{ kind: "force" as const, id: besieger.id }]),
    ];
    const end = (status: "lifted" | "taken", reason: string, kind: string, summary: string, significance: number): Siege => {
      facts.push({ localId: `${kind}_${siege.id}`.slice(0, 60), kind, summary, affectedRefs: refs, visibility: "public", discoveryState: "public", knowableInDays: 0, significance });
      return { ...siege, status, pressedToStep: toDay, endedAtStep: toDay, endedReason: reason.slice(0, 300) };
    };

    // Taken some other way -- stormed, or given up by treaty: the siege is over.
    if (holder !== siege.defenderPolityId) {
      return { ...siege, status: "taken", pressedToStep: toDay, endedAtStep: toDay, endedReason: `${place} passed to ${holder === null ? "no one" : polityName(holder)}.` };
    }
    if (besieger === undefined || besieger.locationId !== siege.provinceId || fitOf(besieger) === 0) {
      return end("lifted", "The besiegers left.", "siege_lifted", `The siege of ${place} was raised: ${besieger?.name ?? "the besieging army"} is no longer before its walls.`, 50);
    }
    if (!atWar(world.polityAgreements, siege.besiegerPolityId, siege.defenderPolityId)) {
      return end("lifted", "The war is over.", "siege_lifted", `The siege of ${place} was raised: ${polityName(siege.besiegerPolityId)} and ${polityName(siege.defenderPolityId)} are no longer at war.`, 50);
    }

    const days = toDay - siege.pressedToStep;
    const garrison = forces.filter((force) => force.locationId === siege.provinceId && force.polityId === siege.defenderPolityId);
    const stamped = siege.garrisonForceIds ?? garrison.map((force) => force.id).slice(0, 40);
    const relief = reliefOf({ ...world, material: { ...world.material, forces } }, { ...siege, garrisonForceIds: stamped });
    if (relief.reduce((sum, force) => sum + fitOf(force), 0) >= fitOf(besieger) * RELIEF_LIFTS_AT) {
      return end("lifted", "A relieving army came up.", "siege_lifted", `The siege of ${place} was raised: ${relief.map((force) => force.name).join(" and ")} came up to its relief, and ${besieger.name} drew off from the walls rather than be caught between them.`, 60);
    }
    const defenders = garrison.reduce((sum, force) => sum + fitOf(force), 0);
    const ratio = siegeRatio(fitOf(besieger), defenders, siegeWalls(world, siege));
    const pressureBps = Math.min(10_000, siege.pressureBps + Math.round((days * ratio * 10_000) / SIEGE_BASE_DAYS));

    // Hunger, once the stores are gone.
    const hungryDays = Math.max(0, toDay - Math.max(siege.pressedToStep, siege.startedAtStep + SIEGE_HUNGER_AFTER_DAYS));
    if (hungryDays > 0) {
      const starved = new Map(garrison.map((force) => [force.id, starve(force, Math.round((fitOf(force) * SIEGE_HUNGER_BPS_PER_DAY * hungryDays) / 10_000), toDay, siege.id)]));
      forces = forces.map((force) => starved.get(force.id) ?? force);
    }
    const left = forces.filter((force) => force.locationId === siege.provinceId && force.polityId === siege.defenderPolityId).reduce((sum, force) => sum + fitOf(force), 0);
    const weeks = Math.floor((toDay - siege.startedAtStep) / 7);

    if (pressureBps >= 10_000) {
      // The gates open. The city, and with its last city the province, to the
      // besiegers; the garrison lays down its arms.
      provinces = provinces.map((candidate) => {
        if (candidate.id !== siege.provinceId) return candidate;
        const settlements = candidate.settlements.map((city) => (siege.settlementId === null || city.id === siege.settlementId
          ? { ...city, controllerPolityId: siege.besiegerPolityId }
          : city));
        const allTaken = settlements.every((city) => city.controllerPolityId === siege.besiegerPolityId);
        return { ...candidate, settlements, ...(allTaken ? { controllerPolityId: siege.besiegerPolityId, controlFirmnessBps: Math.min(candidate.controlFirmnessBps, 3_000), lostBy: { polityId: siege.defenderPolityId, atStep: toDay } } : {}) };
      });
      yielded.push(...garrison.map((force) => force.id));
      forces = forces.filter((force) => !yielded.includes(force.id));
      return end(
        "taken",
        "The city yielded.",
        "siege_ended",
        `${place} opened its gates to ${besieger.name} of ${polityName(siege.besiegerPolityId)} after ${toDay - siege.startedAtStep} days of siege${left > 0 ? `; ${left} men of its garrison laid down their arms` : ""}.`,
        85,
      );
    }

    const pressed = { ...siege, pressureBps, pressedToStep: toDay, garrisonForceIds: stamped };
    if (toDay - siege.reportedAtStep < SIEGE_REPORT_DAYS) return pressed;
    facts.push({
      localId: `siege_report_${siege.id}_${toDay}`.slice(0, 60),
      kind: "siege_progress",
      summary: `The siege of ${place} by ${besieger.name} entered its ${weeks === 1 ? "first" : `${weeks}th`} week: ${howItGoes(pressureBps)}${defenders > 0 ? `, and ${left} of the garrison remain on the walls` : ""}.`,
      affectedRefs: refs,
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: pressureBps >= 6_000 ? 50 : 40,
    });
    return { ...pressed, reportedAtStep: toDay };
  });

  // A garrison that laid down its arms is disbanded properly: its chest and
  // what it paid go with it (`disbandForces`).
  const pressed: WorldState = { ...world, sieges, map: { ...world.map, provinces }, material: { ...world.material, forces: [...forces, ...world.material.forces.filter((force) => yielded.includes(force.id))] } };
  return { world: disbandForces(pressed, new Set(yielded), null), facts, battles };
}
