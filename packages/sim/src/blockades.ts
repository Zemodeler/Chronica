import {
  atWar,
  isNavalForce,
  warfareWith,
  type Blockade,
  type FactProposalDraft,
  type Force,
  type ScenarioWarfareRules,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Enemy fleets off a port (docs/plans/battles-that-last.md).
 *
 * The world already stopped a power's sea trade and its armies' supply by sea
 * the day a fleet at war with it stood off one of its ports (`tick.ts`,
 * `campaign.ts`). What it did not know was that this was a blockade: when it
 * began, how long it had held, and how tight it was. Lilybaeum was blockaded
 * for years and still fed, because a few ships could not watch every night;
 * so a blockade's tightness is the hulls on station against what the port
 * needs watching with, and a loose one lets runners through (`sieges.ts`)
 * and lets trade half come and go.
 */

/** Hulls needed to shut a port tight, for every port-town in the province. */
const HULLS_TO_SEAL = 25;

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

export function keepBlockades(world: WorldState, toDay: number, warfare: ScenarioWarfareRules | undefined, ids: IdFactory): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const rules = warfare === undefined ? undefined : warfareWith(world, warfare);
  const facts: FactProposalDraft[] = [];
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const standing: Blockade[] = [];

  for (const province of world.map.provinces) {
    const holder = province.controllerPolityId;
    const ports = province.settlements.filter((settlement) => settlement.kind === "port").length;
    if (holder === null || ports === 0) continue;
    const off = world.material.forces.filter((force) => force.locationId === province.id && fitOf(force) > 0 && isNavalForce(force, rules)
      && force.polityId !== holder && atWar(world.polityAgreements, force.polityId, holder));
    if (off.length === 0) continue;
    const blockader = [...off].sort((a, b) => fitOf(b) - fitOf(a))[0]!.polityId;
    const fleets = off.filter((force) => force.polityId === blockader);
    const tightnessBps = Math.min(10_000, Math.round((fleets.reduce((sum, force) => sum + fitOf(force), 0) / (HULLS_TO_SEAL * ports)) * 10_000));
    const known = world.blockades.find((blockade) => blockade.status === "active" && blockade.provinceId === province.id && blockade.blockaderPolityId === blockader);
    if (known === undefined) {
      facts.push({
        localId: `blockade_${province.id}_${toDay}`.slice(0, 60),
        kind: "blockade_begun",
        summary: `${fleets.map((force) => force.name).join(" and ")} of ${name(blockader)} closed in on the harbour of ${province.name}, and ${name(holder)}'s shipping there is shut in${tightnessBps < 5_000 ? ", though too few ships watch it to stop every night's traffic" : ""}.`.slice(0, 600),
        affectedRefs: [{ kind: "province", id: province.id }, { kind: "polity", id: holder }, { kind: "polity", id: blockader }, ...fleets.slice(0, 4).map((force) => ({ kind: "force" as const, id: force.id }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 55,
      });
    }
    standing.push(known === undefined
      ? { id: ids.next("blockade"), provinceId: province.id, blockadedPolityId: holder, blockaderPolityId: blockader, fleetIds: fleets.map((force) => force.id).slice(0, 12), sinceStep: toDay, tightnessBps, status: "active", endedAtStep: null }
      : { ...known, fleetIds: fleets.map((force) => force.id).slice(0, 12), tightnessBps });
  }

  // Blockades whose fleets have gone, been sunk, or made peace.
  const ended = world.blockades.filter((blockade) => blockade.status === "active" && !standing.some((kept) => kept.id === blockade.id));
  for (const blockade of ended) {
    const where = world.map.provinces.find((province) => province.id === blockade.provinceId)?.name ?? blockade.provinceId;
    facts.push({
      localId: `blockade_end_${blockade.id}_${toDay}`.slice(0, 60),
      kind: "blockade_ended",
      summary: `The blockade of ${where} by ${name(blockade.blockaderPolityId)} is over after ${toDay - blockade.sinceStep} days, and its shipping moves again.`,
      affectedRefs: [{ kind: "province", id: blockade.provinceId }, { kind: "polity", id: blockade.blockadedPolityId }, { kind: "polity", id: blockade.blockaderPolityId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 50,
    });
  }
  const history = world.blockades.filter((blockade) => blockade.status === "ended" && (blockade.endedAtStep ?? 0) > toDay - 90);
  const next = [...history, ...ended.map((blockade) => ({ ...blockade, status: "ended" as const, endedAtStep: toDay })), ...standing];
  const same = next.length === world.blockades.length && next.every((blockade, index) => blockade === world.blockades[index]);
  return { world: same ? world : { ...world, blockades: next }, facts };
}

/** How tight the blockade of this province is against this power, 0-10 000; 0 when there is none. */
export function blockadeTightness(world: WorldState, provinceId: string, polityId: string): number {
  return world.blockades.find((blockade) => blockade.status === "active" && blockade.provinceId === provinceId && blockade.blockadedPolityId === polityId)?.tightnessBps ?? 0;
}
