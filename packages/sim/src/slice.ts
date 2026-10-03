import { powersDealtWith } from "./far-powers";
import { armyInWords, serviceInWords } from "./army-words";
import { findPolityGaps } from "./population";
import { distancesFrom, placeIndex, provinceIdsIn, provincesNamedIn } from "./place-index";
import type { NarratorSeed } from "./narrator";
import { renderCharacterPortrait } from "./cognition";
import { isOpenIntent, mostPressingFirst } from "./intents";
import { ruleInWords } from "./mechanics/mechanic-words";
import { forecastInWords, isChamberQuestion, voteDayOf } from "./senate";
import { commandTenureOf, rulerOf, rulerOfficeOf, sovereignChamberOf } from "./constitutions";
import { loanOfferLines } from "./money";

import {
  ORDER_PART_STATUS_LABEL,
  isOrderPartOpen,
  orderPartStatus,
  ALL_CHAMBER_POWERS,
  COMMAND_TENURE_IN_WORDS,
  GOVERNMENT_FORM_IN_WORDS,
  INTEREST_IN_WORDS,
  type SuccessionRule,
  allOffices,
  alliesLedBy,
  allTroopCategories,
  bandStrength,
  strangerStrength,
  buildStation,
  currentAgeYears,
  describeAuthority,
  factsKnownToStation,
  holdsPolityStanding,
  isDelivered,
  agreementIsOpen,
  knowsAgreement,
  treatyViewer,
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
  obligationAmountNow,
  polityGrainPriceBps,
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

const CAPS = { characters: 12, forces: 10, projects: 8, accounts: 6, stances: 8, facts: 12, events: 8, intents: 8, provinces: 40, citiesPerProvince: 4, groundPerProvince: 4, standingPlans: 6, foreignForces: 12, foreignFigures: 12, outlooks: 8, institutions: 4, procedures: 6, strainedProvinces: 8, holdings: 6, arrangements: 8, buildingsPerProvince: 3, faiths: 8, debts: 6, trade: 6, storylines: 6, letters: 6, agreements: 8, groups: 8 } as const;

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
  /** Which option it was: a succession names the new character, a plight in the field names the choice. */
  readonly optionId?: string | undefined;
  /** Who was asking when the question was put, where the answer changes who asks next. */
  readonly predecessorId?: string | undefined;
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
  /** The scenario's succession rules, so a constitution's head of state can be read. */
  readonly successionRules?: readonly SuccessionRule[] | undefined;
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
    /** Surrounded, cut off or a prisoner: the one fact that bounds everything else they do. */
    readonly plight: string | null;
    /** His place in an army's ranks, where he serves in one (`army-words.ts`). */
    readonly service: string | null;
  };
  readonly economy: readonly { readonly id: string; readonly label: string; readonly balance: number }[];
  readonly monthlyIncome: number;
  readonly monthlyExpenditure: number;
  /** Loans standing on offer to the actor while his purse is low (`money.ts`), each with the id an order takes it by. */
  readonly loanOffers: readonly string[];
  /** How hard the power's own lands are being taxed, for whoever can open its treasury. */
  readonly taxBurden: { readonly asked: number; readonly bearable: number; readonly inWords: string } | null;
  /** Coin a month per thousand men, for whoever can open the power's treasury and the scenario names it. */
  readonly soldierPayPerThousand: number | null;
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
    /** Under orders to hold: it starts no battle, and in one begun only defends. */
    readonly holding: boolean;
    /** What it is made of and how good it is, in a line, for whoever answers for it. */
    readonly make: string | null;
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
  /** Sieges this power lays or suffers, with how near each city is to yielding. */
  readonly sieges: readonly { readonly id: string; readonly line: string }[];
  /** Armies facing each other with no order given, and fights begun and not yet decided (`engagements.ts`). */
  readonly fields: readonly { readonly id: string; readonly line: string }[];
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
  /** Each power that leads allies by foedus, and who they are: one line rather than one treaty apiece. */
  readonly confederations: readonly { readonly leader: string; readonly ours: boolean; readonly allies: readonly string[] }[];
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
    /** Days until it reaches its reader, while it is still on the road; null once there. */
    readonly arrivesInDays: number | null;
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
    /** Whether they read the government's own figures: men to raise, what a province could be taxed. */
    readonly governs: boolean;
    readonly provinces: number;
    readonly population: number;
    readonly availableManpower: number;
    /** Men our allies by foedus could send when called: they fight our wars, so their levies are ours to ask for. */
    readonly alliedManpower: number;
    /** What bread costs across our ground, 10 000 its ordinary price: it makes every army dearer or cheaper to keep. */
    readonly grainPriceBps: number;
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
  /** What sort of government it is, who may change it, and what has become custom. Null for nobody's. */
  readonly constitution: {
    readonly form: string;
    readonly ruler: string | null;
    readonly sovereign: string | null;
    readonly lastChange: string | null;
    readonly customs: readonly string[];
    /** How long its commanders hold their armies, and what the actor holds by it. */
    readonly command: string;
    readonly yourCommand: string | null;
  } | null;
  /** Bodies that can decide something, and the terms on which they decide it. */
  readonly institutions: readonly {
    readonly id: string;
    readonly name: string;
    readonly threshold: number;
    /** What the threshold is out of: the whole house, those present, or only the votes cast. */
    readonly countedOf: "total" | "present" | "cast";
    /** What it may decide, where that is less than everything, and whether its word binds anybody. */
    readonly powers: string | null;
    readonly advisory: boolean;
    /**
     * Who actually takes sides in it. Without their ids nobody can be recorded
     * as supporting anything -- so this is empty, never absent, for somebody
     * who does not sit in the body: everyone knows the Senate needs a majority,
     * and only its members know how the weight lies.
     */
    readonly blocs: readonly { readonly id: string; readonly name: string; readonly weight: number; readonly interest: string; readonly wants: string | null }[];
  }[];
  /** Factions outside any one body -- the other things that hold a position. */
  readonly factions: readonly { readonly id: string; readonly name: string; readonly kind: string; readonly members: number; readonly strength: number | null; readonly leader: string | null; readonly platform: string | null }[];
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
    /** For a question the chamber counts: how each bloc leans and how it would go today. Null where they are not party to it. */
    readonly forecast: string | null;
  }[];
  /** Questions settled lately, and whether settling them did anything -- so a carried one is carried out, not asked again. */
  readonly decided: readonly { readonly id: string; readonly label: string; readonly outcome: string; readonly daysAgo: number; readonly began: string | null }[];
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
  readonly populationGaps: readonly { readonly polityId: string; readonly name: string; readonly needsLeader: boolean; readonly needsForce: boolean; readonly land: readonly string[]; readonly why: string }[];
  readonly projects: readonly { readonly id: string; readonly label: string; readonly status: string; readonly overseer: string | null; readonly nextMilestone: { readonly id: string; readonly label: string } | null }[];
  readonly intents: readonly { readonly actor: string; readonly action: string; readonly rationale: string }[];
  /** Ids are printed: a discovery has to name the fact it uncovered, and nothing else ever showed one. */
  readonly recentHistory: readonly { readonly id: string; readonly summary: string; readonly significance: number }[];
  readonly dueEvents: readonly SliceEvent[];
  readonly pendingEvents: readonly SliceEvent[];
  readonly openOrders: readonly { readonly id: string; readonly recipient: string; readonly status: string }[];
  /**
   * What the actor ordered before and is not finished (`world/orders.ts`), with
   * where each part stands. What a new order says again continues these; a
   * part stopped or unanswered is for this order to take up.
   */
  readonly standingOrders: readonly { readonly said: string; readonly status: string; readonly why: string | null; readonly work: readonly string[] }[];
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

/**
 * Where the actor cannot simply do as they please, said before anything else.
 *
 * A man surrounded on a hill does not dine in the Forum that evening, and a
 * prisoner of Carthage does not march his legion: the world must not narrate
 * either, and it will unless it is told plainly.
 */
function plightOf(world: WorldState, actor: WorldState["characters"][number]): string | null {
  const standing = world.fieldPerils.find((peril) => peril.characterId === actor.id && peril.resolvedAtStep === null);
  const place = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const polity = (id: string): string => world.map.polities.find((candidate) => candidate.id === id)?.name ?? id;
  if (standing !== undefined) {
    return [
      `${standing.plight === "encircled" ? "SURROUNDED" : "CUT OFF"}: ${actor.name} is ${standing.plight === "encircled" ? "surrounded" : "cut off from the army"} at ${place(standing.provinceId)} with ${standing.companions} men, and ${world.material.forces.find((force) => force.id === standing.enemyForceId)?.name ?? polity(standing.enemyPolityId)} all round.`,
      "  How it ends is the engine's, decided at the opening of the next report. Nothing ordered now reaches past the enemy around them.",
    ].join("\n");
  }
  if (actor.disqualifyingStatuses.includes("captured")) {
    const taken = [...world.fieldPerils].reverse().find((peril) => peril.characterId === actor.id && peril.outcome === "captured");
    return [
      `A PRISONER: ${actor.name} is held${taken === undefined ? "" : ` by ${polity(taken.enemyPolityId)}`} at ${place(actor.locationProvinceId)}, and commands nothing.`,
      "  They can talk, write, bargain, promise and pay; a ransom, an exchange or an escape is how a prisoner goes free, and their captors decide whether it works.",
    ].join("\n");
  }
  // Sick in bed is no prison, but it is not a march either.
  if (actor.disqualifyingStatuses.includes("incapacitated")) {
    return [
      `ILL: ${actor.name} is ill and keeps to the house at ${place(actor.locationProvinceId)}.`,
      "  They can see people, write, and give orders for others to carry out; they cannot ride, fight or travel until they are on their feet again.",
    ].join("\n");
  }
  return null;
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
  /** What the actor has heard, for how well they can count another power's men. */
  const knownToActor = station === null ? [] : factsKnownToStation(input.facts, station, world.instant, world);
  // reachesPerson, not knowsPerson: someone who speaks for a whole power is
  // briefed on its figures whether or not he has dealt with them. Sight, not
  // acquaintance -- and of his own power's figures, not the world's.
  const knowsThem = (characterId: string): boolean => station === null || reachesPerson(station, characterId, world);

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
  const soldierPayPerThousand = opensTreasury ? world.map.polities.find((polity) => polity.id === ownPolity)?.soldierPayPerThousand ?? null : null;
  const monthlyExpenditure = Math.round(
    world.material.obligations
      .filter((obligation) => obligation.active && reachesAccount(obligation.payerAccountId))
      .reduce((sum, obligation) => sum + perDay(obligationAmountNow(world, obligation), obligation.cadenceSteps) * 30, 0),
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
      holding: force.hold === true,
      make: reachesForce(force.id) ? armyInWords(world, force) : null,
    }));

  // Every place the order might need to name, by the id it must name it by --
  // not only the places already ours. An order to invade names somewhere we do
  // not hold, and a model with no id for it will invent one.
  //
  // Which places those are has to be chosen, not taken off the top of the list.
  // The world holds thousands of provinces and the cap admits a few dozen, and
  // a power may hold hundreds of small ones itself, so neither "ours first" nor
  // an alphabetical tie-break can be trusted: the province with the army, the
  // siege, the storyline or the place the order names must never be the one cut.
  // So: (a) what the moment is about, in order of how directly; (b) our own and
  // our neighbours' ground, nearest to (a) first; (c) everything else, nearest
  // first. Ties fall to the name, then the id, so the choice is deterministic.
  const places = placeIndex(world);
  const ourProvinceIds = new Set([
    ...world.map.provinces.filter((province) => province.controllerPolityId === ownPolity).map((province) => province.id),
    ...world.material.forces.filter((force) => force.polityId === ownPolity).map((force) => force.locationId),
  ]);

  // Our allies by foedus hold their own ground, but it is the ground our wars
  // are fought across: a consul's neighbours are the allies' neighbours too.
  const alliedPolities = new Set(ownPolity === null ? [] : alliesLedBy(world.polityAgreements, ownPolity));
  const alliedProvinceIds = new Set(world.map.provinces
    .filter((province) => province.controllerPolityId !== null && alliedPolities.has(province.controllerPolityId))
    .map((province) => province.id));
  const inOurSphere = (id: string): boolean => ourProvinceIds.has(id) || alliedProvinceIds.has(id);
  const bordering = new Set<string>();
  for (const edge of world.map.edges) {
    if (inOurSphere(edge.from) && !inOurSphere(edge.to)) bordering.add(edge.to);
    if (inOurSphere(edge.to) && !inOurSphere(edge.from)) bordering.add(edge.from);
  }

  // Lower is more pressing: 0 the order's own words, 1 armies, sieges, battles
  // and where the actor stands, 2 open storylines, 3 our people's whereabouts.
  const pressing = new Map<string, number>();
  const matters = (id: string | null | undefined, weight: number): void => {
    if (typeof id !== "string" || !places.byId.has(id)) return;
    if (weight < (pressing.get(id) ?? Infinity)) pressing.set(id, weight);
  };
  if (input.orderText !== null) {
    for (const id of provinceIdsIn(places, input.orderText)) matters(id, 0);
    for (const id of provincesNamedIn(places, input.orderText)) matters(id, 0);
  }
  for (const force of world.material.forces) if (force.polityId === ownPolity) matters(force.locationId, 1);
  // A battle records who is fighting, not where; the ground is wherever the
  // forces in it are standing. A siege records the settlement, and the province
  // is the one holding it.
  const forceLocation = new Map(world.material.forces.map((force) => [force.id, force.locationId]));
  for (const battle of world.conflicts.battles) {
    for (const forceId of battle.participantForceIds) matters(forceLocation.get(forceId), 1);
  }
  for (const siege of world.conflicts.sieges) matters(places.provinceOfSettlement.get(siege.settlementId), 1);
  for (const siege of world.sieges) if (siege.status === "active") matters(siege.provinceId, 1);
  for (const storyline of openStorylines(world.storylines)) matters(storyline.provinceId, 2);
  for (const character of world.characters) {
    if (character.alive && character.polityId === ownPolity) matters(character.locationProvinceId, 3);
  }

  const reach = distancesFrom(places, pressing.size > 0 ? pressing.keys() : ourProvinceIds);
  const far = (id: string): number => reach.get(id) ?? Number.MAX_SAFE_INTEGER;
  const tier = (id: string): number => {
    if (pressing.has(id)) return 0;
    if (ourProvinceIds.has(id)) return 1;
    return bordering.has(id) || alliedProvinceIds.has(id) ? 2 : 3;
  };
  const provinces = [...world.map.provinces]
    .sort((a, b) => tier(a.id) - tier(b.id)
      || (pressing.get(a.id) ?? 0) - (pressing.get(b.id) ?? 0)
      || far(a.id) - far(b.id)
      || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
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

  // A private man's own plans, not his government's traps: he was shown every
  // armed plan his power had laid, and wrote orders as though they were his.
  const sieges = world.sieges
    .filter((siege) => siege.status === "active" && (ownPolity === null || siege.besiegerPolityId === ownPolity || siege.defenderPolityId === ownPolity))
    .slice(0, CAPS.standingPlans)
    .map((siege) => {
      const besieger = world.material.forces.find((force) => force.id === siege.forceId)?.name ?? siege.forceId;
      const city = world.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === siege.settlementId)?.name
        ?? provinceName(siege.provinceId) ?? siege.provinceId;
      const works = siege.works.filter((work) => work.status === "building" || work.status === "ready")
        .map((work) => `${work.kind}${work.status === "building" ? ` (ready in ${Math.max(0, work.readyAtStep - world.elapsedStep)} days)` : ""}`);
      return { id: siege.id, line: `${besieger} before ${city}, ${world.elapsedStep - siege.startedAtStep} days, ${Math.round(siege.pressureBps / 100)}% of the way to its yielding${works.length === 0 ? "" : `; works: ${works.join(", ")}`}` };
    });
  // Face to face, or already at it: a fight goes on until someone is beaten,
  // and facing is where one begins -- or does not, if nobody gives the order.
  const forceName = (id: string): string => world.material.forces.find((force) => force.id === id)?.name ?? id;
  const sideNames = (ids: readonly string[]): string => ids.map(forceName).join(" and ");
  const concerns = (ids: readonly string[]): boolean => ownPolity === null || ids.some((id) => world.material.forces.find((force) => force.id === id)?.polityId === ownPolity);
  const fields = world.engagements
    .filter((engagement) => engagement.status !== "ended" && concerns([...engagement.attackerForceIds, ...engagement.defenderForceIds]))
    .slice(0, CAPS.standingPlans)
    .map((engagement) => {
      const days = world.elapsedStep - engagement.openedAtStep;
      const where = provinceName(engagement.provinceId) ?? engagement.provinceId;
      return {
        id: engagement.id,
        line: engagement.status === "facing"
          ? `${sideNames(engagement.attackerForceIds)} and ${sideNames(engagement.defenderForceIds)} face each other at ${where}, ${days} days, and nobody has ordered an attack`
          : `${sideNames(engagement.attackerForceIds)} ${engagement.seeking === "battle" ? "offering battle to" : "harrying"} ${sideNames(engagement.defenderForceIds)} at ${where}, day ${days + 1}, ${engagement.pitchedRounds === 0 ? "no battle yet" : `${engagement.pitchedRounds} day${engagement.pitchedRounds === 1 ? "" : "s"} of battle`}; it goes on until one side is beaten`,
      };
    });
  // Bread on the road, and ports shut in: what decides a standoff as surely as a battle.
  const convoysOnTheRoad = world.convoys
    .filter((convoy) => convoy.status === "on_the_road" && (ownPolity === null || convoy.polityId === ownPolity))
    .slice(0, CAPS.standingPlans)
    .map((convoy) => ({ id: convoy.id, line: `a convoy of ${convoy.days} days' bread for ${forceName(convoy.forceId)}, arriving in ${Math.max(0, convoy.arrivesAtStep - world.elapsedStep)} days` }));
  const blockadeLines = world.blockades
    .filter((blockade) => blockade.status === "active" && (ownPolity === null || blockade.blockadedPolityId === ownPolity || blockade.blockaderPolityId === ownPolity))
    .slice(0, CAPS.standingPlans)
    .map((blockade) => ({ id: blockade.id, line: `${world.map.polities.find((polity) => polity.id === blockade.blockaderPolityId)?.name ?? blockade.blockaderPolityId} blockades ${provinceName(blockade.provinceId)}, ${world.elapsedStep - blockade.sinceStep} days, ${blockade.tightnessBps >= 5_000 ? "shut tight" : "loosely watched"}` }));
  const standingPlans = world.contingencies
    .filter((plan) => plan.status === "armed" && (ownPolity === null || plan.ownerPolityId === ownPolity)
      && (speaksForTheGovernment || station === null || plan.ownerCharacterId === station.characterId))
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
  // A private one only for those who govern a power party to it, or did; a
  // war, a peace or a truce for everybody (`treaty-knowledge.ts`).
  const treatyReader = station === null ? null : treatyViewer(world, station.characterId, input.offices);
  const visibleAgreements = world.polityAgreements
    .filter((agreement) => agreement.status === "active")
    .filter((agreement) => ownPolity === null || (treatyReader === null ? agreementIsOpen(agreement) || agreement.polityId === ownPolity || agreement.otherPolityId === ownPolity : knowsAgreement(treatyReader, agreement)));
  // A leader's allies are one fact, not one treaty each: eight foedera listed
  // apart pushed the war at Rhegium out of the capped list.
  const confederations = [...new Set(visibleAgreements.filter((agreement) => agreement.kind === "foedus").map((agreement) => agreement.otherPolityId))]
    .map((leader) => {
      const allies = visibleAgreements.filter((agreement) => agreement.kind === "foedus" && agreement.otherPolityId === leader).map((agreement) => agreement.polityId);
      return { leader: `${polityName(leader)} [${leader}]`, ours: leader === ownPolity || (ownPolity !== null && allies.includes(ownPolity)), allies: allies.map((id) => `${polityName(id)} [${id}]`) };
    })
    .sort((a, b) => Number(b.ours) - Number(a.ours))
    .slice(0, 3);
  // Treaties between two powers we have no business with are their own.
  const ourBusiness = powersDealtWith(world, input.actorRef.kind === "character" ? input.actorRef.id : null);
  const agreements = visibleAgreements
    .filter((agreement) => agreement.kind !== "foedus")
    .filter((agreement) => ourBusiness === null || agreement.kind === "war" || ourBusiness.has(agreement.polityId) || ourBusiness.has(agreement.otherPolityId))
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
    // One still on the road to us has not come; one of ours on the road is ours to know of.
    .filter((message) => message.fromPolityId === ownPolity || isDelivered(message, world.elapsedStep))
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
      arrivesInDays: isDelivered(message, world.elapsedStep) ? null : message.deliveredOnDay! - world.elapsedStep,
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
  // The figures a government reads -- the men it could raise, what each
  // province could be taxed -- are its own. Anybody knows how many people
  // there are and which provinces are hungry.
  const country = {
    governs: station === null || speaksForTheGovernment,
    provinces: ourMaterial.length,
    population: ourMaterial.reduce((sum, material) => sum + material.population, 0),
    availableManpower: ourMaterial.reduce((sum, material) => sum + material.availableManpower, 0),
    alliedManpower: world.material.provinceMaterial.filter((material) => alliedProvinceIds.has(material.provinceId)).reduce((sum, material) => sum + material.availableManpower, 0),
    grainPriceBps: ownPolity === null ? 10_000 : polityGrainPriceBps(world, ownPolity),
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

  const constitutionRecord = ownPolity === null ? undefined : world.constitutions.find((entry) => entry.polityId === ownPolity);
  const government = { offices: input.offices, successionRules: input.successionRules ?? [] };
  const constitution = ownPolity === null || constitutionRecord === undefined ? null : {
    form: GOVERNMENT_FORM_IN_WORDS[constitutionRecord.form],
    ruler: (() => {
      const office = rulerOfficeOf(world, ownPolity, government);
      const holder = rulerOf(world, ownPolity, government);
      return office === null ? null : `${office.label}${holder === null ? ", vacant" : `: ${holder.name}`}`;
    })(),
    sovereign: sovereignChamberOf(world, ownPolity)?.name ?? null,
    lastChange: constitutionRecord.history.at(-1)?.summary ?? null,
    customs: world.genericEntities.filter((entity) => entity.kind === "custom" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === ownPolity).map((entity) => entity.label).slice(0, 4),
    command: COMMAND_TENURE_IN_WORDS[commandTenureOf(world, ownPolity)],
    yourCommand: (() => {
      const hold = input.actorRef.kind !== "character" ? undefined : world.commandHolds.find((candidate) => candidate.status === "active" && candidate.characterId === input.actorRef.id);
      if (hold === undefined) return null;
      const army = hold.forceIds.map((id) => world.material.forces.find((force) => force.id === id)?.name).filter((label): label is string => label !== undefined).join(" and ") || "the army";
      const who = (id: string | null): string => world.characters.find((character) => character.id === id)?.name ?? "his successor";
      switch (hold.basis) {
        case "prorogued": return `He holds ${army} as pro-magistrate, by the chamber's vote, until day ${hold.untilStep}.`;
        case "awaiting_successor": return hold.successorCharacterId === null ? `His year is over; he keeps ${army} until a successor is chosen.` : `His year is over; he keeps ${army} until ${who(hold.successorCharacterId)} arrives to take it, about day ${hold.untilStep}.`;
        case "legate": return `He serves as legate of ${army} under ${who(hold.superiorCharacterId)}: its men take his orders while ${who(hold.superiorCharacterId)} lets them; leaving the army ends it.`;
        case "triumph": return "He waits outside the city for the vote on his triumph.";
      }
    })(),
  };

  const institutions = ourInstitutions.slice(0, CAPS.institutions).map((institution) => ({
    id: institution.id,
    name: institution.name,
    threshold: outOfHundred(institution.passageThresholdBps),
    countedOf: institution.denominator,
    // Only said where it is less than everything.
    powers: institution.powers === undefined || institution.powers.length === ALL_CHAMBER_POWERS.length ? null : institution.powers.join(", ") || "nothing",
    advisory: institution.advisory === true,
    // An institution is a room; the blocs are the people in it. Printing the
    // room alone left the model naming the Senate itself as a supporter, which
    // is not a thing that can hold an opinion.
    blocs: station !== null && !station.institutionIds.has(institution.id)
      ? []
      : institution.votingBlocs.slice(0, 8).map((bloc) => ({
        id: bloc.id, name: bloc.name, weight: bloc.weight, interest: bloc.representedInterest,
        wants: (bloc.interests ?? []).length === 0 ? null : (bloc.interests ?? []).map((interest) => INTEREST_IN_WORDS[interest]).join(" and "),
      })),
  }));

  const factions = world.material.politicalGroups
    .filter((group) => group.active && (ownPolity === null || group.polityId === ownPolity))
    .sort((a, b) => (b.strengthBps ?? 0) - (a.strengthBps ?? 0) || a.id.localeCompare(b.id))
    .slice(0, CAPS.groups)
    .map((group) => ({
      id: group.id,
      name: group.name,
      kind: group.type,
      members: world.material.groupMemberships.filter((membership) => membership.groupId === group.id && membership.leftAtStep === null).length,
      strength: group.strengthBps === undefined ? null : outOfHundred(group.strengthBps),
      leader: group.leaderCharacterId === null ? null : name(group.leaderCharacterId),
      platform: group.platform.length === 0 ? null : group.platform.slice(0, 2).join("; "),
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
        dueInDays: isChamberQuestion(procedure) ? voteDayOf(procedure) - world.elapsedStep : procedure.deadlineStep === null ? null : procedure.deadlineStep - world.elapsedStep,
        supportWeight: party ? positions.filter((position) => position.position === "support").reduce((sum, position) => sum + position.influenceWeight, 0) : null,
        opposeWeight: party ? positions.filter((position) => position.position === "oppose").reduce((sum, position) => sum + position.influenceWeight, 0) : null,
        forecast: party ? forecastInWords(world, procedure, input.offices) : null,
      };
    });

  // The Senate carried a fleet 119 to 0, and three months later the consul
  // was sent back to ask it again: a settled question left the slice the day
  // it was settled.
  const decided = world.material.politicalProcedures
    .filter((procedure) => procedure.stage === "resolved" && procedure.resolvedAtStep !== null && world.elapsedStep - procedure.resolvedAtStep <= 365)
    .filter((procedure) => procedure.institutionId !== null && ourInstitutionIds.has(procedure.institutionId) && procedure.subjectKind !== "office_seat")
    .sort((a, b) => b.resolvedAtStep! - a.resolvedAtStep!)
    .slice(0, 4)
    .map((procedure) => {
      const projectId = world.enactments.find((enactment) => enactment.procedureId === procedure.id)?.projectId;
      return {
        id: procedure.id,
        label: procedure.label,
        outcome: procedure.outcome ?? "resolved",
        daysAgo: world.elapsedStep - procedure.resolvedAtStep!,
        began: world.projects.find((project) => project.id === projectId)?.label ?? null,
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

  // A private man owes what he owes; his neighbours' debts and the state's
  // are not his to read, and were a reason to write orders about them.
  const debts = world.material.loans
    .filter((loan) => loan.status !== "repaid" && ourAccountIds.has(loan.borrowerAccountId) && reachesAccount(loan.borrowerAccountId))
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
    .filter((source) => source.counterpartyPolityId !== null && source.counterpartyPolityId !== ownPolity && ourAccountIds.has(source.beneficiaryAccountId) && reachesAccount(source.beneficiaryAccountId))
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
  // Only the powers our government deals with: a far king's aims are the
  // world AI's to pursue now (`statecraft.ts`), not the orchestrator's, and
  // twenty more powers with aims of their own would cost every order their
  // weight in prompt.
  const dealtWith = powersDealtWith(world, input.actorRef.kind === "character" ? input.actorRef.id : null);
  const outlooks = [...world.polityOutlooks]
    .filter((outlook) => dealtWith === null || dealtWith.has(outlook.polityId))
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

  // Our own allies are named once, under WHERE THE POWERS STAND, and do not
  // take the places of the powers we might have to fight.
  const foreignPowers = world.map.polities
    .filter((polity) => polity.id !== ownPolity && !alliedPolities.has(polity.id))
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
        // Another power's numbers are a guess, and as good as the source: the
        // model hears what the character could, never the true count.
        .map((force) => `${force.name}${force.outlaw === true ? " (outlaw)" : ""} [${force.id}] — ${station === null ? `${force.personnel.reduce((sum, category) => sum + category.fit, 0)} men` : strangerStrength(force, station.provinceIds, knownToActor, station.characterId, world.elapsedStep).label.replace("unknown to you", "strength unknown")} at ${provinceName(force.locationId)} [${force.locationId}]`),
    }))
    .filter((power) => power.provinces > 0 || power.leaders.length > 0 || power.forces.length > 0)
    .sort((a, b) => {
      const weight = (power: { id: string }): number =>
        (neighbouringPolities.has(power.id) ? 0 : entangled.has(power.id) ? 1 : 2);
      return weight(a) - weight(b) || b.provinces - a.provinces || a.id.localeCompare(b.id);
    })
    .slice(0, CAPS.foreignFigures);

  const populationGaps = findPolityGaps({ world, ownPolityId: ownPolity, facts: input.facts, limit: 2 })
    .map(({ provinceIds, ...gap }) => ({ ...gap, land: provinceIds.map((id) => `${provinceName(id)} [${id}]`) }));

  const projects = world.projects
    .filter((project) => project.status !== "completed" && project.status !== "cancelled")
    .slice(0, CAPS.projects)
    .map((project) => ({
      id: project.id,
      label: project.label,
      status: project.status,
      overseer: project.overseerCharacterId == null ? null : world.characters.find((character) => character.id === project.overseerCharacterId)?.name ?? null,
      nextMilestone: (() => {
        const pending = project.milestones.find((milestone) => milestone.status === "pending");
        return pending === undefined ? null : { id: pending.id, label: pending.label };
      })(),
    }));

  // The most pressing first, newest among equals: this took the first eight
  // ever written, which were the oldest and long since stale.
  const intents = mostPressingFirst(world.characterIntents.filter(isOpenIntent))
    // What a man means to do is known to the people who deal with him. This
    // line showed every Roman's private plan to every other Roman.
    .filter((intent) => knowsThem(intent.actorCharacterId))
    .slice(0, CAPS.intents)
    .map((intent) => ({ actor: name(intent.actorCharacterId), action: intent.actionType, rationale: intent.rationale }));

  // Only what this actor could actually know -- narrowed from what their
  // government knows, which is a different and much larger thing.
  const recentHistory = (station === null
    ? factsKnownTo(input.facts, input.actorRef, ownPolity, world.instant, world)
    : factsKnownToStation(input.facts, station, world.instant, world))
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

  // Orders he gave or was given, unless he speaks for the government that
  // gives them all.
  const openOrders = world.orderAttempts
    .filter((attempt) => attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed" || attempt.status === "accepted")
    .filter((attempt) => station === null || speaksForTheGovernment || attempt.issuerRef.id === station.characterId || attempt.recipientRef.id === station.characterId)
    .slice(0, CAPS.events)
    .map((attempt) => ({ id: attempt.id, recipient: name(attempt.recipientRef.id), status: attempt.status }));

  // Still open, or finished badly by the last order: a part that failed two
  // orders ago was answered then, and is not standing now.
  const ownOrders = world.orders.filter((order) => order.actorCharacterId === input.actorRef.id);
  const standingOrders = ownOrders
    .flatMap((order) => order.parts.map((part) => ({ part, latest: order === ownOrders.at(-1) })))
    .filter(({ part, latest }) => part.closedAtStep === null && orderPartStatus(world, part) !== "achieved" && (latest || isOrderPartOpen(world, part)))
    .map(({ part }) => part)
    .slice(-CAPS.standingPlans)
    .map((part) => ({
      said: part.said,
      status: ORDER_PART_STATUS_LABEL[orderPartStatus(world, part)],
      why: part.refusal ?? part.whyNot,
      work: part.workRefs.map((ref) => `${ref.kind} ${ref.id}`),
    }));

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
      permitted: actor === undefined ? [] : [
        ...describeAuthority(buildStation({ world, characterId: input.actorRef.id, offices: input.offices }), world),
        // The tribune's one great power is no grant at all: opposing a
        // question before his power's chambers forbids it (`senate.ts`).
        ...allOffices(world, input.offices)
          .filter((office) => office.vetoes === true && world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.holderCharacterId === input.actorRef.id && seat.status === "held"))
          .map((office) => `forbid, as ${office.label}: opposing a question put to ${polityName(office.polityId)}'s chambers stops it being carried, while he holds to it.`),
        // And a magistrate's act inside the city, by interceding against him.
        ...allOffices(world, input.offices)
          .filter((office) => office.tribunician === true && world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.holderCharacterId === input.actorRef.id && seat.status === "held"))
          .map(() => `intercede against a magistrate's act within the city (not in the field, not a dictator's): generic_entity_create kind "intercession", owner himself, attributes {against: the magistrate's id, act: "levy" | "spending" | "motion" | "appointment" | "all"}; retire it to lift it. His person is sacrosanct.`),
        // Who may lay a question before which chamber: a senator speaks when
        // asked, and moves nothing himself.
        ...(() => {
          const held = new Set(world.material.officeSeats.filter((seat) => seat.holderCharacterId === input.actorRef.id && seat.status === "held").map((seat) => seat.officeId));
          const chambers = world.material.institutions.filter((institution) => (institution.convenedByOfficeIds ?? []).some((officeId) => held.has(officeId)));
          return chambers.length === 0 ? [] : [`convene and put questions to: ${chambers.map((institution) => `${institution.name} [${institution.id}]`).join(", ")}.`];
        })(),
      ],
      plight: actor === undefined ? null : plightOf(world, actor),
      service: actor === undefined ? null : serviceInWords(world, actor),
    },
    economy: accounts,
    monthlyIncome,
    monthlyExpenditure,
    loanOffers: input.actorRef.kind === "character" ? loanOfferLines(world, input.actorRef.id) : [],
    taxBurden,
    soldierPayPerThousand,
    military,
    foreignPowers,
    populationGaps,
    provinces,
    standingPlans,
    sieges,
    fields: [...fields, ...convoysOnTheRoad, ...blockadeLines],
    troopKinds,
    faiths: world.faiths.slice(0, CAPS.faiths).map((faith) => faith.name),
    politics,
    diplomacy,
    agreements,
    confederations,
    letters,
    standing,
    country,
    constitution,
    institutions,
    council,
    decided,
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
    standingOrders,
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
  if (slice.actor.plight !== null) lines.push(slice.actor.plight, "");
  if (slice.actor.service !== null) lines.push(`IN THE RANKS: ${slice.actor.service}`, "");
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
      "A QUESTION WAS PUT TO THEM:",
      `  ${slice.answeredDecision.prompt}`,
      "THEIR ANSWER:",
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
    ...slice.loanOffers.map((line) => `Offered: ${line}`),
    ...(slice.taxBurden === null ? [] : [
      `Our lands' taxes: ~${slice.taxBurden.asked}/month asked of ~${slice.taxBurden.bearable} bearable (${slice.taxBurden.inWords}); more is not collected, and past half, order sours.`,
    ]),
    ...(slice.soldierPayPerThousand === null ? [] : [
      `Our soldiers are paid ${slice.soldierPayPerThousand}/month for every 1,000 men.`,
    ]),
  ]);
  section("MILITARY", slice.military.map((force) => {
    const where = `at ${force.location} [${force.locationId}], under ${force.commander}${force.ranks.length === 0 ? "" : `, with ${force.ranks.join(", ")} in the ranks`}`;
    if (force.banded) return `${force.name} [${force.id}] — about ${force.strength} men ${where}`;
    const short = force.paperStrength !== null && force.strength < force.paperStrength ? ` of ${force.paperStrength} on the books` : "";
    const fed = force.provisions === null || force.provisions === "provisioned" ? "" : `, ${force.provisions} of supply`;
    return `${force.name} [${force.id}] — ${force.strength} men${short} ${where}, morale ${force.morale}/100${fed}${force.holding ? ", under orders to hold" : ""}${force.make === null ? "" : `; ${force.make}`}${force.plan === null ? "" : `; if attacked: ${force.plan}`}`;
  }));
  section("PLANS STANDING", slice.standingPlans.map((plan) =>
    `${plan.label} [${plan.id}] — ${plan.effect === "spring_trap" ? "prepared, and springs by itself" : "waiting to raise the alarm"}, in ${plan.where}`));
  section("SIEGES", slice.sieges.map((siege) => `${siege.line} [${siege.id}]`));
  section("IN THE FIELD", slice.fields.map((field) => `${field.line} [${field.id}]`));
  section("KINDS OF SOLDIER", slice.troopKinds.length === 0 ? [] : [
    `${slice.troopKinds.map((kind) => `${kind.label} [${kind.id}]`).join("; ")}. A kind not listed here can be taken into an army anyway -- name it and say what sort of troops they are.`,
  ]);
  section("PLACES", slice.provinces.map((province) => {
    const cities = province.cities.length === 0
      ? ""
      // A city is named with its holder only where that is not the province's.
      : `. Cities: ${province.cities.map((city) => `${city.name} [${city.id}]${city.controller === province.controller ? "" : `, ${city.controller}`}, walls ${city.walls}/10`).join("; ")}`;
    const ground = province.ground.length === 0
      ? ""
      : `. Ground: ${province.ground.map((spot) => `${spot.label} [${spot.id}], ${spot.type}`).join("; ")}`;
    const buildings = province.buildings.length === 0 ? "" : `. Standing there: ${province.buildings.join("; ")}`;
    const belief = province.belief.length === 0 ? "" : `. Believe: ${province.belief.join(", ")}, the rest as of old`;
    return `${province.name} [${province.id}] — ${province.controller === "uncontrolled" ? "held by no one" : `held by ${province.controller}`}${cities}${ground}${buildings}${belief}`;
  }));
  section("FAITHS", slice.faiths.length === 0 ? [] : [`${slice.faiths.join("; ")}. A faith not listed is founded by naming it.`]);
  section("OTHER POWERS", slice.foreignPowers.map((power) => {
    const people = power.leaders.length === 0 ? "nobody known to lead them" : power.leaders.join("; ");
    const arms = power.forces.length === 0 ? "no forces known in the field" : power.forces.join("; ");
    return `${power.name} [${power.id}] — ${power.provinces} province(s), ${power.cohesion}. ${people}. ${arms}`;
  }));
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
    "CONSTITUTION",
    slice.constitution === null ? [] : [
      `It is ${slice.constitution.form}. ${slice.constitution.ruler === null ? "It has no single head." : `Its head: ${slice.constitution.ruler}.`} ${slice.constitution.sovereign === null ? "No chamber holds the constitution: its ruler decrees changes to it." : `Only the ${slice.constitution.sovereign} may change the constitution.`}`,
      ...(slice.constitution.lastChange === null ? [] : [`Last changed: ${slice.constitution.lastChange}`]),
      ...slice.constitution.customs.map((custom) => `Custom: ${custom}.`),
      `Command: ${slice.constitution.command}.`,
      ...(slice.constitution.yourCommand === null ? [] : [slice.constitution.yourCommand]),
    ],
  );
  section(
    "INSTITUTIONS",
    slice.institutions.flatMap((institution) => [
      `${institution.name} [${institution.id}] — ${institution.advisory ? "advises the ruler; its count binds nobody" : `${institution.threshold}/100 of ${institution.countedOf === "cast" ? "the votes cast (abstentions count for nothing)" : institution.countedOf === "present" ? "the weight present" : "the whole house's weight"} needed to carry a question`}${institution.powers === null ? "" : `; decides only ${institution.powers}`}`,
      ...institution.blocs.map((bloc) => `  ${bloc.name} [${bloc.id}] — weight ${bloc.weight}, ${bloc.wants === null ? `speaks for ${bloc.interest}` : `for ${bloc.wants}`}`),
    ]),
  );
  section("FACTIONS", slice.factions.map((faction) =>
    `${faction.name} [${faction.id}] — ${faction.kind}${faction.strength === null ? "" : `, strength ${faction.strength}/100`}${faction.leader === null ? "" : `, led by ${faction.leader}`}, ${faction.members} member(s)${faction.platform === null ? "" : `; wants: ${faction.platform}`}`));
  section(
    "BEFORE THE COUNCIL",
    slice.council.map((question) => {
      const where = question.institution === null ? "decided by its sponsor" : `before the ${question.institution}`;
      const when = question.dueInDays === null ? "" : `, due in ${question.dueInDays} days`;
      // A counted question says how the house leans; any other, the weight declared.
      const tally = question.forecast !== null
        ? ` ${question.forecast[0]!.toUpperCase()}${question.forecast.slice(1)}`
        : question.supportWeight === null || question.opposeWeight === null
          ? ""
          : ` For ${question.supportWeight}, against ${question.opposeWeight}.`;
      return `${question.label} [${question.id}] — ${question.type}, ${where}, raised by ${question.sponsor}${when}.${tally}`;
    }),
  );
  section("DECIDED", slice.decided.map((question) =>
    `${question.label} [${question.id}] — ${question.outcome} ${question.daysAgo} days ago; ${question.began === null ? "it began nothing, so doing what it allowed is an order of its own" : `began ${question.began}`}.`));
  section(
    "THE COUNTRY",
    slice.country.provinces === 0
      ? []
      : [
        slice.country.governs
          ? `${slice.country.provinces} province(s), ${slice.country.population} people, ${slice.country.availableManpower} men available to raise${slice.country.alliedManpower > 0 ? `, and ${slice.country.alliedManpower} more our allies send by foedus when a war opens` : ""}.`
          : `${slice.country.provinces} province(s), ${slice.country.population} people.`,
        // Said only when it is news: bread at its ordinary price is no line of prompt.
        ...(Math.abs(slice.country.grainPriceBps - 10_000) < 1_500 ? [] : [`Grain sells at ${Math.round(slice.country.grainPriceBps / 100)}% of its ordinary price${slice.country.grainPriceBps > 10_000 ? ": bread is dear, and armies cost more to keep" : ": bread is cheap"}.`]),
        ...slice.country.strained.map((province) =>
          slice.country.governs
            ? `${province.name} [${province.id}] — ${province.manpower} men, food ${province.food}/100, order ${province.stability}/100, war damage ${province.warDamage}/100, taxable ${province.taxCapacity}`
            : `${province.name} [${province.id}] — food ${province.food}/100, order ${province.stability}/100, war damage ${province.warDamage}/100`),
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
      // A pursuit is somebody's word for what he is doing, not work being done.
      const idle = entity.kind === "pursuit" && entity.rule === null ? "; an intention only, nothing is being done about it" : "";
      return `${entity.label} [${entity.id}] (${entity.kind}${owner}${idle})${entity.retired ? ", repealed" : ""}${entity.lapsed ? ", fallen into disuse" : ""}${detail}${does}${rule}`;
    }),
  );
  section("LANDS AND HOLDINGS", slice.holdings.map((holding) =>
    `${holding.title} [${holding.id}] in ${holding.territoryId} — held in law by ${holding.holder} [${holding.holderId}], held in fact ${holding.control}/100${holding.monthlyYield === null ? "" : `, yielding ~${holding.monthlyYield} a month`}`));
  section("DIPLOMACY", slice.diplomacy.map((stance) => `toward ${stance.toward}: trust ${stance.trust} (${stance.why})`));
  section("WHERE THE POWERS STAND", [
    ...slice.confederations.map((confederation) =>
      `${confederation.leader} leads by foedus${confederation.ours ? " (ours)" : ""}: ${confederation.allies.join(", ")} — men when called, no tribute, no war or peace of their own`),
    ...slice.agreements.map((agreement) => {
      const term = agreement.endsInDays === null ? "" : `, for another ${agreement.endsInDays} day(s)`;
      return `[${agreement.id}] ${agreement.kind}${agreement.ours ? " (ours)" : ""}: ${agreement.between} — ${agreement.terms}${term}`;
    }),
  ]);
  section("LETTERS AWAITING AN ANSWER", slice.letters.map((letter) => {
    const due = letter.dueInDays === null ? "no term set" : letter.dueInDays < 0 ? `overdue by ${-letter.dueInDays} day(s)` : `answer wanted within ${letter.dueInDays} day(s)`;
    const road = letter.arrivesInDays === null ? "" : `, still on the road: it reaches them in ${letter.arrivesInDays} day(s)`;
    return `[${letter.id}] ${letter.kind} ${letter.ours ? `we sent to ${letter.to}` : `${letter.from} sent us`} — ${letter.subject}: ${letter.terms} (${due}${road})`;
  }));
  section("STANDING INTENTIONS", slice.intents.map((intent) => `${intent.actor} means to ${intent.action}: ${intent.rationale}`));
  section("ORDERS AWAITING AN ANSWER", slice.openOrders.map((order) => `${order.id} to ${order.recipient} — ${order.status}`));
  section("YOUR STANDING ORDERS", slice.standingOrders.map((order) =>
    `"${order.said}" — ${order.status}${order.why === null ? "" : `: ${order.why.slice(0, 200)}`}${order.work.length === 0 ? "" : ` [${order.work.join(", ")}]`}`));
  section("RECENT HISTORY (only what is known to them)", slice.recentHistory.map((entry) => `${entry.summary} [${entry.id}]`));
  // ── The world's own half ───────────────────────────────────────────────
  //
  // Everything from here on exists for the orchestrator *as the world*, not
  // for the person whose order it is answering: a foreign power's private aims,
  // the threads the world is following (secret ones included), the directives
  // telling it to people a country or start something, every power's projects
  // and the whole world's calendar. Their own comments say so. Filtering them
  // would not make the reader less omniscient; it would make the world
  // incoherent, and send the model back to inventing placeholder ids for what
  // it could no longer see.
  //
  // So they are labelled instead, and they come last. The header once stood in
  // the middle, and fourteen sections of what the actor did know -- his
  // people, his letters, his own recent history -- followed it under the words
  // "they have been told none of what follows".
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
        const land = gap.land.length === 0 ? "" : ` Their land: ${gap.land.join("; ")}.`;
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
  section("ACTIVE PROJECTS", slice.projects.map((project) =>
    `${project.label} [${project.id}] — ${project.status}${project.overseer === null ? "" : `, in ${project.overseer}'s hands`}${project.nextMilestone === null ? "" : `, next: ${project.nextMilestone.label} [${project.nextMilestone.id}]`}`));
  const threadOf = (event: SliceEvent): string => (event.thread === undefined ? "" : ` (thread: ${event.thread})`);
  section("DUE NOW", slice.dueEvents.map((event) => `${event.kind}: ${event.summary}${threadOf(event)}`));
  section("SCHEDULED AHEAD", slice.pendingEvents.map((event) => `in ${event.dueInDays} days — ${event.kind}: ${event.summary}${threadOf(event)}`));

  return lines.join("\n").trim();
}
