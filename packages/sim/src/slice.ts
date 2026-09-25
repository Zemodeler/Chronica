import { findPolityGaps } from "./population";
import type { NarratorSeed } from "./narrator";
import { renderCharacterPortrait } from "./cognition";
import { ruleInWords } from "./mechanics/mechanic-words";

import {
  allOffices,
  allTroopCategories,
  bandStrength,
  buildStation,
  currentAgeYears,
  describeAuthority,
  factsKnownToStation,
  holdsPolityStanding,
  reachesPerson,
  seesAccount,
  seesForce,
  factsKnownTo,
  cohesionInWords,
  formatWorldDate,
  openStorylines,
  type Fact,
  type Office,
  type OrderPartyRef,
  type ScenarioClock,
  type ScenarioWarfareRules,
  type WorldState,
  DEFAULT_STRUCTURE_EFFECTS,
  effectInWords,
  taxBurdenInWords,
  taxBurdens,
} from "@chronica/shared";

/**
 * The compressed world slice (VISION §27).
 *
 * `WorldState` is far too large to send -- a full scenario world runs to
 * hundreds of kilobytes of JSON, most of it map geometry and history that has
 * no bearing on the order in hand. This projects the part that does.
 *
 * Two rules govern what goes in:
 *
 *  - **Bounded.** Every list has a hard cap. A slice that grows with the world
 *    would make the loop slower and more expensive the longer a campaign runs,
 *    which is exactly backwards.
 *  - **Knowable.** History is filtered through `factsVisibleTo` for the
 *    ordering actor. The orchestrator speaks for the player's government, so it
 *    must not be handed the secrets that government has not discovered
 *    (VISION §14) -- otherwise the world starts acting on knowledge nobody in
 *    it actually has.
 */

const CAPS = { characters: 12, forces: 10, projects: 8, accounts: 6, stances: 8, facts: 12, events: 8, intents: 8, provinces: 40, citiesPerProvince: 4, groundPerProvince: 4, standingPlans: 6, foreignForces: 12, foreignFigures: 12, outlooks: 8, institutions: 4, procedures: 6, strainedProvinces: 8, holdings: 6, arrangements: 8, buildingsPerProvince: 3, faiths: 8, debts: 6, trade: 6, storylines: 6, letters: 6, agreements: 8 } as const;

export interface SliceEvent {
  readonly kind: string;
  readonly summary: string;
  readonly dueInDays: number;
  /** The thread it belongs to, as "Title [id]", so the orchestrator advances the right one. */
  readonly thread?: string | undefined;
}

/** A question the world put to the ruler, and the answer they gave. */
export interface AnsweredDecision {
  readonly prompt: string;
  readonly label: string;
  readonly summary: string;
}

export interface WorldSliceInput {
  readonly world: WorldState;
  readonly clock: ScenarioClock;
  /**
   * The scenario's offices, so the acting person's station can be read.
   *
   * Required rather than defaulted: a call site that forgot it would silently
   * show a consul the world a private citizen sees, and then answer his order
   * as though he held nothing -- an invisible demotion, and exactly the shape
   * of bug this codebase keeps paying for. A compile error makes every caller
   * decide.
   */
  readonly offices: readonly Office[];
  /**
   * The scenario's warfare rules, so the kinds of troops the world has can be
   * named back to it.
   *
   * `force_reinforce.categoryId` takes an id that appeared nowhere in the
   * slice, so "take the Gauls into the Thirteenth as auxiliaries" could only be
   * written by guessing one. Optional, because a slice without it is still a
   * true slice -- it simply cannot say what kinds of soldier there are.
   */
  readonly warfare?: ScenarioWarfareRules | undefined;
  readonly actorRef: OrderPartyRef;
  readonly actorPolityId: string | null;
  readonly orderText: string | null;
  readonly answeredDecision?: AnsweredDecision | undefined;
  readonly facts: readonly Fact[];
  readonly dueEvents: readonly SliceEvent[];
  readonly pendingEvents: readonly SliceEvent[];
  /** What the narrator has decided stirs this burst, if anything. */
  readonly narratorSeed?: NarratorSeed | null | undefined;
  /** Everything that stirs this burst. `narratorSeed` is the one-seed form of the same thing. */
  readonly narratorSeeds?: readonly NarratorSeed[] | undefined;
}

export interface WorldSlice {
  readonly date: string;
  readonly order: string | null;
  readonly answeredDecision: AnsweredDecision | null;
  readonly actor: {
    readonly id: string;
    readonly name: string;
    /** The id, because a delta must name it. */
    readonly office: string | null;
    /** And the label, because "roman-consul" is not a thing a person is called. */
    readonly officeLabel: string | null;
    readonly polityId: string | null;
    readonly polityName: string | null;
    /** The same section cognition builds for an NPC. */
    readonly portrait: string;
    /** What their grants actually permit, in words. */
    readonly permitted: readonly string[];
  };
  readonly economy: readonly { readonly id: string; readonly label: string; readonly balance: number }[];
  readonly monthlyIncome: number;
  readonly monthlyExpenditure: number;
  /** How hard the power's own lands are being taxed, for whoever can open its treasury. */
  readonly taxBurden: { readonly asked: number; readonly bearable: number; readonly inWords: string } | null;
  readonly military: readonly {
    readonly id: string;
    readonly name: string;
    /** Men actually present. `authorizedStrength` is the paper figure and drifts after a battle. */
    /** Banded for an army that is not theirs: a bystander quotes a round figure. */
    readonly strength: number;
    readonly banded: boolean;
    /** Null for an army they neither command nor answer for. */
    readonly paperStrength: number | null;
    readonly morale: number | null;
    readonly provisions: string | null;
    readonly location: string;
    readonly locationId: string;
    readonly commander: string;
    /** Named men in its ranks, by id, so an order can name the one it means. */
    readonly ranks: readonly string[];
    /** How it means to fight when attacked, for whoever leads it. */
    readonly plan: string | null;
  }[];
  /**
   * Places, with what stands in them.
   *
   * `cities` and `ground` are here because three ops take an id the model was
   * never shown. `settlement_control_set` -- the op added so that taking
   * Messana could be said at all -- needed a settlement id that appeared
   * nowhere in the slice, so the only way to write one was to guess it; and
   * Agrigentum's is `settlement-agrigentum-fort`, which nothing would guess.
   * `force_modify.positionId` was in the same position: the scenario authored
   * Mount Etna as a pass worth holding and no order could name it.
   */
  readonly provinces: readonly {
    readonly id: string;
    readonly name: string;
    readonly controller: string;
    readonly cities: readonly { readonly id: string; readonly name: string; readonly controller: string; readonly walls: number }[];
    readonly ground: readonly { readonly id: string; readonly label: string; readonly type: string }[];
    /** What stands there and what it does. */
    readonly buildings: readonly string[];
    /** Belief as it has changed there. Empty where it has not. */
    readonly belief: readonly string[];
  }[];
  /** The faiths the world knows, by name. */
  readonly faiths: readonly string[];
  /**
   * Plans laid in advance and still standing, so the world can see what it has
   * waiting and call one off when the ground is given up.
   *
   * Only this government's own: a trap the enemy has laid is the enemy's
   * secret, and printing it here would be a fog-of-war leak of exactly the kind
   * the watch language was careful to avoid.
   */
  readonly standingPlans: readonly { readonly id: string; readonly label: string; readonly effect: string; readonly where: string }[];
  /** The kinds of soldier this world has, for an order that reinforces an army with one. */
  readonly troopKinds: readonly { readonly id: string; readonly label: string }[];
  readonly politics: readonly { readonly id: string; readonly name: string; readonly office: string | null; readonly age: number; readonly faith: string | null;
    /** Said only where it is not a free man: a woman, a slave and whose, a freedman and whose. */
    readonly standing: string | null }[];
  readonly diplomacy: readonly { readonly toward: string; readonly trust: number; readonly why: string }[];
  /** What the powers have standing between them: war, peace, alliance, tribute (VISION §27's active wars). */
  readonly agreements: readonly {
    readonly id: string;
    readonly kind: string;
    readonly ours: boolean;
    readonly between: string;
    readonly terms: string;
    readonly endsInDays: number | null;
  }[];
  /** Letters sent and not yet answered, in either direction (VISION §27's diplomatic commitments). */
  readonly letters: readonly {
    readonly id: string;
    readonly kind: string;
    readonly ours: boolean;
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly terms: string;
    readonly dueInDays: number | null;
  }[];
  /**
   * What each polity is trying to do (VISION §11), including foreign ones.
   *
   * The orchestrator is the world: it has to drive Carthage consistently with
   * Carthage's own aims, so it is shown them. Nobody inside the world gets this
   * view -- an NPC's cognition sees only their own government's outlook, and a
   * Chronicle is built from facts, never from here.
   */
  /** VISION §6: how far this government is still obeyed, and why. */
  readonly standing: readonly {
    readonly id: string;
    readonly kind: "polity" | "institution";
    readonly name: string;
    readonly legitimacy: number;
    readonly confidence: number | null;
    readonly causes: readonly string[];
  }[];
  /** What the country is actually made of -- people, manpower, food, order. */
  readonly country: {
    readonly provinces: number;
    readonly population: number;
    readonly availableManpower: number;
    readonly strained: readonly {
      readonly id: string;
      readonly name: string;
      readonly manpower: number;
      readonly food: number;
      readonly stability: number;
      readonly warDamage: number;
      readonly taxCapacity: number;
    }[];
  };
  /** Bodies that can decide something, and the terms on which they decide it. */
  readonly institutions: readonly {
    readonly id: string;
    readonly name: string;
    readonly threshold: number;
    /**
     * Who actually takes sides in it. Without their ids nobody can be recorded
     * as supporting anything -- so this is empty, never absent, for somebody
     * who does not sit in the body: everyone knows the Senate needs a majority,
     * and only its members know how the weight lies.
     */
    readonly blocs: readonly { readonly id: string; readonly name: string; readonly weight: number; readonly interest: string }[];
  }[];
  /** Factions outside any one body -- the other things that hold a position. */
  readonly factions: readonly { readonly id: string; readonly name: string; readonly kind: string; readonly members: number }[];
  /** Questions still open before them, with where the weight currently sits. */
  readonly council: readonly {
    readonly id: string;
    readonly label: string;
    readonly type: string;
    readonly institution: string | null;
    readonly sponsor: string;
    readonly mechanism: string;
    readonly stage: string;
    readonly dueInDays: number | null;
    /** Null for a question they are not party to. The question is public; the tally is not. */
    readonly supportWeight: number | null;
    readonly opposeWeight: number | null;
  }[];
  /** Land, and the gap between who owns it and who holds it. */
  readonly holdings: readonly { readonly id: string; readonly title: string; readonly holder: string; readonly holderId: string; readonly control: number; readonly territoryId: string; readonly monthlyYield: number | null }[];
  /**
   * VISION §9's dynamically created mechanics: a law, an institution, an
   * arrangement no typed schema fits. They were written and never read, so the
   * model could not see what it had itself created a turn earlier.
   */
  /** VISION §7: what is owed, to whom, and on what terms. */
  readonly debts: readonly {
    readonly id: string;
    readonly outstanding: number;
    readonly interest: number;
    readonly perPeriod: number;
    readonly lender: string;
    readonly terms: string;
    readonly status: string;
    readonly arrears: number;
  }[];
  /** Revenue that depends on somebody else, and can therefore be cut. */
  readonly trade: readonly { readonly id: string; readonly label: string; readonly amount: number; readonly counterparty: string; readonly active: boolean }[];
  readonly arrangements: readonly {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
    readonly owner: string | null;
    readonly attributes: readonly string[];
    readonly retired: boolean;
    /** What it goes on doing, in words, and whether it has stopped. */
    readonly effects: readonly string[];
    readonly lapsed: boolean;
    /** The rule behind it, in words, for the actor's own only; NPC-owned rules are theirs to know. */
    readonly rule: string | null;
  }[];
  readonly outlooks: readonly {
    readonly polityId: string;
    readonly name: string;
    readonly own: boolean;
    readonly objective: string;
    readonly riskTolerance: number;
    readonly concerns: readonly string[];
    readonly intentions: readonly string[];
  }[];
  /**
   * The world outside our borders, as far as it is plainly known. Filtering
   * foreign secrets is right; filtering the existence of the army marching at
   * us is not, and doing so left the orchestrator inventing placeholders for
   * enemies it could not see.
   */
  readonly foreignPowers: readonly { readonly id: string; readonly name: string; readonly provinces: number; readonly cohesion: string; readonly leaders: readonly string[]; readonly forces: readonly string[] }[];
  /** Countries holding land with nobody to speak or fight for them (VISION §5). */
  readonly populationGaps: readonly { readonly polityId: string; readonly name: string; readonly needsLeader: boolean; readonly needsForce: boolean; readonly provinceIds: readonly string[]; readonly why: string }[];
  readonly projects: readonly { readonly id: string; readonly label: string; readonly status: string; readonly nextMilestone: { readonly id: string; readonly label: string } | null }[];
  readonly intents: readonly { readonly actor: string; readonly action: string; readonly rationale: string }[];
  /** Ids are printed: a discovery has to name the fact it uncovered, and nothing else ever showed one. */
  readonly recentHistory: readonly { readonly id: string; readonly summary: string; readonly significance: number }[];
  readonly dueEvents: readonly SliceEvent[];
  readonly pendingEvents: readonly SliceEvent[];
  readonly openOrders: readonly { readonly id: string; readonly recipient: string; readonly status: string }[];
  /**
   * The threads the world is following (VISION §20). The orchestrator sees all
   * of them, secret ones included, for the same reason it sees every power's
   * outlook: it is the world, and must keep a plot consistent with itself.
   */
  readonly threads: readonly {
    readonly id: string;
    readonly title: string;
    readonly phase: string;
    readonly participants: readonly string[];
    readonly province: string | null;
    readonly stakes: string;
    readonly next: string;
    readonly factIds: readonly string[];
    readonly secret: boolean;
  }[];
  readonly seeds: readonly NarratorSeed[];
}

export function buildWorldSlice(input: WorldSliceInput): WorldSlice {
  const { world } = input;
  // Indexed rather than scanned. These are called from inside loops over
  // forces, provinces and powers, and the map is now the whole drawn world
  // rather than the twenty provinces it held when they were written.
  const characterNames = new Map(world.characters.map((character) => [character.id, character.name]));
  const provinceNames = new Map(world.map.provinces.map((province) => [province.id, province.name]));
  const polityNames = new Map(world.map.polities.map((polity) => [polity.id, polity.name]));
  const name = (id: string): string => characterNames.get(id) ?? id;
  const provinceName = (id: string): string => provinceNames.get(id) ?? id;
  const polityName = (id: string): string => polityNames.get(id) ?? id;

  const actor = world.characters.find((character) => character.id === input.actorRef.id);
  const ownPolity = input.actorPolityId;

  /**
   * What this person's place in the world actually reaches.
   *
   * Every section below was scoped by polity alone, which is the right question
   * for secrecy between powers and the wrong one inside a republic: a consul
   * and a grain merchant of the same Rome were handed the same world, differing
   * by one line in a hundred and forty-three.
   *
   * Station is an *inner* filter laid over that, and it narrows the readings
   * rather than the roster. Every force, province and person a delta might need
   * to name keeps its name and its id for everybody -- take those away and the
   * orchestrator invents placeholder ids for what it cannot see, which is the
   * regression this file already records once. What station gates is the
   * privileged reading: a balance, a morale score, a vote tally, a trust
   * number, a letter's terms.
   */
  const station = input.actorRef.kind === "character"
    ? buildStation({ world, characterId: input.actorRef.id, offices: input.offices })
    : null;
  /** Their government reads its own books; a private man reads his own. */
  const speaksForTheGovernment = station !== null && holdsPolityStanding(station);
  const reachesAccount = (accountId: string): boolean => station === null || seesAccount(station, accountId);
  const reachesForce = (forceId: string): boolean => station === null || seesForce(station, forceId);
  // reachesPerson, not knowsPerson: someone who speaks for a whole power is
  // briefed on its figures whether or not he has dealt with them. Sight, not
  // acquaintance.
  const knowsThem = (characterId: string): boolean => station === null || reachesPerson(station, characterId);

  // Money the actor's side actually holds, biggest first: a slice that leads
  // with a pauper's purse tells the model nothing about whether an order is
  // affordable.
  const forcePolity = new Map(world.material.forces.map((force) => [force.id, force.polityId]));
  const accounts = [...world.material.accounts]
    .filter((account) => account.owner.kind === "polity"
      || (account.owner.kind === "force" && forcePolity.get(account.owner.id) === ownPolity)
      || world.characters.some((c) => c.id === account.owner.id && c.polityId === ownPolity))
    // A merchant does not read the treasury, and does not read his neighbour's
    // purse either. Ownership and office reach are the whole of the answer.
    .filter((account) => reachesAccount(account.id))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, CAPS.accounts)
    .map((account) => ({
      id: account.id,
      label: account.owner.kind === "polity"
        ? `${polityName(account.owner.id)} treasury`
        : account.owner.kind === "force"
          // Named for what it is, so an order about an army's own money has
          // an account to point at rather than a purse to borrow.
          ? `war chest of ${world.material.forces.find((force) => force.id === account.owner.id)?.name ?? account.owner.id}`
          : `${name(account.owner.id)}'s purse`,
      balance: account.balance,
    }));

  const perDay = (amount: number, cadenceDays: number) => (cadenceDays <= 0 ? 0 : amount / cadenceDays);
  // Reckoned over the books they can actually open.
  const monthlyIncome = Math.round(
    world.material.incomeSources
      .filter((source) => source.active && reachesAccount(source.beneficiaryAccountId))
      .reduce((sum, source) => sum + perDay(source.amount, source.cadenceSteps) * 30, 0),
  );
  // Only for whoever can open the power's own chest: how hard its lands are
  // taxed is the treasury's business, and a private man hears it as grumbling.
  const opensTreasury = ownPolity !== null && world.material.accounts.some((account) =>
    account.owner.kind === "polity" && account.owner.id === ownPolity && reachesAccount(account.id));
  const burden = opensTreasury ? taxBurdens(world).get(ownPolity) : undefined;
  const taxBurden = burden === undefined ? null : { asked: burden.asked, bearable: burden.bearable, inWords: taxBurdenInWords(burden) };
  const monthlyExpenditure = Math.round(
    world.material.obligations
      .filter((obligation) => obligation.active && reachesAccount(obligation.payerAccountId))
      .reduce((sum, obligation) => sum + perDay(obligation.amount, obligation.cadenceSteps) * 30, 0),
  );

  const military = world.material.forces
    .filter((force) => ownPolity === null || force.polityId === ownPolity)
    .slice(0, CAPS.forces)
    .map((force) => ({
      id: force.id,
      // A band that answers to nobody is still where its men came from, and has to be told apart.
      name: force.outlaw === true ? `${force.name} (outlaw)` : force.name,
      // The men actually there, not the establishment. The two diverge the
      // moment a battle is fought, and an order planned on the paper figure is
      // an order planned on men who are dead.
      // A merchant knows roughly where the legions are and how big they look.
      // What they are worth in the field is the business of whoever answers for
      // them: morale, supply and the paper establishment are a commander's
      // readings, not a bystander's.
      strength: reachesForce(force.id)
        ? force.personnel.reduce((sum, category) => sum + category.fit, 0)
        : bandStrength(force.personnel.reduce((sum, category) => sum + category.fit, 0)),
      banded: !reachesForce(force.id),
      paperStrength: reachesForce(force.id) ? force.authorizedStrength : null,
      morale: reachesForce(force.id) ? Math.round(force.moraleBps / 100) : null,
      provisions: reachesForce(force.id) ? force.provisionStatus : null,
      location: provinceName(force.locationId),
      locationId: force.locationId,
      commander: name(force.commanderCharacterId),
      ranks: force.memberCharacterIds.map((id) => `${name(id)} [${id}]`),
      plan: reachesForce(force.id) && force.battlePlan != null ? force.battlePlan.rationale.slice(0, 160) : null,
    }));

  // Every place the order might need to name, by the id it must name it by --
  // not only the places already ours. An order to invade names somewhere we do
  // not hold, and a model with no id for it will invent one.
  //
  // Which places those are has to be chosen, not taken off the top of the list.
  // The world holds hundreds of provinces and the cap admits a few dozen, so an
  // arbitrary slice would hand the model our own ground plus whatever sorted
  // first -- and leave it inventing ids for the province it was actually asked
  // about. Three tiers earn a place: where we are, where we could go or what
  // the moment is about, and then the rest in a stable order.
  const ourProvinceIds = new Set([
    ...world.map.provinces.filter((province) => province.controllerPolityId === ownPolity).map((province) => province.id),
    ...world.material.forces.filter((force) => force.polityId === ownPolity).map((force) => force.locationId),
  ]);

  const bordering = new Set<string>();
  for (const edge of world.map.edges) {
    if (ourProvinceIds.has(edge.from) && !ourProvinceIds.has(edge.to)) bordering.add(edge.to);
    if (ourProvinceIds.has(edge.to) && !ourProvinceIds.has(edge.from)) bordering.add(edge.from);
  }

  // Anywhere the world is currently doing something, and anywhere the order
  // names outright. The order is matched by id rather than by name because an
  // id is what the model has to give back.
  const inPlay = new Set<string>([
    ...openStorylines(world.storylines).flatMap((storyline) => (storyline.provinceId === null ? [] : [storyline.provinceId])),
    ...world.characters.filter((character) => character.alive && character.polityId === ownPolity).map((character) => character.locationProvinceId),
  ].filter((id): id is string => typeof id === "string"));
  // A battle records who is fighting, not where; the ground is wherever the
  // forces in it are standing. A siege records the settlement, and the province
  // is the one holding it.
  const forceLocation = new Map(world.material.forces.map((force) => [force.id, force.locationId]));
  for (const battle of world.conflicts.battles) {
    for (const forceId of battle.participantForceIds) {
      const provinceId = forceLocation.get(forceId);
      if (provinceId !== undefined) inPlay.add(provinceId);
    }
  }
  const settlementProvince = new Map(world.map.provinces.flatMap((province) => province.settlements.map((settlement) => [settlement.id, province.id] as const)));
  for (const siege of world.conflicts.sieges) {
    const provinceId = settlementProvince.get(siege.settlementId);
    if (provinceId !== undefined) inPlay.add(provinceId);
  }
  if (input.orderText !== null) {
    for (const province of world.map.provinces) {
      if (input.orderText.includes(province.id)) inPlay.add(province.id);
    }
  }

  const rank = (province: { id: string }): number => {
    if (ourProvinceIds.has(province.id) || inPlay.has(province.id)) return 0;
    return bordering.has(province.id) ? 1 : 2;
  };
  const provinces = [...world.map.provinces]
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
    .slice(0, CAPS.provinces)
    .map((province) => ({
      id: province.id,
      name: province.name,
      controller: province.controllerPolityId === null ? "uncontrolled" : polityName(province.controllerPolityId),
      cities: province.settlements.slice(0, CAPS.citiesPerProvince).map((settlement) => ({
        id: settlement.id,
        name: settlement.name,
        controller: settlement.controllerPolityId === null ? "uncontrolled" : polityName(settlement.controllerPolityId),
        walls: settlement.fortificationLevel,
      })),
      // Only ground somebody authored or made. Every province has a generated
      // fallback list -- a camp, an interior -- and printing those for forty
      // provinces would cost more than it tells anybody.
      ground: (province.positions ?? []).slice(0, CAPS.groundPerProvince).map((position) => ({
        id: position.id,
        label: position.label,
        type: position.type,
      })),
      buildings: world.structures
        .filter((structure) => structure.provinceId === province.id)
        .slice(0, CAPS.buildingsPerProvince)
        .map((structure) => {
          const does = (structure.effects ?? DEFAULT_STRUCTURE_EFFECTS[structure.kind] ?? []).map(effectInWords);
          return `${structure.name} [${structure.id}] (${structure.kind.replace(/_/g, " ")}${structure.lapsedAtStep == null ? "" : ", fallen into disuse"}${does.length === 0 ? "" : `; ${does.join(", ")}`})`;
        }),
      belief: world.faithAdherence
        .filter((row) => row.provinceId === province.id)
        .sort((a, b) => b.shareBps - a.shareBps)
        .slice(0, 3)
        .map((row) => `${world.faiths.find((faith) => faith.id === row.faithId)?.name ?? row.faithId} ${Math.round(row.shareBps / 100)}%`),
    }));

  const standingPlans = world.contingencies
    .filter((plan) => plan.status === "armed" && (ownPolity === null || plan.ownerPolityId === ownPolity))
    .slice(0, CAPS.standingPlans)
    .map((plan) => ({
      id: plan.id,
      label: plan.label,
      effect: plan.effect,
      where: provinceName(plan.provinceId),
    }));

  // The kinds of soldier there are: the scenario's own, plus any the world has
  // since made for itself. Named so an order can ask for one by id instead of
  // guessing, and so the world can tell a legion from a squadron of horse.
  const troopKinds = allTroopCategories(world, input.warfare?.troopCategories ?? [])
    .map((category) => ({ id: category.id, label: category.label }));

  const politics = world.characters
    .filter((character) => character.alive && (ownPolity === null || character.polityId === ownPolity))
    .slice(0, CAPS.characters)
    .map((character) => ({
      id: character.id,
      name: character.name,
      office: character.officeId,
      age: currentAgeYears(character, world.elapsedStep),
      faith: character.faithId === null ? null : world.faiths.find((faith) => faith.id === character.faithId)?.name ?? null,
      standing: [
        character.gender === "female" ? "a woman" : null,
        character.legalStatus === "enslaved" ? `slave of ${world.characters.find((owner) => owner.id === character.ownerCharacterId)?.name ?? "a master"}` : null,
        character.legalStatus === "freed" ? `freedman of ${world.characters.find((owner) => owner.id === character.ownerCharacterId)?.name ?? "a patron"}` : null,
      ].filter((part): part is string => part !== null).join(", ") || null,
    }));

  const diplomacy = (speaksForTheGovernment ? world.polityStances : [])
    .filter((stance) => ownPolity === null || stance.polityId === ownPolity)
    .slice(0, CAPS.stances)
    .map((stance) => ({ toward: polityName(stance.towardPolityId), trust: stance.trustScore, why: stance.lastShiftReason }));

  // What this world's powers have standing between them. §27 asks the slice to
  // carry active wars; before agreements existed the answer to "are we at war?"
  // was a trust score and a guess.
  const agreements = world.polityAgreements
    .filter((agreement) => agreement.status === "active")
    .filter((agreement) => agreement.visibility === "public" || ownPolity === null || agreement.polityId === ownPolity || agreement.otherPolityId === ownPolity)
    .slice(-CAPS.agreements)
    .map((agreement) => ({
      id: agreement.id,
      kind: agreement.kind,
      ours: agreement.polityId === ownPolity || agreement.otherPolityId === ownPolity,
      between: `${polityName(agreement.polityId)} and ${polityName(agreement.otherPolityId)}`,
      terms: agreement.terms,
      endsInDays: agreement.untilStep === null ? null : agreement.untilStep - world.elapsedStep,
    }));

  // Letters this government is party to and has not finished with: what it is
  // waiting on, and what is waiting on it. A letter nobody is shown is a letter
  // nobody answers, which is how the last one sat in the world unread.
  const letters = world.diplomacy
    .filter((message) => message.status === "awaiting_reply")
    .filter((message) => ownPolity === null || message.fromPolityId === ownPolity || message.toPolityId === ownPolity)
    // A power's correspondence belongs to whoever answers for the power. A
    // private man reads the letters he sent and the letters sent to him.
    .filter((message) =>
      speaksForTheGovernment
      || station === null
      || message.fromCharacterId === station.characterId
      || message.toCharacterId === station.characterId)
    .slice(-CAPS.letters)
    .map((message) => ({
      id: message.id,
      kind: message.kind,
      ours: message.fromPolityId === ownPolity,
      from: polityName(message.fromPolityId),
      to: polityName(message.toPolityId),
      subject: message.subject,
      terms: message.terms,
      dueInDays: message.replyDueByStep === null ? null : message.replyDueByStep - world.elapsedStep,
    }));

  // Basis points are the engine's unit and a hundredth of a point is not a
  // political fact; the model reads /100 the way VISION §6 writes it.
  const outOfHundred = (bps: number): number => Math.round(bps / 100);

  const ourInstitutions = world.material.institutions.filter((institution) => ownPolity === null || institution.polityId === ownPolity);
  const ourInstitutionIds = new Set(ourInstitutions.map((institution) => institution.id));

  const standing = [
    ...world.material.polityLegitimacy
      .filter((entry) => ownPolity === null || entry.polityId === ownPolity)
      .map((entry) => ({
        id: entry.polityId,
        kind: "polity" as const,
        name: polityName(entry.polityId),
        legitimacy: outOfHundred(entry.legitimacyBps),
        confidence: outOfHundred(entry.institutionalConfidenceBps),
        causes: [...entry.causes].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 2).map((cause) => cause.label),
      })),
    ...world.material.institutionLegitimacy
      .filter((entry) => ourInstitutionIds.has(entry.institutionId))
      .map((entry) => ({
        id: entry.institutionId,
        kind: "institution" as const,
        name: ourInstitutions.find((institution) => institution.id === entry.institutionId)?.name ?? entry.institutionId,
        legitimacy: outOfHundred(entry.legitimacyBps),
        confidence: null,
        causes: [...entry.causes].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 2).map((cause) => cause.label),
      })),
  ];

  // Manpower is per-province and there is no polity total, so the total the
  // model needs to answer "can we raise another legion" has to be summed here.
  const ourMaterial = world.material.provinceMaterial.filter((material) => ourProvinceIds.has(material.provinceId));
  const country = {
    provinces: ourMaterial.length,
    population: ourMaterial.reduce((sum, material) => sum + material.population, 0),
    availableManpower: ourMaterial.reduce((sum, material) => sum + material.availableManpower, 0),
    // The worst-off first: a province at its baseline needs no line of prompt.
    strained: [...ourMaterial]
      .sort((a, b) => (a.foodSecurityBps + a.stabilityBps - a.warDamageBps) - (b.foodSecurityBps + b.stabilityBps - b.warDamageBps))
      .slice(0, CAPS.strainedProvinces)
      .map((material) => ({
        id: material.provinceId,
        name: provinceName(material.provinceId),
        manpower: material.availableManpower,
        food: outOfHundred(material.foodSecurityBps),
        stability: outOfHundred(material.stabilityBps),
        warDamage: outOfHundred(material.warDamageBps),
        taxCapacity: material.taxCapacity,
      })),
  };

  const institutions = ourInstitutions.slice(0, CAPS.institutions).map((institution) => ({
    id: institution.id,
    name: institution.name,
    threshold: outOfHundred(institution.passageThresholdBps),
    // An institution is a room; the blocs are the people in it. Printing the
    // room alone left the model naming the Senate itself as a supporter, which
    // is not a thing that can hold an opinion.
    blocs: station !== null && !station.institutionIds.has(institution.id)
      ? []
      : institution.votingBlocs.slice(0, 6).map((bloc) => ({ id: bloc.id, name: bloc.name, weight: bloc.weight, interest: bloc.representedInterest })),
  }));

  const factions = world.material.politicalGroups
    .filter((group) => ownPolity === null || group.polityId === ownPolity)
    .slice(0, CAPS.institutions)
    .map((group) => ({
      id: group.id,
      name: group.name,
      kind: group.type,
      members: world.material.groupMemberships.filter((membership) => membership.groupId === group.id && membership.leftAtStep === null).length,
    }));

  /**
   * Support positions are append-only: someone who changes their mind leaves
   * both rows behind. Summing them would count a senator twice and let a
   * waverer outweigh the whole chamber, so only their latest row counts.
   */
  const latestPositions = (procedureId: string) => {
    const latest = new Map<string, (typeof world.material.supportPositions)[number]>();
    for (const position of world.material.supportPositions) {
      if (position.procedureId !== procedureId) continue;
      const key = `${position.supporterKind}:${position.supporterId}`;
      const held = latest.get(key);
      if (held === undefined || position.changedAtStep >= held.changedAtStep) latest.set(key, position);
    }
    return [...latest.values()];
  };

  const council = world.material.politicalProcedures
    .filter((procedure) => procedure.stage !== "resolved" && procedure.stage !== "withdrawn" && procedure.stage !== "blocked")
    .filter((procedure) => procedure.institutionId === null || ourInstitutionIds.has(procedure.institutionId))
    .slice(0, CAPS.procedures)
    .map((procedure) => {
      const positions = latestPositions(procedure.id);
      // The question is public business; how the room is leaning is not. This
      // is exactly "does not know what the Senate said in private session".
      const party = station === null
        || station.procedureIds.has(procedure.id)
        || (procedure.institutionId !== null && station.institutionIds.has(procedure.institutionId));
      return {
        id: procedure.id,
        label: procedure.label,
        type: procedure.type,
        institution: procedure.institutionId === null ? null : ourInstitutions.find((institution) => institution.id === procedure.institutionId)?.name ?? procedure.institutionId,
        sponsor: name(procedure.sponsorCharacterId),
        mechanism: procedure.resolutionMechanism,
        stage: procedure.stage,
        dueInDays: procedure.deadlineStep === null ? null : procedure.deadlineStep - world.elapsedStep,
        supportWeight: party ? positions.filter((position) => position.position === "support").reduce((sum, position) => sum + position.influenceWeight, 0) : null,
        opposeWeight: party ? positions.filter((position) => position.position === "oppose").reduce((sum, position) => sum + position.influenceWeight, 0) : null,
      };
    });

  const ourCharacterIds = new Set(world.characters.filter((character) => ownPolity === null || character.polityId === ownPolity).map((character) => character.id));
  const holdings = world.material.holdings
    .filter((holding) => ourCharacterIds.has(holding.legalHolderCharacterId) || ourProvinceIds.has(holding.territoryId))
    .slice(0, CAPS.holdings)
    .map((holding) => ({
      id: holding.id,
      title: holding.title,
      holder: name(holding.legalHolderCharacterId),
      holderId: holding.legalHolderCharacterId,
      control: outOfHundred(holding.physicalControlBps),
      territoryId: holding.territoryId,
      // What it pays its owner a month -- the owner's own business, so shown
      // only to whoever can open the purse it is paid into.
      monthlyYield: (() => {
        const income = world.material.incomeSources.find((source) => source.id === holding.incomeSourceId);
        return income === undefined || !reachesAccount(income.beneficiaryAccountId) ? null : Math.round(income.amount * (30 / Math.max(1, income.cadenceSteps)));
      })(),
    }));

  const ourAccountIds = new Set(
    world.material.accounts
      .filter((account) => {
        if (account.owner.kind === "polity") return ownPolity === null || account.owner.id === ownPolity;
        if (account.owner.kind === "force") return forcePolity.get(account.owner.id) === ownPolity;
        return ourCharacterIds.has(account.owner.id);
      })
      .map((account) => account.id),
  );

  const debts = world.material.loans
    .filter((loan) => loan.status !== "repaid" && ourAccountIds.has(loan.borrowerAccountId))
    .slice(0, CAPS.debts)
    .map((loan) => {
      const servicing = loan.serviceObligationId === null
        ? undefined
        : world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId);
      return {
        id: loan.id,
        outstanding: loan.outstanding,
        interest: Math.round(loan.interestBps / 100),
        perPeriod: servicing?.amount ?? 0,
        lender: loan.lenderKind === "foreign" || loan.lenderId === null ? "foreign creditors" : `${name(loan.lenderId)} [${loan.lenderId}]`,
        terms: loan.terms,
        status: loan.status,
        arrears: servicing?.arrears ?? 0,
      };
    });

  // Only revenue with somebody on the other end of it: a farm cannot be
  // blockaded, and listing it here would tell the model nothing it can act on.
  const trade = world.material.incomeSources
    // Our own polity named as the counterparty means domestic revenue that was
    // mislabelled; it depends on nobody abroad and cannot be cut by a war.
    .filter((source) => source.counterpartyPolityId !== null && source.counterpartyPolityId !== ownPolity && ourAccountIds.has(source.beneficiaryAccountId))
    .slice(0, CAPS.trade)
    .map((source) => ({
      id: source.id,
      label: source.label,
      amount: source.amount,
      counterparty: polityName(source.counterpartyPolityId ?? ""),
      active: source.active,
    }));

  const arrangements = world.genericEntities
    .filter((entity) => {
      if (entity.ownerRef === null) return true;
      if (entity.ownerRef.kind === "polity") return ownPolity === null || entity.ownerRef.id === ownPolity;
      return ourCharacterIds.has(entity.ownerRef.id);
    })
    // A repealed law is still worth a line -- shorter -- because its effects
    // and its enemies outlive it.
    .sort((a, b) => Number("retiredAtStep" in a.attributes) - Number("retiredAtStep" in b.attributes))
    .slice(0, CAPS.arrangements)
    .map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      label: entity.label,
      owner: entity.ownerRef === null ? null : entity.ownerRef.kind === "character" ? name(entity.ownerRef.id) : polityName(entity.ownerRef.id),
      attributes: Object.entries(entity.attributes)
        .filter(([key]) => key !== "retiredAtStep")
        .slice(0, 6)
        .map(([key, value]) => `${key}: ${String(value)}`),
      retired: "retiredAtStep" in entity.attributes,
      effects: [
        ...(entity.effects ?? []).map(effectInWords),
        ...(entity.upkeep == null ? [] : [`kept at ${entity.upkeep.band} cost from [${entity.upkeep.fromAccountId}]`]),
      ],
      lapsed: entity.lapsedAtStep != null,
      rule: entity.mechanic === undefined || entity.mechanic.endedAtStep !== null || entity.ownerRef?.kind !== input.actorRef.kind || entity.ownerRef.id !== input.actorRef.id
        ? null
        : ruleInWords(entity.mechanic, world, entity.id),
    }));

  // Ours first: the order the model reads them in is the order it weighs them.
  const outlooks = [...world.polityOutlooks]
    .sort((a, b) => Number(b.polityId === ownPolity) - Number(a.polityId === ownPolity))
    .slice(0, CAPS.outlooks)
    .map((outlook) => ({
      polityId: outlook.polityId,
      name: polityName(outlook.polityId),
      own: outlook.polityId === ownPolity,
      objective: outlook.primaryObjective,
      riskTolerance: outlook.riskTolerance,
      concerns: outlook.concerns.map((concern) => `${concern.label}: ${concern.level}`),
      intentions: outlook.intentions,
    }));

  // Armies in the field and heads of state are not secrets.
  // Who else is on the board, nearest business first. The world holds over a
  // hundred powers and the cap admits a dozen, so the dozen are chosen the same
  // way the provinces were: the ones we share a border with, then the ones we
  // are already entangled with, then the large. Taking the first twelve in
  // array order would introduce the player to the Caledonians and never mention
  // Carthage.
  const provinceCountByPolity = new Map<string, number>();
  for (const province of world.map.provinces) {
    if (province.controllerPolityId === null) continue;
    provinceCountByPolity.set(province.controllerPolityId, (provinceCountByPolity.get(province.controllerPolityId) ?? 0) + 1);
  }
  const controllerOf = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
  const neighbouringPolities = new Set<string>();
  for (const id of bordering) {
    const controller = controllerOf.get(id);
    if (controller !== null && controller !== undefined && controller !== ownPolity) neighbouringPolities.add(controller);
  }
  const entangled = new Set<string>([
    ...world.conflicts.wars.flatMap((war) => [war.polityAId, war.polityBId]),
    ...world.polityStances.filter((stance) => stance.polityId === ownPolity).map((stance) => stance.towardPolityId),
    ...world.polityStances.filter((stance) => stance.towardPolityId === ownPolity).map((stance) => stance.polityId),
  ].filter((id) => id !== ownPolity));

  const foreignPowers = world.map.polities
    .filter((polity) => polity.id !== ownPolity)
    .map((polity) => ({
      id: polity.id,
      name: polity.name,
      provinces: provinceCountByPolity.get(polity.id) ?? 0,
      // Whether there is anybody who can answer for the whole of it. An
      // agreement struck with one Boii chieftain binds the chieftain.
      cohesion: cohesionInWords(polity.cohesionBps),
      leaders: world.characters
        .filter((character) => character.alive && character.polityId === polity.id)
        .slice(0, 4)
        .map((character) => `${character.name} [${character.id}]${character.officeId === null ? "" : `, ${character.officeId}`}`),
      forces: world.material.forces
        .filter((force) => force.polityId === polity.id)
        .slice(0, 4)
        .map((force) => `${force.name}${force.outlaw === true ? " (outlaw)" : ""} [${force.id}] — ${force.personnel.reduce((sum, category) => sum + category.fit, 0)} men at ${provinceName(force.locationId)} [${force.locationId}]`),
    }))
    .filter((power) => power.provinces > 0 || power.leaders.length > 0 || power.forces.length > 0)
    .sort((a, b) => {
      const weight = (power: { id: string }): number =>
        (neighbouringPolities.has(power.id) ? 0 : entangled.has(power.id) ? 1 : 2);
      return weight(a) - weight(b) || b.provinces - a.provinces || a.id.localeCompare(b.id);
    })
    .slice(0, CAPS.foreignFigures);

  const populationGaps = findPolityGaps({ world, ownPolityId: ownPolity, facts: input.facts, limit: 2 });

  const projects = world.projects
    .filter((project) => project.status !== "completed" && project.status !== "cancelled")
    .slice(0, CAPS.projects)
    .map((project) => ({
      id: project.id,
      label: project.label,
      status: project.status,
      nextMilestone: (() => {
        const pending = project.milestones.find((milestone) => milestone.status === "pending");
        return pending === undefined ? null : { id: pending.id, label: pending.label };
      })(),
    }));

  const intents = world.characterIntents
    .filter((intent) => intent.status === "proposed" || intent.status === "prepared")
    // What a man means to do is known to the people who deal with him. This
    // line showed every Roman's private plan to every other Roman.
    .filter((intent) => knowsThem(intent.actorCharacterId))
    .slice(0, CAPS.intents)
    .map((intent) => ({ actor: name(intent.actorCharacterId), action: intent.actionType, rationale: intent.rationale }));

  // Only what this actor could actually know -- narrowed from what their
  // government knows, which is a different and much larger thing.
  const recentHistory = (station === null
    ? factsKnownTo(input.facts, input.actorRef, ownPolity, world.instant)
    : factsKnownToStation(input.facts, station, world.instant))
    .slice(-CAPS.facts)
    .map((fact) => ({ id: fact.id, summary: fact.summary, significance: 0 }));

  // Ours first, then the most recently moved: the order the model reads them
  // in is the order it weighs them.
  const threads = openStorylines(world.storylines)
    .sort((a, b) => {
      const ours = (storyline: typeof a): number =>
        Number(storyline.participantIds.some((id) => world.characters.find((character) => character.id === id)?.polityId === ownPolity)
          || (storyline.provinceId !== null && world.map.provinces.find((province) => province.id === storyline.provinceId)?.controllerPolityId === ownPolity));
      return ours(b) - ours(a) || b.updatedAtStep - a.updatedAtStep || a.id.localeCompare(b.id);
    })
    .slice(0, CAPS.storylines)
    .map((storyline) => ({
      id: storyline.id,
      title: storyline.title,
      phase: storyline.phase,
      participants: storyline.participantIds.slice(0, 4).map((id) => `${name(id)} [${id}]`),
      province: storyline.provinceId === null ? null : `${provinceName(storyline.provinceId)} [${storyline.provinceId}]`,
      stakes: storyline.stakes,
      next: storyline.nextDevelopment,
      factIds: storyline.causalFactIds.slice(-3),
      secret: storyline.visibility === "private",
    }));

  const openOrders = world.orderAttempts
    .filter((attempt) => attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed" || attempt.status === "accepted")
    .slice(0, CAPS.events)
    .map((attempt) => ({ id: attempt.id, recipient: name(attempt.recipientRef.id), status: attempt.status }));

  return {
    date: formatWorldDate(world.instant, input.clock),
    order: input.orderText,
    answeredDecision: input.answeredDecision ?? null,
    actor: {
      id: input.actorRef.id,
      name: actor?.name ?? input.actorRef.id,
      office: actor?.officeId ?? null,
      officeLabel: allOffices(world, input.offices).find((office) => office.id === actor?.officeId)?.label ?? null,
      polityId: ownPolity,
      polityName: ownPolity === null ? null : polityName(ownPolity),
      // The world knew a minor Carthaginian admiral's temperament, drives and
      // fears, and knew of the person whose order it was answering only a name
      // and an opaque office id.
      portrait: actor === undefined
        ? ""
        : renderCharacterPortrait(input.actorRef.id, actor.name, world, input.clock, { others: [] }),
      permitted: actor === undefined ? [] : describeAuthority(buildStation({ world, characterId: input.actorRef.id, offices: input.offices }), world),
    },
    economy: accounts,
    monthlyIncome,
    monthlyExpenditure,
    taxBurden,
    military,
    foreignPowers,
    populationGaps,
    provinces,
    standingPlans,
    troopKinds,
    faiths: world.faiths.slice(0, CAPS.faiths).map((faith) => faith.name),
    politics,
    diplomacy,
    agreements,
    letters,
    standing,
    country,
    institutions,
    council,
    factions,
    holdings,
    debts,
    trade,
    arrangements,
    outlooks,
    projects,
    intents,
    recentHistory,
    dueEvents: input.dueEvents.slice(0, CAPS.events),
    pendingEvents: input.pendingEvents.slice(0, CAPS.events),
    openOrders,
    threads,
    seeds: input.narratorSeeds ?? (input.narratorSeed == null ? [] : [input.narratorSeed]),
  };
}

/** The slice as the compact text a prompt carries. */
export function renderWorldSlice(slice: WorldSlice): string {
  const lines: string[] = [];
  const section = (title: string, body: readonly string[]) => {
    if (body.length === 0) return;
    lines.push(title, ...body.map((line) => `  ${line}`), "");
  };

  lines.push(`CURRENT DATE: ${slice.date}`, "");
  lines.push(
    `ACTING FOR: ${slice.actor.name} [${slice.actor.id}]${slice.actor.officeLabel === null ? "" : `, ${slice.actor.officeLabel}`}, of ${slice.actor.polityName ?? slice.actor.polityId ?? "no polity"}`,
    "",
  );
  if (slice.actor.portrait.length > 0) lines.push(slice.actor.portrait, "");
  lines.push(
    "WHAT THIS PERSON MAY DO:",
    ...(slice.actor.permitted.length === 0
      ? ["  Nothing but dispose of what is their own."]
      : slice.actor.permitted.map((line) => `  - ${line}`)),
    // Printed for everyone, a consul included: made conditional on low station,
    // its presence would itself tell the model which ones are weak.
    "  Nothing beyond this is theirs to command. Somebody they instruct outside it is",
    "  being asked a favour, not given an order, and may refuse -- say so honestly if",
    "  they do.",
    "",
  );
  // An answer is not a fresh order, and saying so matters: the world is
  // resuming something it had already begun and put to the ruler.
  if (slice.answeredDecision !== null) {
    lines.push(
      "A QUESTION WAS PUT TO THE RULER:",
      `  ${slice.answeredDecision.prompt}`,
      "THE RULER'S ANSWER:",
      `  ${slice.answeredDecision.label} — ${slice.answeredDecision.summary}`,
      "",
      "Carry out that answer. Do not ask it again.",
      "",
    );
  }
  if (slice.order !== null) lines.push("PLAYER ORDER:", `  ${slice.order}`, "");

  section("TREASURY", [
    ...slice.economy.map((account) => `${account.label} [${account.id}]: ${account.balance}`),
    `Monthly income ~${slice.monthlyIncome}, monthly expenditure ~${slice.monthlyExpenditure}`,
    ...(slice.taxBurden === null ? [] : [
      `Our lands' taxes: ~${slice.taxBurden.asked}/month asked of ~${slice.taxBurden.bearable} bearable (${slice.taxBurden.inWords}); more is not collected, and past half, order sours.`,
    ]),
  ]);
  section("MILITARY", slice.military.map((force) => {
    const where = `at ${force.location} [${force.locationId}], under ${force.commander}${force.ranks.length === 0 ? "" : `, with ${force.ranks.join(", ")} in the ranks`}`;
    if (force.banded) return `${force.name} [${force.id}] — about ${force.strength} men ${where}`;
    const short = force.paperStrength !== null && force.strength < force.paperStrength ? ` of ${force.paperStrength} on the books` : "";
    const fed = force.provisions === null || force.provisions === "provisioned" ? "" : `, ${force.provisions} of supply`;
    return `${force.name} [${force.id}] — ${force.strength} men${short} ${where}, morale ${force.morale}/100${fed}${force.plan === null ? "" : `; if attacked: ${force.plan}`}`;
  }));
  section("PLANS STANDING", slice.standingPlans.map((plan) =>
    `${plan.label} [${plan.id}] — ${plan.effect === "spring_trap" ? "prepared, and springs by itself" : "waiting to raise the alarm"}, in ${plan.where}`));
  section("KINDS OF SOLDIER", slice.troopKinds.length === 0 ? [] : [
    `${slice.troopKinds.map((kind) => `${kind.label} [${kind.id}]`).join("; ")}. A kind not listed here can be taken into an army anyway -- name it and say what sort of troops they are.`,
  ]);
  section("PLACES", slice.provinces.map((province) => {
    const cities = province.cities.length === 0
      ? ""
      : `. Cities: ${province.cities.map((city) => `${city.name} [${city.id}], ${city.controller}, walls ${city.walls}/10`).join("; ")}`;
    const ground = province.ground.length === 0
      ? ""
      : `. Ground: ${province.ground.map((spot) => `${spot.label} [${spot.id}], ${spot.type}`).join("; ")}`;
    const buildings = province.buildings.length === 0 ? "" : `. Standing there: ${province.buildings.join("; ")}`;
    const belief = province.belief.length === 0 ? "" : `. Believe: ${province.belief.join(", ")}, the rest as of old`;
    return `${province.name} [${province.id}] — held by ${province.controller}${cities}${ground}${buildings}${belief}`;
  }));
  section("FAITHS", slice.faiths.length === 0 ? [] : [`${slice.faiths.join("; ")}. A faith not listed is founded by naming it.`]);
  section("OTHER POWERS", slice.foreignPowers.map((power) => {
    const people = power.leaders.length === 0 ? "nobody known to lead them" : power.leaders.join("; ");
    const arms = power.forces.length === 0 ? "no forces known in the field" : power.forces.join("; ");
    return `${power.name} [${power.id}] — ${power.provinces} province(s), ${power.cohesion}. ${people}. ${arms}`;
  }));
  // ── The world's own half ───────────────────────────────────────────────
  //
  // Three of the sections below exist for the orchestrator *as the world*, not
  // for the person whose order it is answering: a foreign power's private aims,
  // the threads the world is following (secret ones included), and the
  // directives telling it to people a country or start something. Their own
  // comments say so. Filtering them would not make the reader less omniscient;
  // it would make the world incoherent, and send the model back to inventing
  // placeholder ids for what it could no longer see.
  //
  // So they are labelled instead. The reader has not been told any of this, and
  // the model is told that plainly.
  lines.push(
    "── THE WORLD ITSELF ──",
    `  Yours to move, and not ${slice.actor.name}'s to know. They have been told none of what`,
    "  follows. Do not answer their order as though they had, and do not let them act on it.",
    "",
  );
  section(
    "STANDING AIMS",
    slice.outlooks.flatMap((outlook) => [
      `${outlook.name} [${outlook.polityId}]${outlook.own ? " (ours)" : ""} — ${outlook.objective}. Will risk ${outlook.riskTolerance}/100.`,
      ...outlook.concerns.map((concern) => `  worried about ${concern}`),
      ...outlook.intentions.map((intention) => `  means to ${intention}`),
    ]),
  );
  section("OPEN THREADS", slice.threads.map((thread) => {
    const where = thread.province === null ? "" : `, in ${thread.province}`;
    const facts = thread.factIds.length === 0 ? "" : ` Facts: ${thread.factIds.map((id) => `[${id}]`).join(" ")}.`;
    const secret = thread.secret ? " (secret — known to its participants alone)" : "";
    return `${thread.title} [${thread.id}] — ${thread.phase}. With: ${thread.participants.join("; ")}${where}. At stake: ${thread.stakes} Next: ${thread.next}${facts}${secret}`;
  }));
  if (slice.populationGaps.length > 0) {
    lines.push(
      "COUNTRIES WITH NOBODY IN THEM:",
      ...slice.populationGaps.map((gap) => {
        const missing = [gap.needsLeader ? "a leader" : null, gap.needsForce ? "forces of their own" : null].filter((part) => part !== null).join(" and ");
        const land = gap.provinceIds.length === 0 ? "" : ` Their land: ${gap.provinceIds.map((id) => `[${id}]`).join(" ")}.`;
        return `  ${gap.name} [${gap.polityId}] holds land but has ${missing === "" ? "nobody" : `no ${missing}`} — ${gap.why}.${land}`;
      }),
      "  Give each of them the people and forces they plainly ought to have, now.",
      "",
    );
  }
  // A directive, like the one above, not data: the world is being told that
  // something happens, beside the order and not because of it. The model is
  // shown the scale and the target and never the reason it was chosen.
  if (slice.seeds.length > 0) {
    lines.push(
      `THE WORLD STIRS — ${slice.seeds.length === 1 ? "one thing happens" : `${slice.seeds.length} separate things happen`} this season, beside the order and not because of it:`,
      "  None of this is the player's doing, and none of it is attributed to anybody in the government. Answer PLAYER ORDER first and in full; then, in the same answer, make every one of these happen too, each under its own facts. They are unrelated to each other: do not join them into one event, and do not let one of them be the reason for another.",
      "  Spread them over the season. What happens at once, change now; what would take weeks, schedule with a scheduled event citing its own fact.",
      "",
    );
    for (const seed of slice.seeds) {
      lines.push(
        `  (seed ${seed.key}) ${seed.why}`,
        `  ${seed.brief}`,
        `  Scale: ${seed.severity}.${seed.oneShot ? " This one runs its course; it needs no thread." : ` Open its thread with "storyline_open" carrying seedKey "${seed.key}".`}`,
        ...(seed.repeated ? ["  This was asked before and did not happen. It happens now."] : []),
        ...(seed.secret
          ? [`  It is a secret. Every fact of it is "private" with "knownToRefs" naming only those in it; its thread is "private"; nothing of it appears in narrativeSummary, frictions or a playerDecision.`]
          : ["  It is news: record it as a fact with the visibility the world would actually give it, and score it honestly."]),
        "",
      );
    }
  }
  section("PEOPLE", slice.politics.map((person) => `${person.name} [${person.id}]${person.office === null ? "" : `, ${person.office}`}, aged ${person.age}${person.faith === null ? "" : `, of ${person.faith}`}${person.standing === null ? "" : `, ${person.standing}`}`));
  section(
    "POLITICAL STANDING",
    slice.standing.map((entry) => {
      const confidence = entry.confidence === null ? "" : `, confidence in its institutions ${entry.confidence}/100`;
      const why = entry.causes.length === 0 ? "" : ` — ${entry.causes.join("; ")}`;
      return `${entry.name} [${entry.id}]: legitimacy ${entry.legitimacy}/100${confidence}${why}`;
    }),
  );
  section(
    "INSTITUTIONS",
    slice.institutions.flatMap((institution) => [
      `${institution.name} [${institution.id}] — ${institution.threshold}/100 of the weight needed to carry a question`,
      ...institution.blocs.map((bloc) => `  ${bloc.name} [${bloc.id}] — weight ${bloc.weight}, speaks for ${bloc.interest}`),
    ]),
  );
  section("FACTIONS", slice.factions.map((faction) =>
    `${faction.name} [${faction.id}] — ${faction.kind}, ${faction.members} member(s)`));
  section(
    "BEFORE THE COUNCIL",
    slice.council.map((question) => {
      const where = question.institution === null ? "decided by its sponsor" : `before the ${question.institution}`;
      const when = question.dueInDays === null ? "" : `, due in ${question.dueInDays} days`;
      const tally = question.supportWeight === null || question.opposeWeight === null
        ? ""
        : ` For ${question.supportWeight}, against ${question.opposeWeight}.`;
      return `${question.label} [${question.id}] — ${question.type}, ${where}, raised by ${question.sponsor}${when}.${tally}`;
    }),
  );
  section(
    "THE COUNTRY",
    slice.country.provinces === 0
      ? []
      : [
        `${slice.country.provinces} province(s), ${slice.country.population} people, ${slice.country.availableManpower} men available to raise.`,
        ...slice.country.strained.map((province) =>
          `${province.name} [${province.id}] — ${province.manpower} men, food ${province.food}/100, order ${province.stability}/100, war damage ${province.warDamage}/100, taxable ${province.taxCapacity}`),
      ],
  );
  section(
    "DEBTS",
    slice.debts.map((debt) => {
      const behind = debt.arrears === 0 ? "" : `, ${debt.arrears} in arrears`;
      return `${debt.outstanding} owed to ${debt.lender} [${debt.id}] at ${debt.interest}% — ${debt.perPeriod} a period${behind}, ${debt.status}. ${debt.terms}`;
    }),
  );
  section("TRADE", slice.trade.map((route) =>
    `${route.label} [${route.id}] — ${route.amount} a period from ${route.counterparty}${route.active ? "" : ", cut off"}`));
  section(
    "STANDING ARRANGEMENTS",
    slice.arrangements.map((entity) => {
      const owner = entity.owner === null ? "" : `, under ${entity.owner}`;
      const detail = entity.attributes.length === 0 ? "" : ` — ${entity.attributes.join(", ")}`;
      const does = entity.effects.length === 0 ? "" : `; ${entity.effects.join(", ")}`;
      const rule = entity.rule === null ? "" : `; rule: ${entity.rule}`;
      return `${entity.label} [${entity.id}] (${entity.kind}${owner})${entity.retired ? ", repealed" : ""}${entity.lapsed ? ", fallen into disuse" : ""}${detail}${does}${rule}`;
    }),
  );
  section("LANDS AND HOLDINGS", slice.holdings.map((holding) =>
    `${holding.title} [${holding.id}] in ${holding.territoryId} — held in law by ${holding.holder} [${holding.holderId}], held in fact ${holding.control}/100${holding.monthlyYield === null ? "" : `, yielding ~${holding.monthlyYield} a month`}`));
  section("DIPLOMACY", slice.diplomacy.map((stance) => `toward ${stance.toward}: trust ${stance.trust} (${stance.why})`));
  section("WHERE THE POWERS STAND", slice.agreements.map((agreement) => {
    const term = agreement.endsInDays === null ? "" : `, for another ${agreement.endsInDays} day(s)`;
    return `[${agreement.id}] ${agreement.kind}${agreement.ours ? " (ours)" : ""}: ${agreement.between} — ${agreement.terms}${term}`;
  }));
  section("LETTERS AWAITING AN ANSWER", slice.letters.map((letter) => {
    const due = letter.dueInDays === null ? "no term set" : letter.dueInDays < 0 ? `overdue by ${-letter.dueInDays} day(s)` : `answer wanted within ${letter.dueInDays} day(s)`;
    return `[${letter.id}] ${letter.kind} ${letter.ours ? `we sent to ${letter.to}` : `${letter.from} sent us`} — ${letter.subject}: ${letter.terms} (${due})`;
  }));
  section("ACTIVE PROJECTS", slice.projects.map((project) =>
    `${project.label} [${project.id}] — ${project.status}${project.nextMilestone === null ? "" : `, next: ${project.nextMilestone.label} [${project.nextMilestone.id}]`}`));
  section("STANDING INTENTIONS", slice.intents.map((intent) => `${intent.actor} means to ${intent.action}: ${intent.rationale}`));
  section("ORDERS AWAITING AN ANSWER", slice.openOrders.map((order) => `${order.id} to ${order.recipient} — ${order.status}`));
  section("RECENT HISTORY (only what is known to this government)", slice.recentHistory.map((entry) => `${entry.summary} [${entry.id}]`));
  const threadOf = (event: SliceEvent): string => (event.thread === undefined ? "" : ` (thread: ${event.thread})`);
  section("DUE NOW", slice.dueEvents.map((event) => `${event.kind}: ${event.summary}${threadOf(event)}`));
  section("SCHEDULED AHEAD", slice.pendingEvents.map((event) => `in ${event.dueInDays} days — ${event.kind}: ${event.summary}${threadOf(event)}`));

  return lines.join("\n").trim();
}
