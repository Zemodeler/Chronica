import {
  GOVERNMENT_FORM_IN_WORDS,
  adjustPolityLegitimacy,
  boundedId,
  createPressure,
  seatCharacterInOffice,
  stableHash,
  vacateOfficesOf,
  type FactProposalDraft,
  type GovernmentForm,
  type WorldState,
} from "@chronica/shared";
import { constitutionOf, foundDeposedParty, readForm, recast, rulerOf, rulerOfficeOf, type GovernmentRules } from "./constitutions";
import { armyLoyaltyTo } from "./society";

/**
 * A government taken by force, or dictated by a conqueror.
 *
 * "Seize the palace and have myself proclaimed king" had nowhere to go: the
 * model could seat a man in an office, and did, and Syracuse went on being
 * governed by the same council and the same laws with a different name
 * written in one seat. Nothing checked whether he had a single soldier within
 * a hundred miles, and nothing could fail.
 *
 * Now the attempt is an act of its own, and the engine owns everything about
 * it but the wanting:
 *
 *  - **What it needs** is a hard check. A coup needs men at or beside the
 *    capital who answer to the man making it; a revolution needs a people in
 *    unrest or a government nobody believes in; an imposition needs the
 *    capital in the conqueror's hands, or a foedus over the power; a
 *    restoration needs the fallen government's party behind it. Without it
 *    the attempt is refused, and the refusal says why.
 *  - **Whether it works** is rolled, from the balance of armed men, how far
 *    the armies are the plotter's own, the state's legitimacy, the plotter's
 *    standing, and whether the world had offered him the moment
 *    (`openings.ts`) or he made it himself -- which is dearer. An imposition
 *    is dictated, not rolled.
 *  - **What follows** is the engine's either way: a new constitution, a new
 *    ruler, the fallen gathered into a party -- or a failed plotter stripped
 *    of his offices and hunted, and a ruler told he may punish him.
 */

export type RegimeRoute = "coup" | "revolution" | "imposition" | "restoration";

export interface RegimeChangeInput {
  readonly world: WorldState;
  readonly actorId: string;
  readonly polityId: string;
  readonly route: RegimeRoute;
  readonly form: GovernmentForm | null;
  readonly forceIds: readonly string[];
  readonly government: GovernmentRules;
  readonly atStep: number;
  readonly gameId: string;
}

export type RegimeChangeResult =
  | { readonly refused: string }
  | { readonly world: WorldState; readonly facts: FactProposalDraft[]; readonly succeeded: boolean; readonly chanceBps: number };

/** What a failed attempt costs the man who made it. */
const FAILED_STANDING_BPS = 1_500;
/** What a state loses in legitimacy when it is taken by force. */
const SEIZED_LEGITIMACY_BPS = 1_500;
/** The fewest men a coup can be made with. */
const COUP_MIN_MEN = 500;

const menIn = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, category) => sum + category.fit, 0);

/** The province a power is governed from: its capital's, else the first it holds. */
export function capitalProvinceOf(world: WorldState, polityId: string): string | null {
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  const byCapital = polity?.capitalSettlementId == null ? undefined : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId));
  return byCapital?.id ?? world.map.provinces.find((province) => province.controllerPolityId === polityId)?.id ?? null;
}

/** At the capital, or one crossing from it. */
function nearCapital(world: WorldState, provinceId: string, capitalId: string): boolean {
  return provinceId === capitalId || world.map.edges.some((edge) => (edge.from === provinceId && edge.to === capitalId) || (edge.to === provinceId && edge.from === capitalId));
}

const legitimacyOf = (world: WorldState, polityId: string): number => world.material.polityLegitimacy.find((entry) => entry.polityId === polityId)?.legitimacyBps ?? 5_000;
const stabilityOf = (world: WorldState, provinceId: string | null): number => (provinceId === null ? 5_000 : world.material.provinceMaterial.find((entry) => entry.provinceId === provinceId)?.stabilityBps ?? 5_000);

/** Whether the world offered this man this moment: an active opening that names his power. */
export function hasOpening(world: WorldState, characterId: string, polityId: string): boolean {
  return world.characterPressures.some((pressure) => pressure.characterId === characterId && pressure.status === "active" && pressure.id.startsWith(`opening:${polityId}:`));
}

/** The strongest popular grievance in a power: what a revolution is made of. */
function grievanceOf(world: WorldState, polityId: string): number {
  return Math.max(0, ...world.material.politicalGroups
    .filter((group) => group.active && group.polityId === polityId && ["debtors", "veterans", "cult", "conquered_people"].includes(group.type))
    .map((group) => group.strengthBps ?? 0));
}

/** The form a power had before it was last taken, for a restoration. */
function formerForm(world: WorldState, polityId: string): GovernmentForm | null {
  const history = constitutionOf(world, polityId)?.history ?? [];
  const taken = [...history].reverse().find((change) => change.origin === "seizure" || change.origin === "imposition");
  return taken?.fromForm ?? null;
}

export function attemptRegimeChange(input: RegimeChangeInput): RegimeChangeResult {
  const { world, actorId, polityId, route } = input;
  const actor = world.characters.find((character) => character.id === actorId);
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  if (actor === undefined || !actor.alive) return { refused: "A dead man takes no state." };
  if (polity === undefined) return { refused: `No power "${polityId}" exists to be taken.` };
  const capital = capitalProvinceOf(world, polityId);
  if (capital === null) return { refused: `${polity.name} holds no ground to be governed from.` };
  const ruler = rulerOf(world, polityId, input.government);
  const forces = input.forceIds.map((id) => world.material.forces.find((force) => force.id === id));
  if (forces.some((force) => force === undefined)) return { refused: "One of the armies named does not exist." };
  const armies = forces as NonNullable<(typeof forces)[number]>[];
  const notHis = armies.find((force) => force.commanderCharacterId !== actorId && force.controllerCharacterId !== actorId);
  if (notHis !== undefined) return { refused: `${notHis.name} does not answer to ${actor.name}.` };
  const near = armies.filter((force) => nearCapital(world, force.locationId, capital));
  const attackers = near.reduce((sum, force) => sum + menIn(force), 0);
  const defenders = world.material.forces
    .filter((force) => force.polityId === polityId && force.locationId === capital && force.commanderCharacterId !== actorId && force.controllerCharacterId !== actorId && !input.forceIds.includes(force.id))
    .reduce((sum, force) => sum + menIn(force), 0);
  const opening = hasOpening(world, actorId, polityId);

  // ── What it needs ──────────────────────────────────────────────────────
  let targetForm: GovernmentForm;
  const current = constitutionOf(world, polityId)?.form ?? readForm(world, polityId, input.government);
  if (route === "coup") {
    if (actor.polityId !== polityId) return { refused: `${actor.name} is not of ${polity.name}: a foreigner who takes it is a conqueror, and imposes a government ("imposition").` };
    if (ruler?.id === actorId) return { refused: `${actor.name} already rules ${polity.name}.` };
    if (attackers < COUP_MIN_MEN) return { refused: `${actor.name} has no army at or beside ${polity.name}'s capital that answers to him; a coup is made with men, and he has ${attackers}.` };
    targetForm = input.form ?? "monarchy";
  } else if (route === "revolution") {
    if (actor.polityId !== polityId) return { refused: `${actor.name} is not of ${polity.name}, and cannot lead its people.` };
    const unrest = stabilityOf(world, capital) < 4_500 || legitimacyOf(world, polityId) < 4_000 || grievanceOf(world, polityId) >= 5_000;
    if (!unrest) return { refused: `${polity.name}'s people are not in unrest and its government is not despised: there is nothing for a revolution to rise on.` };
    targetForm = input.form ?? "popular_republic";
  } else if (route === "restoration") {
    const party = world.material.politicalGroups.find((group) => group.active && group.type === "deposed_party" && group.polityId === polityId
      && (group.leaderCharacterId === actorId || world.material.groupMemberships.some((membership) => membership.groupId === group.id && membership.characterId === actorId && membership.leftAtStep === null)));
    if (party === undefined) return { refused: `${actor.name} is not of any fallen government of ${polity.name}, and has nothing to restore.` };
    if (attackers < COUP_MIN_MEN && stabilityOf(world, capital) >= 4_500 && legitimacyOf(world, polityId) >= 4_000) {
      return { refused: `${actor.name} has neither men at the capital nor a people ready to rise for the old government.` };
    }
    targetForm = input.form ?? formerForm(world, polityId) ?? current;
  } else {
    if (actor.polityId === polityId || actor.polityId === null) return { refused: "A government is imposed on another power, by its conqueror or its senior ally." };
    const capitalHeld = world.map.provinces.find((province) => province.id === capital)?.controllerPolityId === actor.polityId
      || world.map.provinces.some((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId && settlement.controllerPolityId === actor.polityId));
    const senior = world.polityAgreements.some((agreement) => agreement.status === "active" && (agreement.kind === "foedus" || agreement.kind === "protectorate") && agreement.polityId === polityId && agreement.otherPolityId === actor.polityId);
    if (!capitalHeld && !senior) return { refused: `${polity.name}'s capital is not in ${actor.name}'s hands, and ${polity.name} is not bound to his power: there is nothing to impose a government by.` };
    const speaksForHisPower = world.material.officeSeats.some((seat) => seat.holderCharacterId === actorId && seat.status === "held") || armies.length > 0;
    if (!speaksForHisPower) return { refused: `${actor.name} holds no office and commands no army: he cannot dictate a government for his power.` };
    targetForm = input.form ?? "oligarchic_republic";
  }

  // ── Whether it works ───────────────────────────────────────────────────
  let chanceBps = 10_000;
  if (route !== "imposition") {
    const loyalty = near.length === 0 ? 0 : near.reduce((sum, force) => sum + armyLoyaltyTo(world, force.id, actorId), 0) / near.length;
    const customary = world.genericEntities.some((entity) => entity.kind === "custom" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === polityId && entity.attributes?.["customKind"] === "army_made_ruler");
    const party = world.material.politicalGroups.find((group) => group.active && group.type === "deposed_party" && group.polityId === polityId && group.leaderCharacterId === actorId);
    let score = 4_000
      + (attackers + defenders === 0 ? 0 : Math.round(2_500 * (attackers / (attackers + defenders)) - 1_250))
      + Math.round(loyalty / 4)
      + Math.round((5_000 - legitimacyOf(world, polityId)) / 2)
      + Math.round((actor.prestigeBps - 5_000) / 4)
      + (opening ? 1_000 : -1_500);
    if (route === "coup" && customary) score += 1_000;
    if (route === "revolution") score += Math.round(grievanceOf(world, polityId) / 4) + Math.round((5_000 - stabilityOf(world, capital)) / 3) - (attackers === 0 ? 500 : 0);
    if (route === "restoration") score += Math.round((party?.strengthBps ?? 0) / 3);
    chanceBps = Math.max(500, Math.min(9_000, score));
  }
  const roll = stableHash([input.gameId, "regime", actorId, polityId, route, input.atStep]) % 10_000;
  const succeeded = roll < chanceBps;
  const how = { coup: "seize", revolution: "raise the people of", restoration: "restore the old government of", imposition: "dictate the government of" }[route];

  if (!succeeded) {
    let next = vacateOfficesOf(world, actorId, "removal", input.atStep);
    next = {
      ...next,
      characters: next.characters.map((character) => (character.id === actorId ? { ...character, prestigeBps: Math.max(0, character.prestigeBps - FAILED_STANDING_BPS) } : character)),
      material: {
        ...next.material,
        forces: next.material.forces.map((force) => (near.some((army) => army.id === force.id) ? { ...force, moraleBps: Math.max(0, force.moraleBps - 2_000), cohesionBps: Math.max(0, force.cohesionBps - 1_500) } : force)),
      },
    };
    const hunted = createPressure(next, {
      id: boundedId("hunted", actorId, input.atStep), characterId: actorId, kind: "political_danger", intensity: 85,
      label: `His attempt to ${how} ${polity.name} failed; he is a traitor to its government, and hunted`.slice(0, 200),
      sourceEventId: null, atStep: input.atStep, reviewInSteps: 3, expiresInSteps: 180, visibility: "public",
    });
    next = { ...next, characters: [...hunted.characters], characterPressures: [...hunted.characterPressures] };
    if (ruler !== null) {
      const punish = createPressure(next, {
        id: boundedId("punish", ruler.id, actorId, input.atStep), characterId: ruler.id, kind: "opportunity", intensity: 70,
        label: `${actor.name} [${actor.id}] tried to ${how} ${polity.name} and failed: he may be tried, exiled or put to death`.slice(0, 200),
        sourceEventId: null, atStep: input.atStep, reviewInSteps: 3, expiresInSteps: 60, visibility: "polity",
      });
      next = { ...next, characters: [...punish.characters], characterPressures: [...punish.characterPressures] };
    }
    return {
      world: next,
      succeeded: false,
      chanceBps,
      facts: [{
        localId: `regime_failed_${actorId}_${input.atStep}`.slice(0, 60),
        kind: "regime_change_failed",
        summary: `${actor.name} tried to ${how} ${polity.name}, and failed${defenders > 0 ? `: the ${defenders} men who held the capital stood by its government` : ""}. He has lost his offices and much of his name, and is hunted.`,
        affectedRefs: [{ kind: "character", id: actorId }, { kind: "polity", id: polityId }, ...(ruler === null ? [] : [{ kind: "character" as const, id: ruler.id }])],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 85,
      }],
    };
  }

  // ── What follows ───────────────────────────────────────────────────────
  const origin = route === "coup" || route === "revolution" ? "seizure" : route;
  const seatRuler = route === "imposition" ? null : actorId;
  const summary = {
    coup: `${actor.name} took it with ${attackers} men${ruler === null ? "" : `, and ${ruler.name} is put out`}.`,
    revolution: `Its people rose behind ${actor.name}${ruler === null ? "" : `, and ${ruler.name} is put out`}.`,
    restoration: `${actor.name} has taken back what the old government lost.`,
    imposition: `${actor.name} dictated it for ${world.map.polities.find((candidate) => candidate.id === actor.polityId)?.name ?? "his power"}.`,
  }[route];
  let next: WorldState;
  let facts: FactProposalDraft[];
  if (targetForm === current && route === "coup") {
    // The same state under a new master: only the seat changes hands.
    next = world;
    const office = rulerOfficeOf(next, polityId, input.government);
    if (ruler !== null) next = vacateOfficesOf(next, ruler.id, "deposed", input.atStep);
    if (office !== null) {
      const vacant = next.material.officeSeats.find((seat) => seat.officeId === office.id && seat.status === "vacant")?.id ?? null;
      next = seatCharacterInOffice(next, actorId, { office, vacantSeatId: vacant }, input.atStep, office.termDays ?? null);
    }
    const done = recastHistoryOnly(next, polityId, current, actorId, input.atStep, summary);
    next = ruler === null ? done : foundDeposedParty(done, polityId, ruler.id, [ruler.id], input.atStep, current);
    facts = [{
      localId: `regime_${polityId}_${input.atStep}`.slice(0, 60),
      kind: "constitution_changed",
      summary: `${actor.name} has seized ${polity.name} and made himself its master. ${summary}`,
      affectedRefs: [{ kind: "character", id: actorId }, { kind: "polity", id: polityId }, ...(ruler === null ? [] : [{ kind: "character" as const, id: ruler.id }])],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 85,
    }];
  } else {
    const done = recast({ world, polityId, toForm: targetForm, origin, byCharacterId: actorId, seatRuler, government: input.government, atStep: input.atStep, summary });
    next = done.world;
    facts = done.facts;
  }
  if (route === "restoration") {
    next = {
      ...next,
      material: {
        ...next.material,
        politicalGroups: next.material.politicalGroups.map((group) => (group.active && group.type === "deposed_party" && group.polityId === polityId && group.leaderCharacterId === actorId
          ? { ...group, active: false, endedAtStep: input.atStep } : group)),
      },
    };
  }
  next = {
    ...next,
    material: {
      ...next.material,
      polityLegitimacy: route === "restoration" ? next.material.polityLegitimacy : adjustPolityLegitimacy(next.material.polityLegitimacy, polityId, -SEIZED_LEGITIMACY_BPS, `${actor.name} took the state by force`, boundedId("regime", actorId, input.atStep)),
    },
    society: route === "coup" || (route === "revolution" && near.length > 0)
      ? { ...next.society, precedents: [...next.society.precedents, { polityId, kind: "army_made_ruler" as const, key: actorId, atStep: input.atStep }].slice(-200) }
      : next.society,
    // The moment is spent.
    characterPressures: next.characterPressures.map((pressure) => (pressure.characterId === actorId && pressure.id.startsWith(`opening:${polityId}:`) && pressure.status === "active" ? { ...pressure, status: "resolved" as const } : pressure)),
  };
  return { world: next, facts, succeeded: true, chanceBps };
}

/** A seat taken without the constitution changing: its history still says who took it. */
function recastHistoryOnly(world: WorldState, polityId: string, form: GovernmentForm, byCharacterId: string, atStep: number, summary: string): WorldState {
  return {
    ...world,
    constitutions: world.constitutions.map((entry) => (entry.polityId === polityId
      ? { ...entry, history: [...entry.history, { atStep, origin: "seizure" as const, fromForm: form, toForm: form, summary: summary.slice(0, 400), byCharacterId }].slice(-24) }
      : entry)),
  };
}

/** In words, for a prompt: a form. */
export const formInWords = (form: GovernmentForm): string => GOVERNMENT_FORM_IN_WORDS[form];
