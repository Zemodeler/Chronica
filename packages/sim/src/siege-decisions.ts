import {
  StructureSchema,
  siegeWalls,
  warfareWith,
  type FactProposalDraft,
  type Force,
  type PlayerDecision,
  type ScenarioWarfareRules,
  type Siege,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement, type BattleAccount } from "./battle";
import type { IdFactory } from "./ports";
import { BREACH_AT, marchOut, pressSieges } from "./sieges";

/**
 * The besieging player's word at a siege's turning points
 * (docs/plans/battles-that-last.md, phase 5): a breach opened, or terms
 * offered. The siege stands still until he answers; a report that begins
 * without an answer takes the careful course -- wait at a breach, accept terms.
 */

export const SIEGE_OPTION_PREFIX = "siege-";
type SiegeAction = "storm" | "wait" | "accept" | "refuse";
const optionId = (action: SiegeAction): string => `${SIEGE_OPTION_PREFIX}${action}`;
function actionOf(id: string | null | undefined): SiegeAction | null {
  if (id == null || !id.startsWith(SIEGE_OPTION_PREFIX)) return null;
  const action = id.slice(SIEGE_OPTION_PREFIX.length);
  return action === "storm" || action === "wait" || action === "accept" || action === "refuse" ? action : null;
}

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

function awaitingFor(world: WorldState, player: string | null): { readonly siege: Siege; readonly besieger: Force; readonly garrison: Force[] } | undefined {
  if (player === null) return undefined;
  for (const siege of world.sieges) {
    if (siege.status !== "active" || siege.awaiting === null) continue;
    const besieger = world.material.forces.find((force) => force.id === siege.forceId);
    if (besieger === undefined || (besieger.commanderCharacterId !== player && besieger.controllerCharacterId !== player)) continue;
    const garrison = world.material.forces.filter((force) => force.locationId === siege.provinceId && force.polityId === siege.defenderPolityId && fitOf(force) > 0);
    return { siege, besieger, garrison };
  }
  return undefined;
}

const placeOf = (world: WorldState, siege: Siege): string => {
  const province = world.map.provinces.find((candidate) => candidate.id === siege.provinceId);
  return (siege.settlementId === null ? undefined : province?.settlements.find((city) => city.id === siege.settlementId)?.name) ?? province?.name ?? siege.provinceId;
};

export function siegeDecision(world: WorldState, player: string | null): PlayerDecision | undefined {
  const waiting = awaitingFor(world, player);
  if (waiting === undefined) return undefined;
  const { siege, besieger, garrison } = waiting;
  const place = placeOf(world, siege);
  const men = garrison.reduce((sum, force) => sum + fitOf(force), 0);
  if (siege.awaiting!.kind === "breach") {
    return {
      prompt: `A breach has opened in the walls of ${place}, which ${besieger.name} has held under siege for ${world.elapsedStep - siege.startedAtStep} days. ${men > 0 ? `About ${men.toLocaleString("en-GB")} men hold the city.` : "No soldiers are left on its walls."} Storm it, or keep the lines and wait?`,
      options: [
        { id: optionId("storm"), label: "Storm the breach", summary: "Send the men in. If they carry it the city is yours today; if they are thrown back, it will cost you dearly and set the siege back." },
        { id: optionId("wait"), label: "Keep the lines", summary: "Hold the city closed and let hunger finish the work. Slower, and the walls may be mended." },
      ],
    };
  }
  return {
    prompt: `${place} has offered its gates to ${besieger.name}, if its garrison of about ${men.toLocaleString("en-GB")} may march out under arms.`,
    options: [
      { id: optionId("accept"), label: "Accept the terms", summary: "The city is yours today, and its garrison lives to fight you elsewhere." },
      { id: optionId("refuse"), label: "Refuse", summary: "Hold out for surrender without terms. The city is near its end, but not yet at it." },
    ],
  };
}

export function answerSiege(
  world: WorldState,
  player: string | null,
  answeredOptionId: string | null,
  day: number,
  warfare: ScenarioWarfareRules | undefined,
  ids: IdFactory,
): { readonly world: WorldState; readonly facts: FactProposalDraft[]; readonly battles: BattleAccount[] } {
  const waiting = awaitingFor(world, player);
  if (waiting === undefined) return { world, facts: [], battles: [] };
  const { siege, besieger, garrison } = waiting;
  const kind = siege.awaiting!.kind;
  const chosen = actionOf(answeredOptionId);
  const action: SiegeAction = kind === "breach" ? (chosen === "storm" ? "storm" : "wait") : (chosen === "refuse" ? "refuse" : "accept");
  if (action === "accept") {
    const forces = marchOut(world, world.material.forces, garrison, siege, besieger);
    return { world: settle({ ...world, material: { ...world.material, forces } }, siege.id, day, { pressureBps: 10_000, told: [...siege.told, "terms_accepted"].slice(-20) }), facts: [], battles: [] };
  }
  if (action === "storm") return assaultSiege(world, siege.id, day, warfare, ids, player);
  return { world: settle(world, siege.id, day, {}), facts: [], battles: [] };
}

/** The question answered: the siege takes up again from the day before. */
const settle = (world: WorldState, siegeId: string, day: number, changes: Partial<Siege>): WorldState => ({
  ...world,
  sieges: world.sieges.map((candidate) => (candidate.id === siegeId ? { ...candidate, awaiting: null, pressedToStep: Math.max(candidate.pressedToStep, day - 1), ...changes } : candidate)),
});

/**
 * The besiegers sent in, at a breach or over whole walls: thrown back, the
 * siege loses ground; carried, the city opens its gates the same day rather
 * than at the next day's press. The player's answer at a breach and an order
 * to storm ("siege_lay" with "assault") both come here.
 */
export function assaultSiege(
  world: WorldState,
  siegeId: string,
  day: number,
  warfare: ScenarioWarfareRules | undefined,
  ids: IdFactory,
  player: string | null,
): { readonly world: WorldState; readonly facts: FactProposalDraft[]; readonly battles: BattleAccount[] } {
  const siege = world.sieges.find((candidate) => candidate.id === siegeId && candidate.status === "active");
  const besieger = world.material.forces.find((force) => force.id === siege?.forceId);
  if (siege === undefined || besieger === undefined) return { world, facts: [], battles: [] };
  const garrison = world.material.forces.filter((force) => force.locationId === siege.provinceId && force.polityId === siege.defenderPolityId && fitOf(force) > 0);
  const setSiege = (next: WorldState, changes: Partial<Siege>): WorldState => settle(next, siege.id, day, changes);
  if (warfare === undefined && garrison.length > 0) return { world: setSiege(world, {}), facts: [], battles: [] };
  const stormed = stormSiege(world, siege, besieger, garrison, day, warfare, ids, player);
  const facts = [...stormed.facts];
  const battles = [...stormed.battles];
  const next = setSiege(stormed.world, { pressureBps: stormed.carried ? 10_000 : Math.max(0, siege.pressureBps - 1_500) });
  if (!stormed.carried) return { world: next, facts, battles };
  const alone = { ...next, sieges: next.sieges.filter((candidate) => candidate.id === siege.id) };
  const pressed = pressSieges(alone, day, { warfare, ids, playerCharacterId: player });
  facts.push(...pressed.facts);
  battles.push(...pressed.battles);
  return { world: { ...pressed.world, sieges: next.sieges.map((candidate) => pressed.world.sieges.find((one) => one.id === candidate.id) ?? candidate) }, facts, battles };
}

/**
 * An assault on the walls, fought over them: they are worth to the men on them
 * what they are worth to the siege, and more while no breach has opened. A
 * player's answer at a breach comes here, and so does an order to storm.
 */
export function stormSiege(
  world: WorldState,
  siege: Siege,
  besieger: Force,
  garrison: readonly Force[],
  day: number,
  warfare: ScenarioWarfareRules | undefined,
  ids: IdFactory,
  player: string | null,
): { readonly world: WorldState; readonly facts: FactProposalDraft[]; readonly battles: BattleAccount[]; readonly carried: boolean } {
  const place = placeOf(world, siege);
  const facts: FactProposalDraft[] = [];
  const battles: BattleAccount[] = [];
  const breached = siege.pressureBps >= BREACH_AT;
  const walls = StructureSchema.parse({
    id: `breach-${siege.id}`.slice(0, 120), kind: "wall", name: `the walls of ${place}`, provinceId: siege.provinceId,
    ownerPolityId: siege.defenderPolityId, defensiveEffectsBps: Math.min(breached ? 4_000 : 6_000, Math.round((siegeWalls(world, siege) - 1) * 1_500) + (breached ? 0 : 2_000)), builtAtStep: day,
  });
  const stormed = garrison.length === 0 || warfare === undefined ? undefined : resolveEngagement({
    world: { ...world, structures: [...world.structures, walls], elapsedStep: day, instant: { ...world.instant, day } },
    attacker: besieger, defender: garrison[0]!, defenderAllies: garrison.slice(1), posture: "offer_battle",
    tactic: null, warfare: warfareWith(world, warfare!), battleId: ids.next("battle"), seed: `${siege.id}:storm:${day}`, playerCharacterId: player,
  }, 950);
  const after: WorldState = stormed === undefined ? world : { ...stormed.world, elapsedStep: world.elapsedStep, instant: world.instant, structures: stormed.world.structures.filter((structure) => structure.id !== walls.id) };
  if (stormed !== undefined) facts.push(...stormed.facts);
  if (stormed?.account !== undefined) battles.push(stormed.account);
  const holding = after.material.forces.filter((force) => force.locationId === siege.provinceId && force.polityId === siege.defenderPolityId && fitOf(force) > 0);
  const carried = holding.length === 0;
  const where = breached ? `the breach at ${place}` : `the walls of ${place}`;
  facts.push({
    localId: `storm_${siege.id}_${day}`.slice(0, 60),
    kind: "siege_event",
    summary: garrison.length === 0
      ? `${besieger.name} went in at ${where} and found nobody to hold it: the city lay open.`
      : carried
        ? `${besieger.name} carried ${where}, and the city lay open.`
        : `${besieger.name} stormed ${where} and was thrown back from it.`,
    affectedRefs: [{ kind: "province", id: siege.provinceId }, { kind: "force", id: besieger.id }, ...garrison.slice(0, 4).map((force) => ({ kind: "force" as const, id: force.id }))],
    visibility: "public",
    discoveryState: "public",
    knowableInDays: 0,
    significance: carried ? 80 : 65,
  });
  return { world: after, facts, battles, carried };
}
