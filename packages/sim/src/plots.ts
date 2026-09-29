import {
  aptitude,
  readDepartments,
  officeholderPolity,
  INJURIES,
  PLOT_MAX_DAYS,
  PLOT_MAX_ODDS_BPS,
  PLOT_MIN_DAYS,
  PLOT_MIN_ODDS_BPS,
  applyInjury,
  injuryStatusId,
  classifyLifeStage,
  createPressure,
  currentAgeYears,
  isPlotOpen,
  stableHash,
  type Character,
  type CovertPlot,
  type CovertPlotKind,
  type CovertPlotOutcome,
  type FactProposalDraft,
  type ScenarioLifeRules,
  type WorldState,
  deriveRelationDimension,
  computeOpinion,
  leaning,
} from "@chronica/shared";
import { killCharacter } from "./mortality";
import { hisMasters, kinOf, remember, teach, type Grievance } from "./grievances";
import type { IdFactory } from "./ports";

/**
 * Plots against people, and how they come out.
 *
 * "Claudius would use the budget from the Senate to hire an experienced
 * assassin to kill Fabius without ever revealing his identity" is the oldest
 * order in this genre, and until now the engine had no answer to it at all.
 * Death has one door -- `mortality.ts`, behind a peril that must stand
 * forty-five days -- and that door opens on a roll off the age table, so no
 * order a player could write would ever kill anybody. The nearest thing the
 * vocabulary could say was to take the mark's health to nothing and tag him
 * `"dead"`, which left a man at no health, marked dead, and alive, still
 * commanding his army in the next battle.
 *
 * This is the missing piece, and it is built on four rules that came from the
 * table rather than from the code:
 *
 * **The order is always allowed.** Hiring a killer is a thing a person can do.
 * The engine may refuse an order because the world makes it impossible; it may
 * never refuse one because it has no mechanism for it.
 *
 * **It is not easy, and it is never a foregone conclusion.** Odds are settled
 * once, when the plot is laid, out of state the world already keeps: whose hand
 * it is and how good they are at this, what was paid, how guarded the mark is,
 * how exposed, and whether he has already been warned. Bounded at both ends --
 * never below 2%, never above 60% -- because an attempt on a life is neither
 * impossible nor certain, and both of those were the old behaviour.
 *
 * **It takes time, and it is several chronicles while it takes it.** The world
 * says how long it thinks it needs; the engine holds that between three weeks
 * and a year, and puts a development into the plot's own thread at the halfway
 * mark. A mark may be warned in between, which makes him harder to reach. That
 * is the whole difference between a plot and a dice roll.
 *
 * **Four endings, of which one is a death.** Most attempts failed. A good many
 * that did not still left the mark alive and short of an eye, which is what
 * `characters/injury.ts` is for.
 *
 * ## The player, and the one way he dies
 *
 * A player character is never killed by a plot -- with one exception, which was
 * asked for by name: the Ides. An old man, at the height of what he has built,
 * comfortable, holding office, with nothing standing over him. Below that bar
 * the ladder stops at maiming and everything else is fair game: an eye, an arm,
 * a leg that never sets right. Nobody is quietly protected from consequences;
 * they land on the body instead of ending the game.
 *
 * ## The determinism trap
 *
 * Every roll hashes on the plot's own id and the day it was *scheduled* to
 * resolve, never the day being ticked to. `tickTo` runs several times per burst
 * at hop boundaries, so a replay whose hops land differently would tick to
 * different days -- and a world that rolls differently on replay is not a world
 * you can replay. This is the same trap `mortality.ts` documents, and it is the
 * same guard.
 */

/** Where the floor of the ladder sits for each kind of thing somebody can lay. */
const BASE_ODDS_BPS: Record<CovertPlotKind, number> = {
  // Getting a knife into a guarded man is the hard one, and always was.
  assassination: 1_200,
  // Slower, quieter, and it only has to be right once.
  poison: 1_500,
  // Taking somebody alive means getting away with him afterwards.
  abduction: 1_000,
  // Things are easier to destroy than people are to kill.
  sabotage: 2_500,
  // Learning a man's business is easier still: a servant, a clerk, a wine cup.
  espionage: 3_500,
};

/** A man of this prestige is a man with people around him at all hours. */
const GUARDED_BY_PRESTIGE_BPS = 1_200;

/** What money buys, with the returns it actually has: steep at first, flat later. */
function boughtWith(spend: number): number {
  return Math.min(1_500, Math.round(Math.sqrt(Math.max(0, spend)) * 25));
}

/** Above the middling fifty, a skill helps; below it, it hurts. Bounded at a thousand either way. */
const fromSkill = (skill: number): number => Math.max(-1_000, Math.min(1_000, (skill - 50) * 20));

export interface PlotOddsInput {
  readonly kind: CovertPlotKind;
  readonly target: Character;
  readonly sponsor: Character;
  readonly agent: Character | null;
  readonly spend: number;
}

/**
 * What a plot's chances actually are, and how well hidden it is.
 *
 * Settled once and then never rewritten, so that a plot cannot be improved by
 * ordering it again, and so a reader can see afterwards what the odds had been
 * when it was laid.
 */
export function plotOdds(world: WorldState, input: PlotOddsInput): { successOddsBps: number; secrecyBps: number } {
  const hand = input.agent ?? input.sponsor;

  let odds = BASE_ODDS_BPS[input.kind];
  // Whose hand it is. A hired professional is the difference between a plot and
  // a grudge, which is why `agentCharacterRef` exists at all.
  // The hand's intrigue, and his gift for working on people: half each.
  odds += fromSkill((hand.skills.intrigue + aptitude(hand, "manipulation")) / 2);
  odds += boughtWith(input.spend);
  // The mark's own wits, and the people his standing keeps around him -- and
  // his informers: a man who runs spies hears of the knife before it falls.
  // A man in the state's service is watched over by the state's own watch as
  // well: whichever is the sharper, his informers or its.
  const inCharge = readDepartments(world);
  const ownWits = (input.target.skills.intrigue + aptitude(input.target, "espionage")) / 2;
  const guardedBy = officeholderPolity(world, input.target.id, input.target.polityId);
  const watched = guardedBy === null ? ownWits : Math.max(ownWits, inCharge.skill({ kind: "polity", id: guardedBy }, "watch"));
  odds -= fromSkill(watched);
  odds -= Math.round((input.target.prestigeBps / 10_000) * GUARDED_BY_PRESTIGE_BPS);

  // Where he is and what he is doing. A man on campaign sleeps in a tent among
  // thousands of men, any of whom may be bought; a man at home does not.
  const commanding = world.material.forces.some((force) => force.commanderCharacterId === input.target.id);
  if (commanding) odds += 500;

  const here = world.material.provinceMaterial.find((material) => material.provinceId === input.target.locationProvinceId);
  if (here !== undefined && here.stabilityBps < 3_000) odds += 300;

  // A man who already knows somebody is at him. This is what makes warning
  // somebody a real act, and what makes a plot that runs long a worse plot.
  const warned = world.characterPressures.some(
    (pressure) => pressure.characterId === input.target.id && pressure.status === "active" && pressure.kind === "threat",
  );
  if (warned) odds -= 800;

  // A sick or broken man is easier to finish than a sound one.
  odds += Math.round(((10_000 - input.target.healthBps) / 10_000) * 500);
  // What sort of men they are. A bold hand strikes harder and talks more; a
  // careless mark walks where a cautious one would not.
  odds += leaning(hand, "risk") * 15 + leaning(input.target, "risk") * 10;

  // How quiet it is. Money buys silence up to the point where it starts buying
  // accomplices instead, and every extra hand is another mouth.
  const secrecy = Math.max(500, Math.min(9_500,
    5_000
    // Keeping it quiet is a spymaster's craft more than a schemer's.
    + fromSkill((hand.skills.intrigue + aptitude(hand, "espionage")) / 2)
    - Math.round(boughtWith(input.spend) / 2)
    - (input.agent === null ? 1_000 : 0)
    // A disciplined man keeps his counsel, a rash one does not, and a liar is
    // better at not being found out than an honest man is.
    + (leaning(hand, "discipline") - leaning(hand, "risk") - leaning(hand, "honesty")) * 20,
  ));

  // A plot the state lays -- its sponsor sits in one of its offices -- is as
  // good as the head of its secret work makes all such work: a seventh
  // better, or worse, whoever's hand it is.
  const layingPower = officeholderPolity(world, input.sponsor.id, input.sponsor.polityId);
  const lift = layingPower === null ? 0 : inCharge.headLift({ kind: "polity", id: layingPower }, "covert");
  const lifted = Math.round(odds * (1 + lift));

  return {
    successOddsBps: Math.max(PLOT_MIN_ODDS_BPS, Math.min(PLOT_MAX_ODDS_BPS, lifted)),
    secrecyBps: Math.max(500, Math.min(9_500, Math.round(secrecy * (1 + lift)))),
  };
}

/** The world's pacing, held inside the engine's bounds. */
export const plotResolvesIn = (expectedInDays: number): number =>
  Math.max(PLOT_MIN_DAYS, Math.min(PLOT_MAX_DAYS, expectedInDays));

/**
 * Whether this is a death the game is allowed to end on.
 *
 * The Ides, and nothing less: an old man at the top of what he built, holding
 * office, comfortable, with nothing already standing over him. Every clause is
 * checkable and every one of them was asked for -- the point is that the
 * player's death, when it comes, is the one everybody saw coming and nobody
 * stopped, rather than a bad roll in his forties.
 */
export function atTheirPeak(world: WorldState, character: Character, life: ScenarioLifeRules | undefined, atDay: number): boolean {
  if (life === undefined) return false;
  const stages = life.lifeStages;
  const stage = classifyLifeStage(currentAgeYears(character, atDay), stages);
  const last = stages[stages.length - 1];
  if (stage === undefined || last === undefined || stage.id !== last.id) return false;
  if (character.prestigeBps < 8_000) return false;
  if (character.officeId === null) return false;
  // Comfortable: nothing already bearing down on him. A man in trouble who is
  // then murdered has been killed off, which is the thing this forbids.
  return !world.characterPressures.some(
    (pressure) => pressure.characterId === character.id && pressure.status === "active"
      && (pressure.kind === "political_danger" || pressure.kind === "threat" || pressure.kind === "illness"),
  );
}

export interface PlotReviewInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  readonly life?: ScenarioLifeRules | undefined;
  /** Whose death ends the game rather than merely the man. Killed only at his peak, and never otherwise. */
  readonly playerCharacterId?: string | null | undefined;
}

export interface PlotReviewResult {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  readonly died: readonly string[];
}

/**
 * Every plot that has come to its day, plus a development in the ones that have
 * not.
 *
 * Run before `reviewLives`, so a man killed here does not also have his wages
 * paid and his term expired on the day he died.
 */
export function resolvePlots(input: PlotReviewInput): PlotReviewResult {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const died: string[] = [];
  let sequence = 0;
  const nextLocalId = (prefix: string): string => `${prefix}_${input.toDay}_${sequence++}`;

  for (const plot of input.world.covertPlots) {
    if (!isPlotOpen(plot)) continue;

    const target = world.characters.find((character) => character.id === plot.targetCharacterId);
    // A mark who is already dead, of a battle or of anything else, ends the
    // plot without resolving it: the thing it was for has happened.
    if (target === undefined || !target.alive) {
      world = closePlot(world, plot.id, "nothing", input.toDay);
      continue;
    }

    if (input.toDay < plot.resolvesAtStep) {
      const halfway = plot.openedAtStep + Math.floor((plot.resolvesAtStep - plot.openedAtStep) / 2);
      // One development, once, at the halfway mark: the thing is moving, and
      // the player reads it moving rather than only having moved.
      if (input.toDay >= halfway && !plot.stirred) {
        const stirred = stirPlot(world, plot, target, input.toDay, input.ids, nextLocalId);
        world = stirred.world;
        facts.push(...stirred.facts);
      }
      continue;
    }

    const resolved = springPlot(world, plot, target, input, nextLocalId);
    world = resolved.world;
    facts.push(...resolved.facts);
    if (resolved.died !== null) died.push(resolved.died);
  }

  return { world, facts, died };
}

/**
 * The plot moves, and may be noticed.
 *
 * Whether the mark gets wind of it is the secrecy roll, and a warned man is a
 * harder one for the rest of the plot's life -- the pressure this writes is
 * read by `plotOdds` on any *later* plot, and by `whoSeeksThePlayer`, which is
 * how a warning reaches a player who can then do something about it.
 */
function stirPlot(
  world: WorldState,
  plot: CovertPlot,
  target: Character,
  atDay: number,
  ids: IdFactory,
  nextLocalId: (prefix: string) => string,
): { world: WorldState; facts: FactProposalDraft[] } {
  const noticed = stableHash([plot.id, plot.resolvesAtStep, "wind"]) % 10_000 >= plot.secrecyBps;
  if (!noticed) {
    return {
      // Stirred, and nobody the wiser: the mark is emphatically not warned.
      world: { ...world, covertPlots: world.covertPlots.map((candidate) => (candidate.id === plot.id ? { ...candidate, stirred: true } : candidate)) },
      facts: [{
        localId: nextLocalId("plot_quiet"),
        kind: "covert_progress",
        summary: `The thing laid against ${target.name} is further along, and nobody has said a word.`,
        affectedRefs: [{ kind: "character", id: plot.sponsorCharacterId }],
        // Known to the man who ordered it, and to nobody else at all.
        visibility: "private",
        discoveryState: "private",
        knowableInDays: 0,
        significance: 20,
        knownToRefs: [{ kind: "character", id: plot.sponsorCharacterId }],
      }],
    };
  }

  const pressured = createPressure(
    { characters: world.characters, characterPressures: world.characterPressures },
    {
      id: ids.next("pressure"),
      characterId: target.id,
      kind: "threat",
      intensity: 70,
      label: "Somebody is moving against him",
      sourceEventId: null,
      atStep: atDay,
      reviewInSteps: 30,
      expiresInSteps: null,
      // Not private: a warning nobody can bring him is not a warning.
      visibility: "polity",
    },
  );

  return {
    world: {
      ...world,
      characters: [...pressured.characters],
      characterPressures: [...pressured.characterPressures],
      covertPlots: world.covertPlots.map((candidate) => (candidate.id === plot.id ? { ...candidate, stirred: true, targetWarned: true } : candidate)),
    },
    facts: [{
      localId: nextLocalId("plot_warned"),
      kind: "covert_warning",
      summary: `${target.name} has been warned that somebody means him harm, though not by whom.`,
      affectedRefs: [{ kind: "character", id: target.id }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 1,
      significance: 55,
    }],
  };
}

export interface LadderInput {
  /** The engine's own roll, 0 to 9 999. */
  readonly roll: number;
  readonly kind: CovertPlotKind;
  readonly oddsBps: number;
  readonly secrecyBps: number;
  /** A player character below the one bar at which his death is allowed. */
  readonly spared: boolean;
}

/**
 * How a plot comes out, given a roll.
 *
 * Pure, and separate from everything that touches the world, because this is
 * the part worth reading twice: it is where "most attempts fail, some leave the
 * man short of an eye" is actually written down.
 *
 * The inner three fifths of the odds is the thing done fully. The rest of them
 * is a blow that lands without finishing him -- which is where the greater part
 * of the real history sits. Past the odds it simply failed, and the only
 * question left is whether anybody traced it back, which is what secrecy was
 * bought for.
 *
 * Note that no value of `oddsBps` makes a death certain: at the ceiling of six
 * thousand, three in five of the successes are deaths and the rest are
 * maimings, and two in five of all attempts fail outright. That is deliberate.
 * A plot is never a way to remove a man; it is a way to try.
 */
export function ladderOutcome(input: LadderInput): CovertPlotOutcome {
  const fully = Math.round(input.oddsBps * 0.6);

  let outcome: CovertPlotOutcome;
  if (input.roll < fully) outcome = input.spared ? "maimed" : "killed";
  else if (input.roll < input.oddsBps) outcome = "maimed";
  else outcome = input.roll >= input.secrecyBps ? "discovered" : "nothing";

  // A plot against a thing rather than a person never hurts anybody: sabotage
  // that goes right is a burnt storehouse, not a body.
  if (input.kind === "sabotage" && (outcome === "killed" || outcome === "maimed")) return "nothing";
  return outcome;
}

/** The day it comes to a head. */
function springPlot(
  world: WorldState,
  plot: CovertPlot,
  target: Character,
  input: PlotReviewInput,
  nextLocalId: (prefix: string) => string,
): { world: WorldState; facts: FactProposalDraft[]; died: string | null } {
  // Hashed on the day it was *scheduled* for, never the day being ticked to.
  const roll = stableHash([plot.id, plot.resolvesAtStep, "spring"]) % 10_000;
  const outcome = ladderOutcome({
    roll,
    kind: plot.kind,
    oddsBps: plot.successOddsBps,
    secrecyBps: plot.secrecyBps,
    spared: input.playerCharacterId != null && target.id === input.playerCharacterId
      && !atTheirPeak(world, target, input.life, input.toDay),
  });

  const facts: FactProposalDraft[] = [];
  let next = world;
  let killed: string | null = null;

  // A spy hurts nobody. What would have been a death is what he found out.
  if (plot.kind === "espionage") {
    const spied = spyOn(next, plot, target, outcome, input, nextLocalId);
    return { world: closePlot(spied.world, plot.id, spied.outcome, input.toDay), facts: spied.facts, died: null };
  }

  if (outcome === "killed") {
    const done = killCharacter(next, target.id, `${plot.cover}`, input.toDay);
    next = done.world;
    facts.push(...done.facts);
    killed = target.id;
    facts.push({
      localId: nextLocalId("plot_done"),
      kind: "assassination",
      summary: `${target.name} is dead. ${plot.cover}`,
      affectedRefs: [{ kind: "character", id: target.id }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 95,
    });
  } else if (outcome === "maimed") {
    // Which wound, deterministically, out of the ones he is not already
    // carrying -- so a second attempt cannot take the same eye twice.
    const available = INJURIES.filter((injury) => !target.disqualifyingStatuses.includes(injuryStatusId(injury)));
    const injury = available[stableHash([plot.id, plot.resolvesAtStep, "wound"]) % Math.max(1, available.length)];
    if (injury !== undefined) {
      next = { ...next, characters: next.characters.map((character) => (character.id === target.id ? applyInjury(character, injury) : character)) };
      facts.push({
        localId: nextLocalId("plot_maimed"),
        kind: "attempt_on_a_life",
        summary: `${target.name} was attacked and lived: he is ${injury.label}. ${plot.cover}`,
        affectedRefs: [{ kind: "character", id: target.id }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 85,
      });
    }
  } else if (outcome === "discovered") {
    // The ending that starts a war inside a government: it failed, and it was
    // traced. The mark knows who, which is what `belief_set` would have had to
    // invent and what cognition will now act on.
    next = {
      ...next,
      characterBeliefs: [...next.characterBeliefs, {
        id: input.ids.next("belief"),
        holderCharacterId: target.id,
        subjectEntityId: plot.sponsorCharacterId,
        claim: `${nameOf(next, plot.sponsorCharacterId)} paid to have me killed.`,
        kind: "fact" as const,
        sourceCharacterId: null,
        sourceEventId: null,
        confidence: 85,
        visibility: "polity" as const,
        learnedAtStep: input.toDay,
        expiresAtStep: null,
        supersedesBeliefIds: [],
        status: "active" as const,
      }],
    };
    facts.push({
      localId: nextLocalId("plot_found"),
      kind: "plot_uncovered",
      summary: `An attempt on ${target.name} came to nothing and was traced to ${nameOf(next, plot.sponsorCharacterId)}.`,
      affectedRefs: [
        { kind: "character", id: target.id },
        { kind: "character", id: plot.sponsorCharacterId },
      ],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 90,
    });
    next = tracedTo(next, plot, target, input.toDay);
  } else {
    facts.push({
      localId: nextLocalId("plot_nothing"),
      kind: "covert_failure",
      summary: `Whatever was meant for ${target.name} did not reach him, and nobody ever knew it had been meant.`,
      affectedRefs: [{ kind: "character", id: plot.sponsorCharacterId }],
      visibility: "private",
      discoveryState: "private",
      knowableInDays: 0,
      significance: 25,
      knownToRefs: [{ kind: "character", id: plot.sponsorCharacterId }],
    });
  }

  return { world: closePlot(next, plot.id, outcome, input.toDay), facts, died: killed };
}

/**
 * A plot traced to the man who paid for it, and what everyone who cares now
 * thinks of him: the mark, the mark's blood, and the men of the mark's power
 * who sit in its offices. The mark learns what it is to be hunted -- or, where
 * he had thought the man a friend, to be betrayed.
 */
function tracedTo(world: WorldState, plot: CovertPlot, target: Character, atDay: number): WorldState {
  const sponsor = plot.sponsorCharacterId;
  const friend = computeOpinion(target, sponsor) >= 20;
  const grievances: Grievance[] = [
    { subjectCharacterId: target.id, targetCharacterId: sponsor, label: "He paid to have me killed.", score: -20, dimensions: { trust: -60, affection: -40, fear: 15 }, decayPerYearBps: 0 },
    ...kinOf(world, target.id).map((kin) => ({ subjectCharacterId: kin, targetCharacterId: sponsor, label: `He paid to have ${target.name} killed.`, score: -15, dimensions: { trust: -40, affection: -30 }, decayPerYearBps: 200 })),
    ...hisMasters(world, target.polityId).filter((id) => id !== sponsor).map((id) => ({ subjectCharacterId: id, targetCharacterId: sponsor, label: `The attempt on ${target.name} was traced to him.`, score: -8, dimensions: { trust: -15, reputation: -10 } })),
  ];
  return teach(remember(world, grievances, atDay, `${plot.id}:traced`), target.id, friend ? "betrayed" : "plotted_against", atDay);
}

/**
 * What a spy brings home, or how he is caught.
 *
 * A report, private to whoever set him on and to the spy: the secrets the man
 * keeps, what he means to do and wants, the true strength and place of what he
 * commands and the money he holds, and whom he trusts and hates. Each is also
 * written into the one who asked as a belief, so it is something he knows and
 * acts on rather than a line in a record.
 */
function spyOn(
  world: WorldState,
  plot: CovertPlot,
  target: Character,
  outcome: CovertPlotOutcome,
  input: PlotReviewInput,
  nextLocalId: (prefix: string) => string,
): { world: WorldState; facts: FactProposalDraft[]; outcome: CovertPlotOutcome } {
  const told = [plot.sponsorCharacterId, ...(plot.agentCharacterId === null ? [] : [plot.agentCharacterId])];
  const sponsor = nameOf(world, plot.sponsorCharacterId);
  const belief = (claim: string, kind: "fact" | "secret" = "fact") => ({
    id: input.ids.next("belief"),
    holderCharacterId: plot.sponsorCharacterId,
    subjectEntityId: target.id,
    claim: claim.slice(0, 400),
    kind,
    sourceCharacterId: plot.agentCharacterId,
    sourceEventId: null,
    confidence: 80,
    visibility: "private" as const,
    learnedAtStep: input.toDay,
    expiresAtStep: null,
    supersedesBeliefIds: [],
    status: "active" as const,
  });

  if (outcome === "discovered") {
    return {
      world: { ...world, characterBeliefs: [...world.characterBeliefs, { ...belief(`${sponsor} set a spy on me.`), holderCharacterId: target.id, subjectEntityId: plot.sponsorCharacterId, visibility: "polity" as const }] },
      facts: [{
        localId: nextLocalId("spy_caught"),
        kind: "spy_caught",
        summary: `A spy was caught in the household of ${target.name}, and he named ${sponsor} as the man who sent him.`,
        affectedRefs: [{ kind: "character", id: target.id }, { kind: "character", id: plot.sponsorCharacterId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 55,
      }],
      outcome,
    };
  }
  if (outcome !== "killed" && outcome !== "maimed") {
    return {
      world,
      facts: [{
        localId: nextLocalId("spy_nothing"),
        kind: "covert_failure",
        summary: `The man set to watch ${target.name} learned nothing worth the money.`,
        affectedRefs: [{ kind: "character", id: plot.sponsorCharacterId }],
        visibility: "private",
        discoveryState: "private",
        knowableInDays: 0,
        significance: 20,
        knownToRefs: told.map((id) => ({ kind: "character" as const, id })),
      }],
      outcome: "nothing",
    };
  }

  // A full success tells everything; a partial one, the half nearest the surface.
  const thorough = outcome === "killed";
  const secrets = world.characterBeliefs
    .filter((held) => held.holderCharacterId === target.id && held.status === "active" && (held.kind === "secret" || held.visibility === "private"))
    .slice(-4)
    .map((held) => held.claim);
  const intents = world.characterIntents
    .filter((intent) => intent.actorCharacterId === target.id && (intent.status === "proposed" || intent.status === "prepared" || intent.status === "deferred"))
    .slice(-3)
    .map((intent) => intent.rationale)
    .filter((rationale) => rationale.length > 0);
  const wants = target.ambitions.filter((ambition) => ambition.status === "active").map((ambition) => ambition.label);
  const worries = world.characterPressures.filter((pressure) => pressure.characterId === target.id && pressure.status === "active").map((pressure) => pressure.label).slice(0, 3);
  const commands = world.material.forces
    .filter((force) => force.commanderCharacterId === target.id || force.controllerCharacterId === target.id)
    .map((force) => `${force.name}, ${force.personnel.reduce((sum, category) => sum + category.fit, 0)} fit men in ${world.map.provinces.find((province) => province.id === force.locationId)?.name ?? force.locationId}`);
  const purse = world.material.accounts.find((account) => account.id === target.personalAccountId)?.balance ?? 0;
  const regard = (id: string): number => ["trust", "affection", "respect"].reduce((sum, dimension) => sum + deriveRelationDimension(target, id, dimension as Parameters<typeof deriveRelationDimension>[2]), 0);
  const relations = target.relations
    .map((relation) => ({ id: relation.subjectCharacterId, score: regard(relation.subjectCharacterId) }))
    .filter((relation) => Math.abs(relation.score) >= 20)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3)
    .map((relation) => `${relation.score > 0 ? "trusts" : "hates"} ${nameOf(world, relation.id)}`);

  const lines = [
    ...(thorough ? secrets.map((secret) => `he keeps secret that ${secret}`) : []),
    ...intents.map((intent) => `he means to ${intent}`),
    ...(wants.length === 0 ? [] : [`he wants ${wants.join("; ")}`]),
    ...(worries.length === 0 ? [] : [`he is troubled by ${worries.join("; ")}`]),
    ...(thorough ? commands.map((command) => `he commands ${command}`) : []),
    ...(thorough ? [`he has ${purse} in his own purse`] : []),
    ...relations.map((relation) => `he ${relation}`),
  ];
  const report = lines.length === 0 ? `${target.name} lives, as far as anybody can see, exactly as he appears to.` : `Of ${target.name}: ${lines.join("; ")}.`;
  return {
    world: { ...world, characterBeliefs: [...world.characterBeliefs, ...lines.slice(0, 8).map((line) => belief(`${target.name}: ${line}`, line.startsWith("he keeps secret") ? "secret" : "fact"))] },
    facts: [{
      localId: nextLocalId("spy_report"),
      kind: "spy_report",
      summary: report.slice(0, 1_000),
      affectedRefs: [{ kind: "character", id: target.id }, { kind: "character", id: plot.sponsorCharacterId }],
      visibility: "private",
      discoveryState: "private",
      knowableInDays: 0,
      significance: 40,
      knownToRefs: told.map((id) => ({ kind: "character" as const, id })),
    }],
    outcome: "learned",
  };
}

const nameOf = (world: WorldState, characterId: string): string =>
  world.characters.find((character) => character.id === characterId)?.name ?? characterId;

function closePlot(world: WorldState, plotId: string, outcome: CovertPlotOutcome, atDay: number): WorldState {
  return {
    ...world,
    covertPlots: world.covertPlots.map((plot) => (plot.id === plotId
      ? { ...plot, outcome, resolvedAtStep: atDay }
      : plot)),
  };
}
