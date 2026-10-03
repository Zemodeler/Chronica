import {
  aptitude,
  boundedId,
  campaignsOf,
  doctrineNetGain,
  doctrinesOf,
  drillCeilingOf,
  formArmies,
  forceLever,
  formationOf,
  formationTemplateOf,
  nameThePost,
  nextRankUp,
  polityLever,
  serveInArmy,
  setPost,
  sharingHisUnit,
  skillShare,
  stableHash,
  unitOfficerRank,
  warfareWith,
  warsOf,
  DOCTRINE_UPKEEP_PER_THOUSAND_PER_POINT,
  EFFECT_PERIOD_DAYS,
  type BattleResult,
  type Character,
  type Doctrine,
  type FactProposalDraft,
  type Force,
  type Honour,
  type MilitaryEstablishment,
  type ScenarioWarfareRules,
  type ServiceRecord,
  type WarfareRules,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Armies as the men in them live them (docs/plans/armies-in-detail.md).
 *
 * Once a tick, before the field is kept (`campaign.ts`), so the days counted
 * are the days `keepTheField` is about to reckon:
 *
 * - new men are drawn up the way their power's establishment says;
 * - formations drill, or forget their drill, and harden with the seasons;
 * - a doctrine's keep is paid each month, or it falls into disuse;
 * - a refit ends;
 * - every named man in an army has a place in it, the man the story is about
 *   has a named officer and named comrades, years under the standards are
 *   counted as campaigns, and a man who has served his campaigns goes home;
 * - a post emptied by death is filled -- by promotion where there is a man fit
 *   for it, the player among them.
 *
 * After a battle, `recordTheFight` writes what the men did into their records:
 * battles, wounds, decorations, punishments, and the experience of the
 * formations that fought.
 */

/** What a day's drill is worth, before the commander and the doctrine. */
const DRILL_PER_DAY_BPS = 35;
/** What a day without drill costs, above the floor drill fades to. */
const FORGET_PER_DAY_BPS = 3;
const FORGET_FLOOR_BPS = 2_000;
/** What drill takes out of the men, a day. */
const DRILL_FATIGUE_PER_DAY_BPS = 20;
/** What a season at war is worth to men in the field, spread over its days. */
const WAR_EXPERIENCE_PER_DAY_BPS = 150 / 90;
/** What a battle is worth to a formation that fought in it. */
const BATTLE_EXPERIENCE_BPS = 500;
const VICTORY_EXPERIENCE_BPS = 200;
/** A year under the standards is a campaign. */
const CAMPAIGN_DAYS = 365;

const STANDING_BPS = { slight: 150, marked: 400, great: 800 } as const;

export interface KeepTheRanksInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly warfare?: ScenarioWarfareRules | undefined;
  readonly ids: IdFactory;
  readonly playerCharacterId: string | null;
}

const clampBps = (value: number): number => Math.max(0, Math.min(10_000, Math.round(value)));

export function keepTheRanks(input: KeepTheRanksInput): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  if (input.world.establishments.length === 0) return { world: input.world, facts };
  let world = formArmies(input.world, input.toDay);
  const rules = input.warfare === undefined ? undefined : warfareWith(world, input.warfare);
  world = drillAndHarden(world, input.toDay, rules);
  world = finishRefits(world, input.toDay, facts);
  world = settleDoctrines(world, input.toDay, input.ids, facts);
  world = keepServiceRecords(world, input.toDay, rules, input.playerCharacterId, facts);
  return { world, facts };
}

// ── Drill and seasons ─────────────────────────────────────────────────────

function drillAndHarden(world: WorldState, toDay: number, rules: WarfareRules | undefined): WorldState {
  const marching = new Set(world.projects.flatMap((project) =>
    (project.status === "funded" || project.status === "in_progress") && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId !== null
      ? [project.completionOutcome.forceId]
      : []));
  const besieging = new Set(world.sieges.filter((siege) => siege.status === "active").map((siege) => siege.forceId));
  const fighting = new Set(world.engagements.filter((engagement) => engagement.status === "open").flatMap((engagement) => [...engagement.attackerForceIds, ...engagement.defenderForceIds]));
  let changed = false;
  const forces = world.material.forces.map((force) => {
    if ((force.formations ?? []).length === 0 || force.reckonedToStep === undefined) return force;
    const days = toDay - force.reckonedToStep;
    if (days <= 0) return force;
    const atWar = warsOf(world.polityAgreements, force.polityId).length > 0;
    const paid = force.payArrearsPeriods === 0;
    const fed = force.provisionStatus === "provisioned";
    const free = paid && fed && !marching.has(force.id) && !besieging.has(force.id) && !fighting.has(force.id);
    const drills = force.drilling === true && free;
    const commander = world.characters.find((character) => character.id === force.commanderCharacterId && character.alive);
    const hand = 1 + (commander === undefined ? 0 : skillShare(aptitude(commander, "authority"), 0.4) + skillShare(aptitude(commander, "strategist"), 0.2));
    const formations = (force.formations ?? []).map((formation) => {
      const row = force.personnel.find((candidate) => candidate.formationId === formation.id);
      if (row === undefined) return formation;
      let training = formation.trainingBps;
      if (drills || (formation.drilling === true && free)) {
        const rate = 1 + forceLever(rules, { ...force, personnel: [row] }, "drill_rate");
        const ceiling = drillCeilingOf(rules, force, row);
        // A formation refitting drills twice as hard: it is learning a new way.
        const refitting = formation.refitUntilStep !== undefined && formation.refitUntilStep > toDay ? 2 : 1;
        if (training < ceiling) training = Math.min(ceiling, training + days * DRILL_PER_DAY_BPS * hand * rate * refitting);
      } else if (training > FORGET_FLOOR_BPS) {
        training = Math.max(FORGET_FLOOR_BPS, training - days * FORGET_PER_DAY_BPS);
      }
      const experience = atWar ? Math.min(10_000, formation.experienceBps + days * WAR_EXPERIENCE_PER_DAY_BPS) : formation.experienceBps;
      if (Math.round(training) === formation.trainingBps && Math.round(experience) === formation.experienceBps) return formation;
      return { ...formation, trainingBps: clampBps(training), experienceBps: clampBps(experience) };
    });
    const tired = drills || (force.formations ?? []).some((formation) => formation.drilling === true && free) ? Math.min(10_000, force.fatigueBps + days * DRILL_FATIGUE_PER_DAY_BPS) : force.fatigueBps;
    if (formations.every((formation, index) => formation === force.formations![index]) && tired === force.fatigueBps) return force;
    changed = true;
    return { ...force, formations, fatigueBps: tired };
  });
  return changed ? { ...world, material: { ...world.material, forces } } : world;
}

function finishRefits(world: WorldState, toDay: number, facts: FactProposalDraft[]): WorldState {
  let changed = false;
  const forces = world.material.forces.map((force) => {
    const done = (force.formations ?? []).filter((formation) => formation.refitUntilStep !== undefined && formation.refitUntilStep <= toDay);
    if (done.length === 0) return force;
    changed = true;
    facts.push({
      localId: boundedId("refit", force.id, toDay),
      kind: "army_refitted",
      summary: `${force.name} has finished its refit: ${[...new Set(done.map((formation) => formation.bodyLabel))].join(", ")} now fight the new way.`,
      affectedRefs: [{ kind: "force", id: force.id }, { kind: "polity", id: force.polityId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 35,
    });
    return {
      ...force,
      formations: (force.formations ?? []).map((formation) => {
        if (!done.includes(formation)) return formation;
        const { refitUntilStep: _done, ...rest } = formation;
        return { ...rest, raisedAtStep: toDay };
      }),
    };
  });
  return changed ? { ...world, material: { ...world.material, forces } } : world;
}

// ── A doctrine's keep ─────────────────────────────────────────────────────

/** The men a doctrine reaches, across its power's armies or in its own army. */
export function menUnderDoctrine(world: WorldState, doctrine: Doctrine): number {
  const rules = { establishments: world.establishments, doctrines: [doctrine], today: world.elapsedStep } as unknown as WarfareRules;
  let men = 0;
  for (const force of world.material.forces) {
    if (doctrine.forceId !== null ? force.id !== doctrine.forceId : force.polityId !== doctrine.polityId) continue;
    for (const row of force.personnel) if (doctrinesOf(rules, force, row).length > 0) men += row.fit;
  }
  return men;
}

/** What a doctrine's keep comes to a month, as things stand. */
export function doctrineUpkeep(world: WorldState, doctrine: Doctrine): number {
  const net = doctrineNetGain(doctrine.effects);
  if (net <= 0) return 0;
  return Math.max(1, Math.round((menUnderDoctrine(world, doctrine) / 1_000) * net * DOCTRINE_UPKEEP_PER_THOUSAND_PER_POINT));
}

function settleDoctrines(world: WorldState, toDay: number, ids: IdFactory, facts: FactProposalDraft[]): WorldState {
  let next = world;
  for (const doctrine of world.doctrines) {
    if (doctrine.lapsedAtStep !== null || doctrine.upkeepAccountId === null) continue;
    const settled = doctrine.settledThroughStep ?? doctrine.adoptedAtStep;
    const periods = Math.floor((toDay - settled) / EFFECT_PERIOD_DAYS);
    if (periods <= 0) continue;
    let lapsed = false;
    let through = settled;
    for (let period = 0; period < periods; period += 1) {
      const due = doctrineUpkeep(next, doctrine);
      through += EFFECT_PERIOD_DAYS;
      if (due <= 0) continue;
      const payer = next.material.accounts.find((account) => account.id === doctrine.upkeepAccountId);
      if (payer === undefined || payer.balance < due) { lapsed = true; break; }
      next = {
        ...next,
        material: {
          ...next.material,
          accounts: next.material.accounts.map((account) => (account.id === payer.id ? { ...account, balance: account.balance - due } : account)),
          transactions: [...next.material.transactions, {
            id: ids.next("txn"), atStep: toDay, kind: "upkeep" as const, amount: due, sourceAccountId: payer.id,
            cause: { kind: "obligation" as const, id: doctrine.id, explanation: `The keep of ${doctrine.label}` }, visibility: "polity" as const,
          }].slice(-500),
        },
      };
    }
    next = { ...next, doctrines: next.doctrines.map((candidate) => (candidate.id === doctrine.id ? { ...candidate, settledThroughStep: through, ...(lapsed ? { lapsedAtStep: toDay } : {}) } : candidate)) };
    if (lapsed) {
      facts.push({
        localId: boundedId("doctrine-lapsed", doctrine.id, toDay),
        kind: "doctrine_lapsed",
        summary: `${doctrine.label} has fallen into disuse: nobody could pay for it.`,
        affectedRefs: [{ kind: "polity", id: doctrine.polityId }, ...(doctrine.forceId === null ? [] : [{ kind: "force" as const, id: doctrine.forceId }])],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 45,
      });
    }
  }
  return next;
}

// ── Service records ───────────────────────────────────────────────────────

function establishmentFor(world: WorldState, polityId: string): MilitaryEstablishment | undefined {
  return world.establishments.find((establishment) => establishment.polityId === polityId);
}

function withService(world: WorldState, characterId: string, change: (service: ServiceRecord) => ServiceRecord): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === characterId && character.service !== undefined ? { ...character, service: change(character.service) } : character)),
  };
}

export { campaignsOf };

function keepServiceRecords(world: WorldState, toDay: number, rules: WarfareRules | undefined, playerId: string | null, facts: FactProposalDraft[]): WorldState {
  let next = world;
  for (const force of world.material.forces) {
    const establishment = establishmentFor(next, force.polityId);
    if (establishment === undefined || (force.formations ?? []).length === 0) continue;
    for (const memberId of force.memberCharacterIds) {
      const member = next.characters.find((character) => character.id === memberId);
      if (member === undefined || !member.alive) continue;
      if (member.service === undefined || member.service.forceId !== force.id || member.service.dischargedAtStep !== undefined) {
        next = serveInArmy(next, { characterId: memberId, forceId: force.id, role: member.service?.rankId ?? "soldier", atStep: toDay, nameTheChain: memberId === playerId });
        continue;
      }
      if (memberId === playerId) next = serveInArmy(next, { characterId: memberId, forceId: force.id, role: "", atStep: toDay, nameTheChain: true });
      // A year under the standards is a campaign.
      const since = member.service.lastCampaignAtStep ?? member.service.enlistedAtStep;
      if (toDay - since >= CAMPAIGN_DAYS) {
        const years = Math.floor((toDay - since) / CAMPAIGN_DAYS);
        next = withService(next, memberId, (service) => ({ ...service, campaigns: Math.min(60, service.campaigns + years), lastCampaignAtStep: since + years * CAMPAIGN_DAYS }));
      }
      next = dischargeIfServed(next, force, establishment, memberId, toDay, rules, facts, playerId);
    }
  }
  next = clearDeadPosts(next);
  next = fillThePlayersChain(next, toDay, playerId, facts);
  return next;
}

function dischargeIfServed(world: WorldState, force: Force, establishment: MilitaryEstablishment, characterId: string, toDay: number, rules: WarfareRules | undefined, facts: FactProposalDraft[], playerId: string | null): WorldState {
  const member = world.characters.find((character) => character.id === characterId);
  const service = member?.service;
  if (member === undefined || service === undefined || service.formationId === null) return world;
  // Officers serve on; it is the men in the ranks who are owed their discharge.
  const rank = establishment.ranks.find((candidate) => candidate.id === service.rankId);
  if (rank !== undefined && rank.level !== "ranks") return world;
  const formation = formationOf(force, service.formationId);
  const horse = formation?.line === "wing";
  const owed = (horse ? establishment.serviceCampaigns.horse : establishment.serviceCampaigns.foot) + Math.round(polityLever(rules, force.polityId, "service_length"));
  if (service.campaigns + service.priorCampaigns < owed) return world;
  const claim = establishment.discharge;
  let next = withService(world, characterId, (record) => ({ ...record, forceId: null, formationId: null, unitIndex: null, dischargedAtStep: toDay, dischargeClaim: claim }));
  next = {
    ...next,
    material: {
      ...next.material,
      forces: next.material.forces.map((candidate) => (candidate.id === force.id
        ? { ...candidate, memberCharacterIds: candidate.memberCharacterIds.filter((id) => id !== characterId), posts: (candidate.posts ?? []).filter((post) => post.characterId !== characterId) }
        : candidate)),
    },
    society: { ...next.society, discharged: [...next.society.discharged, { polityId: force.polityId, count: 1, atStep: toDay }].slice(-400) },
  };
  facts.push({
    localId: boundedId("discharged", characterId, toDay),
    kind: "soldier_discharged",
    summary: `${member.name} has served his ${owed} campaigns and is discharged from ${force.name}${claim === "land" ? ", owed land" : claim === "cash" ? ", owed his bounty" : ""}.`,
    affectedRefs: [{ kind: "character", id: characterId }, { kind: "force", id: force.id }],
    visibility: characterId === playerId ? "private" : "polity",
    discoveryState: characterId === playerId ? "private" : "polity",
    knowableInDays: 0,
    significance: characterId === playerId ? 60 : 15,
  });
  return next;
}

function clearDeadPosts(world: WorldState): WorldState {
  const living = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
  let changed = false;
  const forces = world.material.forces.map((force) => {
    const posts = (force.posts ?? []).filter((post) => living.has(post.characterId) && (force.memberCharacterIds.includes(post.characterId) || force.commanderCharacterId === post.characterId));
    if (posts.length === (force.posts ?? []).length) return force;
    changed = true;
    return { ...force, posts };
  });
  return changed ? { ...world, material: { ...world.material, forces } } : world;
}

/**
 * A post over the player emptied by death is filled the day it falls empty:
 * by the player, if he is the man next in line and has earned it; by one of
 * his comrades, if one has; or by a man brought in.
 */
function fillThePlayersChain(world: WorldState, toDay: number, playerId: string | null, facts: FactProposalDraft[]): WorldState {
  if (playerId === null) return world;
  const player = world.characters.find((character) => character.id === playerId && character.alive);
  const service = player?.service;
  if (player === undefined || service?.forceId == null || service.formationId === null || service.unitIndex === null) return world;
  const force = world.material.forces.find((candidate) => candidate.id === service.forceId);
  const establishment = force === undefined ? undefined : establishmentFor(world, force.polityId);
  const formation = force === undefined ? undefined : formationOf(force, service.formationId);
  if (force === undefined || establishment === undefined || formation === undefined) return world;
  const officer = unitOfficerRank(establishment, formation.templateId);
  if (officer === undefined || officer.id === service.rankId) return world;
  const held = (force.posts ?? []).some((post) => post.formationId === formation.id && post.unitIndex === service.unitIndex && post.rankId === officer.id);
  if (held) return world;
  // Was there ever an officer here? If not, this is not a vacancy -- name one.
  const emptied = world.characters.some((character) => !character.alive && character.service?.formationId === formation.id && character.service.unitIndex === service.unitIndex && character.service.rankId === officer.id);
  const nextUp = nextRankUp(establishment, formation.templateId, service.rankId);
  if (emptied && nextUp?.id === officer.id && deservesPromotion(player, toDay)) {
    let next = withService(world, playerId, (record) => ({ ...record, rankId: officer.id, promotedAtStep: toDay }));
    next = setPost(next, force.id, { formationId: formation.id, unitIndex: service.unitIndex, rankId: officer.id, characterId: playerId });
    facts.push(promotionFact(player, officer.label, force, toDay));
    return next;
  }
  if (emptied) {
    const comrade = sharingHisUnit(world, force.id, formation.id, service.unitIndex)
      .map((id) => world.characters.find((character) => character.id === id))
      .filter((character): character is Character => character !== undefined && character.id !== playerId && character.alive && character.service !== undefined)
      .filter((character) => nextRankUp(establishment, formation.templateId, character.service!.rankId)?.id === officer.id)
      .sort((a, b) => campaignsOf(b) - campaignsOf(a))[0];
    if (comrade !== undefined) {
      let next = withService(world, comrade.id, (record) => ({ ...record, rankId: officer.id, promotedAtStep: toDay }));
      next = setPost(next, force.id, { formationId: formation.id, unitIndex: service.unitIndex, rankId: officer.id, characterId: comrade.id });
      facts.push(promotionFact(comrade, officer.label, force, toDay, player));
      return next;
    }
  }
  return nameThePost(world, force.id, formation.id, service.unitIndex, officer, toDay);
}

/**
 * Whether a man has earned the step up: campaigns behind him, a battle or two,
 * and decorations count; a punishment counts against; standing counts a little.
 * Deterministic for the man and the day.
 */
function deservesPromotion(character: Character, toDay: number): boolean {
  const service = character.service;
  if (service === undefined) return false;
  const merit = Math.min(4, campaignsOf(character)) * 8 + Math.min(5, service.battles) * 6 + service.decorations.length * 20 - service.punishments.length * 25 + character.prestigeBps / 400 + aptitude(character, "authority") / 5;
  const roll = stableHash([character.id, toDay, "promotion"]) % 100;
  return roll < Math.max(10, Math.min(90, merit));
}

function promotionFact(character: Character, rankLabel: string, force: Force, toDay: number, overPlayer?: Character): FactProposalDraft {
  return {
    localId: boundedId("promoted", character.id, toDay),
    kind: "soldier_promoted",
    summary: overPlayer === undefined
      ? `${character.name} is made ${rankLabel} in ${force.name}.`
      : `${character.name} is made ${rankLabel} over ${overPlayer.name}'s unit in ${force.name}.`,
    affectedRefs: [{ kind: "character", id: character.id }, { kind: "force", id: force.id }, ...(overPlayer === undefined ? [] : [{ kind: "character" as const, id: overPlayer.id }])],
    visibility: "private",
    discoveryState: "private",
    knowableInDays: 0,
    significance: 55,
  };
}

// ── After a battle ────────────────────────────────────────────────────────

export interface FightOutcome {
  readonly characterId: string;
  readonly forceId: string;
  readonly outcome: "killed" | "maimed" | "wounded" | "unharmed";
}

function pickHonour(establishment: MilitaryEstablishment, kind: Honour["kind"], reasons: readonly Honour["for"][], seed: string): Honour | undefined {
  // A punishment that kills -- the fustuarium, decimation -- is a court's and a
  // story's, never a roll after a battle: one man is not decimated.
  const fitting = establishment.honours.filter((honour) => honour.kind === kind && reasons.includes(honour.for) && !(kind === "punishment" && honour.mortal));
  if (fitting.length === 0) return undefined;
  return fitting[stableHash([seed, kind]) % fitting.length];
}

/**
 * What a battle wrote into the men who fought it: every formation that fought
 * is the harder for it; every named man counts the battle and his wounds;
 * the bold are sometimes decorated and the timid sometimes punished.
 */
export function recordTheFight(world: WorldState, result: BattleResult, fates: readonly FightOutcome[], playerId: string | null): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  const attackers = new Set(result.attackerForceIds);
  const won = (forceId: string): boolean => (result.outcome === "attacker_victory" && attackers.has(forceId)) || (result.outcome === "defender_victory" && !attackers.has(forceId));
  const lost = (forceId: string): boolean => (result.outcome === "attacker_victory" && !attackers.has(forceId)) || (result.outcome === "defender_victory" && attackers.has(forceId));
  const fought = new Set(result.casualties.flatMap((casualty) => (casualty.formationId === undefined ? [] : [casualty.formationId])));
  let next: WorldState = {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => {
        if (!result.participantIds.includes(force.id) || (force.formations ?? []).length === 0) return force;
        const gain = BATTLE_EXPERIENCE_BPS + (won(force.id) ? VICTORY_EXPERIENCE_BPS : 0);
        return {
          ...force,
          formations: (force.formations ?? []).map((formation) => (fought.has(formation.id)
            ? { ...formation, experienceBps: clampBps(formation.experienceBps + gain) }
            : formation)),
        };
      }),
    },
  };
  for (const fate of fates) {
    if (fate.outcome === "killed") continue;
    const person = next.characters.find((character) => character.id === fate.characterId);
    const service = person?.service;
    const force = next.material.forces.find((candidate) => candidate.id === fate.forceId);
    if (person === undefined || service === undefined || force === undefined || service.forceId !== force.id) continue;
    const establishment = establishmentFor(next, force.polityId);
    const hurt = fate.outcome === "wounded" || fate.outcome === "maimed";
    next = withService(next, person.id, (record) => ({ ...record, battles: Math.min(500, record.battles + 1), wounds: Math.min(100, record.wounds + (hurt ? 1 : 0)) }));
    if (establishment === undefined) continue;
    const roll = (stableHash([result.battleId, person.id, "deed"]) % 1_000) / 1_000;
    const bold = service.conduct === "glory";
    const timid = service.conduct === "cautious";
    const decorateChance = bold ? (won(force.id) ? 0.3 : lost(force.id) ? 0.1 : 0.18) : service.conduct === "steady" ? (won(force.id) ? 0.04 : 0.01) : 0;
    const punishChance = timid && lost(force.id) ? 0.25 : timid ? 0.06 : 0;
    if (roll < decorateChance) {
      const honour = pickHonour(establishment, "decoration", hurt ? ["saving_a_comrade", "valour"] : ["valour", "saving_a_comrade"], `${result.battleId}:${person.id}`);
      if (honour === undefined) continue;
      next = withService(next, person.id, (record) => ({ ...record, decorations: [...record.decorations, { label: honour.label, atStep: next.elapsedStep, reason: `At the battle in ${result.battleId.split(":")[0] ?? "the field"}` }].slice(-20) }));
      next = shiftStanding(next, person.id, STANDING_BPS[honour.standing]);
      facts.push(deedFact(person, `${person.name} is given the ${honour.label} for his conduct in the battle.`, person.id === playerId, result.battleId));
    } else if (roll > 1 - punishChance) {
      const honour = pickHonour(establishment, "punishment", ["flight", "disobedience"], `${result.battleId}:${person.id}`);
      if (honour === undefined) continue;
      next = withService(next, person.id, (record) => ({ ...record, punishments: [...record.punishments, { label: honour.label, atStep: next.elapsedStep, reason: "Seen to hang back when the line was pressed" }].slice(-20) }));
      next = shiftStanding(next, person.id, -STANDING_BPS[honour.standing]);
      facts.push(deedFact(person, `${person.name} is punished with ${honour.label}: he was seen to hang back when the line was pressed.`, person.id === playerId, result.battleId));
    }
  }
  return { world: next, facts };
}

function shiftStanding(world: WorldState, characterId: string, bps: number): WorldState {
  return { ...world, characters: world.characters.map((character) => (character.id === characterId ? { ...character, prestigeBps: clampBps(character.prestigeBps + bps) } : character)) };
}

function deedFact(person: Character, summary: string, isPlayer: boolean, battleId: string): FactProposalDraft {
  return {
    localId: boundedId("deed", person.id, battleId),
    kind: "soldier_deed",
    summary,
    affectedRefs: [{ kind: "character", id: person.id }],
    visibility: isPlayer ? "private" : "polity",
    discoveryState: isPlayer ? "private" : "polity",
    knowableInDays: 0,
    significance: isPlayer ? 55 : 20,
  };
}

/** Exposed for the muster and the slice: the template a formation was drawn from. */
export function templateFor(world: WorldState, force: Force, formationId: string) {
  const formation = formationOf(force, formationId);
  return formation === undefined ? undefined : formationTemplateOf(establishmentFor(world, force.polityId), formation.templateId);
}
