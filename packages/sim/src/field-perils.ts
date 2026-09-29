import {
  boundedId,
  fieldChoiceOf,
  fieldOptionId,
  openFieldPerilOf,
  stableHash,
  type BattleResult,
  type Character,
  type FactProposalDraft,
  type FieldChoice,
  type FieldOutcome,
  type FieldPeril,
  type FieldPlight,
  type Force,
  type PlayerDecision,
  type WorldState,
  type WorldStoryline,
} from "@chronica/shared";
import type { MemberFate } from "./battle";
import { handOverForcesOf, killCharacter, mattersEnough } from "./mortality";

/**
 * A death or a capture that matters, told in two reports instead of one.
 *
 * The resolver decides a commander's fate the moment the fighting ends, and
 * that used to be the end of it: the player read that a battle was lost and,
 * in the same breath, that he had died in it. Now the roll decides what kind
 * of trouble he is in, not how it ends. A roll that would have killed him
 * leaves him *encircled*; one that would have taken him leaves him *cut off*.
 * The report closes on that -- for the player, as the question of what to do
 * about it -- and the next report opens on how it came out.
 *
 * Only for people whose fate is an event (`mattersEnough`): the player, a
 * magistrate, a commander, a man with a thread of his own. A legionary nobody
 * has heard of still dies in the line, the day of the battle.
 *
 * Everything is hashed on the peril's own id, so a replay goes the same way.
 */

/** What the resolver's roll meant, before it is turned into a plight. */
export interface PlightDraft {
  readonly characterId: string;
  readonly plight: FieldPlight;
  readonly ownForceId: string | null;
  readonly enemyForceId: string;
}

/** The fighting men of a force. */
const fitOf = (force: Pick<Force, "personnel">): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

function pronouns(character: Pick<Character, "gender">): { he: string; He: string; him: string; his: string } {
  return character.gender === "female"
    ? { he: "she", He: "She", him: "her", his: "her" }
    : { he: "he", He: "He", him: "him", his: "his" };
}

/** One of a few ways of saying a thing, picked by the peril itself so a replay says it the same way. */
function pick<T>(options: readonly T[], ...key: readonly (string | number)[]): T {
  return options[stableHash([...key]) % options.length]!;
}

/**
 * Takes out of a battle's result the deaths and captures that should be told
 * as a plight first, and says who is in what trouble.
 *
 * The result that comes back is the one to apply: those men are left
 * unharmed by the battle itself, because what happens to them is decided in
 * the next report, not this one.
 */
export function divertFieldFates(
  world: WorldState,
  result: BattleResult,
  members: readonly MemberFate[],
  playerCharacterId: string | null,
): { result: BattleResult; members: MemberFate[]; plights: PlightDraft[] } {
  const attackers = new Set(result.attackerForceIds);
  const enemyOf = (forceId: string): string | null => {
    const side = attackers.has(forceId);
    const opposed = result.participantIds
      .filter((id) => attackers.has(id) !== side)
      .map((id) => world.material.forces.find((force) => force.id === id))
      .filter((force): force is Force => force !== undefined)
      .sort((a, b) => fitOf(b) - fitOf(a) || a.id.localeCompare(b.id));
    return opposed[0]?.id ?? null;
  };
  const matters = (characterId: string): boolean => {
    const person = world.characters.find((character) => character.id === characterId);
    return person !== undefined && person.alive && mattersEnough(world, person, playerCharacterId);
  };

  const plights: PlightDraft[] = [];
  const commanderChanges = result.commanderChanges.map((change) => {
    if (change.outcome !== "killed" && change.outcome !== "captured") return change;
    if (!matters(change.characterId)) return change;
    const enemyForceId = enemyOf(change.forceId);
    if (enemyForceId === null) return change;
    plights.push({ characterId: change.characterId, plight: change.outcome === "killed" ? "encircled" : "cut_off", ownForceId: change.forceId, enemyForceId });
    return { ...change, outcome: "unharmed" as const };
  });
  const kept = members.map((fate) => {
    if (fate.outcome !== "killed" || !matters(fate.characterId)) return fate;
    const enemyForceId = enemyOf(fate.forceId);
    if (enemyForceId === null) return fate;
    plights.push({ characterId: fate.characterId, plight: "encircled", ownForceId: fate.forceId, enemyForceId });
    return { ...fate, outcome: "unharmed" as const };
  });
  return plights.length === 0
    ? { result, members: [...members], plights }
    : { result: { ...result, commanderChanges }, members: kept, plights };
}

/**
 * Puts each man in his plight: a thread the world follows, a status that
 * keeps him out of the Senate and off the roads, and a fact the whole world
 * hears. Written after the battle has been applied, so his army has already
 * retreated without him.
 */
export function openFieldPerils(
  world: WorldState,
  plights: readonly PlightDraft[],
  battle: { readonly battleId: string; readonly provinceId: string; readonly provinceName: string },
  atStep: number,
): { world: WorldState; facts: FactProposalDraft[] } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  for (const draft of plights) {
    const person = next.characters.find((character) => character.id === draft.characterId);
    const enemy = next.material.forces.find((force) => force.id === draft.enemyForceId);
    if (person === undefined || !person.alive || enemy === undefined) continue;
    if (openFieldPerilOf(next.fieldPerils, person.id) !== undefined) continue;
    const own = draft.ownForceId === null ? undefined : next.material.forces.find((force) => force.id === draft.ownForceId);
    const id = boundedId(battle.battleId, "field", person.id);
    const ownFit = own === undefined ? 0 : fitOf(own);
    const companions = draft.plight === "encircled"
      ? Math.max(20, Math.min(400, Math.round(ownFit * 0.03)))
      : Math.max(4, Math.min(60, Math.round(ownFit * 0.008)));
    const { he, He, him, his } = pronouns(person);
    const ownName = own?.name ?? "the army";
    const enemyCommander = next.characters.find((character) => character.id === enemy.commanderCharacterId);
    const summary = draft.plight === "encircled"
      ? pick([
        `${person.name} is surrounded. When ${ownName} gave way at ${battle.provinceName}, ${he} and some ${companions} of ${his} guard were caught on the wrong side of the rout, and ${enemy.name} has closed a ring around them on a low rise. Nobody leaves it without a fight.`,
        `${person.name} did not get out. ${ownName} fell back from ${battle.provinceName} in the dusk, and ${he} was left with ${companions} men and the standards, ${enemy.name} on every side of them and lighting fires where they could see them.`,
        `At ${battle.provinceName} the line broke around ${person.name} rather than behind ${him}: ${he} is holding a knot of ${companions} men in the middle of ${enemy.name}${enemyCommander === undefined ? "" : `, and ${enemyCommander.name} knows exactly who is in it`}.`,
      ], id, "encircled")
      : pick([
        `${person.name} has been cut off from ${ownName} in the rout at ${battle.provinceName}: ${he} and ${companions} riders are separated from the army, and ${enemy.name}'s men are working the ground to find them.`,
        `In the confusion at ${battle.provinceName} ${person.name} lost ${ownName}. ${He} is somewhere behind ${enemy.name}'s lines with ${companions} men, and the enemy is looking for ${him} by name.`,
      ], id, "cut_off");

    const storyline: WorldStoryline = {
      id: boundedId(id, "thread"),
      title: `${person.name} ${draft.plight === "encircled" ? "surrounded" : "cut off"} at ${battle.provinceName}`.slice(0, 160),
      participantIds: [person.id, ...(enemyCommander === undefined ? [] : [enemyCommander.id])],
      provinceId: battle.provinceId,
      phase: "crisis",
      stakes: `Whether ${person.name} comes out of ${battle.provinceName} free, a prisoner of ${enemy.name}, or not at all.`.slice(0, 320),
      history: [summary.slice(0, 300)],
      nextDevelopment: "Whether they break out, hold for relief, or give up their swords.",
      visibility: "public",
      origin: "world",
      openedByRef: null,
      openedAtStep: atStep,
      updatedAtStep: atStep,
      closedAtStep: null,
      causalFactIds: [],
      seedKey: `field:${person.id}`.slice(0, 80),
    };
    const peril: FieldPeril = {
      id,
      characterId: person.id,
      plight: draft.plight,
      battleId: battle.battleId,
      provinceId: battle.provinceId,
      ownForceId: own?.id ?? null,
      enemyForceId: enemy.id,
      enemyPolityId: enemy.polityId,
      companions,
      storylineId: storyline.id,
      openedAtStep: atStep,
      choice: null,
      resolvedAtStep: null,
      outcome: null,
    };
    next = {
      ...next,
      fieldPerils: [...next.fieldPerils, peril],
      storylines: [...next.storylines, storyline],
      characters: next.characters.map((character) => (character.id === person.id
        ? {
          ...character,
          locationProvinceId: battle.provinceId,
          disqualifyingStatuses: character.disqualifyingStatuses.includes(draft.plight)
            ? character.disqualifyingStatuses
            : [...character.disqualifyingStatuses, draft.plight].slice(0, 8),
        }
        : character)),
    };
    facts.push({
      localId: `field_${id}`.slice(0, 60),
      kind: draft.plight === "encircled" ? "commander_encircled" : "commander_cut_off",
      summary: summary.slice(0, 600),
      affectedRefs: [
        { kind: "character", id: person.id },
        { kind: "force", id: enemy.id },
        ...(own === undefined ? [] : [{ kind: "force" as const, id: own.id }]),
        { kind: "province", id: battle.provinceId },
      ],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      // It has to reach the report it happened in, whatever else the battle did.
      significance: 94,
    });
  }
  return { world: next, facts };
}

// ── The odds ─────────────────────────────────────────────────────────────

/** Somebody of his own side near enough to come for him. */
function reliefFor(world: WorldState, peril: FieldPeril, person: Character): Force | undefined {
  const near = new Set<string>([peril.provinceId]);
  for (const edge of world.map.edges) {
    if (edge.from === peril.provinceId) near.add(edge.to);
    if (edge.to === peril.provinceId) near.add(edge.from);
  }
  return world.material.forces
    .filter((force) => force.polityId === person.polityId && force.id !== peril.enemyForceId && force.outlaw !== true && near.has(force.locationId) && fitOf(force) >= 500)
    .sort((a, b) => fitOf(b) - fitOf(a) || a.id.localeCompare(b.id))[0];
}

/** Per mille: how each choice tends to end, for this man in this plight. */
export function fieldOdds(world: WorldState, peril: FieldPeril, choice: FieldChoice): Record<FieldOutcome, number> {
  const person = world.characters.find((character) => character.id === peril.characterId);
  const odds: Record<FieldOutcome, number> = { escaped: 0, escaped_wounded: 0, relieved: 0, captured: 0, killed: 0 };
  if (person === undefined) return { ...odds, killed: 1_000 };
  // A hard fighter on a good horse gets out where a scholar does not.
  const prowess = (person.skills.martial + person.skills.body) / 2;
  const relief = reliefFor(world, peril, person);
  const enemyCommander = world.characters.find((character) => character.id === world.material.forces.find((force) => force.id === peril.enemyForceId)?.commanderCharacterId);
  const cruel = (enemyCommander?.mind.temperament.cruelty ?? 40) >= 60;
  const encircled = peril.plight === "encircled";
  const set = (escaped: number, wounded: number, relieved: number, captured: number): Record<FieldOutcome, number> => {
    const total = escaped + wounded + relieved + captured;
    return { escaped, escaped_wounded: wounded, relieved, captured, killed: Math.max(0, 1_000 - total) };
  };
  switch (choice) {
    case "break_out": {
      const out = Math.min(750, (encircled ? 200 : 350) + Math.round(prowess * 4));
      const rest = 1_000 - out;
      return set(Math.round(out * 0.55), Math.round(out * 0.45), 0, Math.round(rest * (encircled ? 0.25 : 0.7)));
    }
    case "hold":
      return relief !== undefined
        ? set(0, 60, 640, encircled ? 120 : 220)
        : set(0, 60, 0, encircled ? 420 : 720);
    case "yield":
      return set(0, 0, 0, encircled && cruel ? 700 : 920);
    case "stand":
      return set(0, encircled ? 140 : 220, relief !== undefined ? 80 : 0, 60);
  }
}

/** A man's own choice, when it is not the player's to make: read off his temperament. */
function chosenBy(world: WorldState, peril: FieldPeril, person: Character): FieldChoice {
  const { boldness, caution, discipline } = person.mind.temperament;
  if (reliefFor(world, peril, person) !== undefined && discipline >= 50) return "hold";
  if (boldness >= 65) return person.mind.drives.duty >= 75 && peril.plight === "encircled" ? "stand" : "break_out";
  if (caution >= 65) return peril.plight === "cut_off" ? "yield" : "hold";
  return "break_out";
}

function roll(odds: Record<FieldOutcome, number>, key: string): FieldOutcome {
  let at = stableHash([key, "field-roll"]) % 1_000;
  for (const outcome of ["escaped", "escaped_wounded", "relieved", "captured", "killed"] as const) {
    if (at < odds[outcome]) return outcome;
    at -= odds[outcome];
  }
  return "killed";
}

// ── The decision ─────────────────────────────────────────────────────────

function chanceInWords(perMille: number): string {
  if (perMille < 150) return "a slim chance";
  if (perMille < 400) return "a fighting chance";
  if (perMille < 650) return "better than even";
  return "a good chance";
}

/** What the player is asked, the moment the report closes on him surrounded. */
export function fieldDecision(world: WorldState, peril: FieldPeril): PlayerDecision {
  const person = world.characters.find((character) => character.id === peril.characterId);
  const enemy = world.material.forces.find((force) => force.id === peril.enemyForceId);
  const province = world.map.provinces.find((candidate) => candidate.id === peril.provinceId)?.name ?? peril.provinceId;
  const relief = person === undefined ? undefined : reliefFor(world, peril, person);
  const free = (choice: FieldChoice): number => {
    const odds = fieldOdds(world, peril, choice);
    return odds.escaped + odds.escaped_wounded + odds.relieved;
  };
  const alive = (choice: FieldChoice): number => 1_000 - fieldOdds(world, peril, choice).killed;
  const enemyName = enemy?.name ?? "the enemy";
  return {
    prompt: [
      peril.plight === "encircled"
        ? `You are surrounded at ${province}, with ${peril.companions} men and ${enemyName} on every side.`
        : `You are cut off at ${province} with ${peril.companions} riders, and ${enemyName} is hunting for you.`,
      relief === undefined ? "No army of yours is near enough to come for you." : `${relief.name} is close enough to come for you, if you can hold until it does.`,
      "What do you do?",
    ].join(" ").slice(0, 1_200),
    options: [
      { id: fieldOptionId("break_out"), label: "Break out", summary: `Gather what horses are left and ride at the thinnest part of their line. ${chanceInWords(free("break_out"))[0]!.toUpperCase()}${chanceInWords(free("break_out")).slice(1)} of getting clear.` },
      { id: fieldOptionId("hold"), label: relief === undefined ? "Hold the ground" : "Hold for relief", summary: relief === undefined ? `Lock shields and make them pay for every step. Nobody is coming; ${chanceInWords(alive("hold"))} of living through it, most likely as a prisoner.` : `Lock shields and wait for ${relief.name}. ${chanceInWords(free("hold"))[0]!.toUpperCase()}${chanceInWords(free("hold")).slice(1)} they reach you in time.` },
      { id: fieldOptionId("yield"), label: "Yield your sword", summary: `Send a man down with an olive branch and give yourself up to ${enemyName}. ${chanceInWords(alive("yield"))[0]!.toUpperCase()}${chanceInWords(alive("yield")).slice(1)} they honour it; a prisoner can be ransomed.` },
      { id: fieldOptionId("stand"), label: "Stand and be remembered", summary: "Refuse terms and fight where you are. Few come out of it, and those who do are spoken of for a generation." },
    ],
  };
}

// ── How it ends ──────────────────────────────────────────────────────────

export interface FieldResolution {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  /** What was said, tied to the fact of how it ended. */
  readonly utterances: readonly { readonly characterId: string; readonly speaker: string; readonly line: string; readonly occasion: string; readonly factLocalId: string }[];
  readonly died: readonly string[];
}

/**
 * Every plight standing when a report begins, ended.
 *
 * Called once, at the start of a burst, so a man surrounded in one report
 * always learns his fate in the next. The player's own is ended by the
 * answer he gave (`answeredOptionId`); everybody else's by his temperament.
 */
export function resolveFieldPerils(input: {
  readonly world: WorldState;
  readonly atStep: number;
  readonly playerCharacterId: string | null;
  readonly answeredOptionId?: string | null | undefined;
}): FieldResolution {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const utterances: FieldResolution["utterances"][number][] = [];
  const died: string[] = [];
  const answered = fieldChoiceOf(input.answeredOptionId);

  for (const standing of input.world.fieldPerils.filter((peril) => peril.resolvedAtStep === null)) {
    const person = world.characters.find((character) => character.id === standing.characterId);
    const close = (outcome: FieldOutcome | null, choice: FieldChoice | null): void => {
      world = {
        ...world,
        fieldPerils: world.fieldPerils.map((peril) => (peril.id === standing.id ? { ...peril, resolvedAtStep: input.atStep, outcome, choice } : peril)),
        storylines: world.storylines.map((storyline) => (storyline.id === standing.storylineId
          ? { ...storyline, phase: "closed" as const, closedAtStep: input.atStep, updatedAtStep: input.atStep }
          : storyline)),
      };
    };
    if (person === undefined || !person.alive) {
      close(null, null);
      continue;
    }
    const choice = person.id === input.playerCharacterId
      ? answered ?? standing.choice ?? chosenBy(world, standing, person)
      : chosenBy(world, standing, person);
    const outcome = roll(fieldOdds(world, standing, choice), standing.id);
    const told = tellEnding(world, standing, person, choice, outcome);
    const factLocalId = `field_end_${standing.id}`.slice(0, 60);
    utterances.push({ characterId: person.id, speaker: person.name, line: told.said, occasion: told.occasion, factLocalId });

    // Out of the plight, whatever it came to.
    world = {
      ...world,
      characters: world.characters.map((character) => (character.id === person.id
        ? { ...character, disqualifyingStatuses: character.disqualifyingStatuses.filter((status) => status !== "encircled" && status !== "cut_off") }
        : character)),
    };
    close(outcome, choice);

    if (outcome === "killed") {
      const killed = killCharacter(world, person.id, told.summary, input.atStep);
      world = killed.world;
      // The death fact carries the telling; its own id is what the words are tied to.
      facts.push(...killed.facts.map((fact, index) => (index === 0 ? { ...fact, localId: factLocalId, kind: "killed_in_the_field", significance: 96 } : fact)));
      died.push(person.id);
      continue;
    }

    world = afterEnding(world, standing, person, outcome, told.reliefId, choice);
    facts.push({
      localId: factLocalId,
      kind: outcome === "captured" ? "commander_captured" : "commander_escaped",
      summary: told.summary.slice(0, 600),
      affectedRefs: [
        { kind: "character", id: person.id },
        { kind: "force", id: standing.enemyForceId },
        { kind: "province", id: standing.provinceId },
        { kind: "polity", id: standing.enemyPolityId },
      ],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: outcome === "captured" ? 92 : 85,
    });
  }
  return { world, facts, utterances, died };
}

/** What becomes of a man who came out of it alive. */
function afterEnding(world: WorldState, peril: FieldPeril, person: Character, outcome: FieldOutcome, reliefId: string | null, choice: FieldChoice): WorldState {
  const enemy = world.material.forces.find((force) => force.id === peril.enemyForceId);
  const own = peril.ownForceId === null ? undefined : world.material.forces.find((force) => force.id === peril.ownForceId);
  if (outcome === "captured") {
    // Taken to the enemy's camp, and out of command of anything.
    const held = handOverForcesOf(world, person.id);
    return {
      ...held,
      characters: held.characters.map((character) => (character.id === person.id
        ? {
          ...character,
          locationProvinceId: enemy?.locationId ?? character.locationProvinceId,
          healthBps: Math.max(500, character.healthBps - 1_000),
          disqualifyingStatuses: character.disqualifyingStatuses.includes("captured")
            ? character.disqualifyingStatuses
            : [...character.disqualifyingStatuses, "captured"].slice(0, 8),
        }
        : character)),
    };
  }
  const rejoins = reliefId === null ? own : world.material.forces.find((force) => force.id === reliefId) ?? own;
  const wounded = outcome === "escaped_wounded";
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === person.id
      ? {
        ...character,
        locationProvinceId: rejoins?.locationId ?? character.locationProvinceId,
        healthBps: wounded ? Math.max(500, character.healthBps - 3_000) : character.healthBps,
        // A man who stood and lived is spoken of for a generation.
        prestigeBps: Math.min(10_000, character.prestigeBps + (choice === "stand" ? 800 : 300)),
        disqualifyingStatuses: wounded && !character.disqualifyingStatuses.includes("wounded")
          ? [...character.disqualifyingStatuses, "wounded"].slice(0, 8)
          : character.disqualifyingStatuses,
      }
      : character)),
  };
}

/** How the fighting men of an army are armed, as far as their names say. */
function armedWith(force: Force | undefined): { horse: boolean; bows: boolean; slings: boolean } {
  const names = (force?.personnel ?? []).map((group) => `${group.categoryId} ${group.label}`.toLowerCase()).join(" ");
  return {
    horse: /cavalry|horse|rider|numidian/.test(names),
    bows: /archer|bow|cretan|scythian/.test(names),
    slings: /sling|balearic|rhodian/.test(names),
  };
}

/**
 * How it ended, told the way a dispatch from the field would tell it -- who,
 * where, the moment it turned, and the one detail men repeated afterwards --
 * and what he said as it did.
 */
function tellEnding(world: WorldState, peril: FieldPeril, person: Character, choice: FieldChoice, outcome: FieldOutcome): { summary: string; said: string; occasion: string; reliefId: string | null } {
  const { he, He, him, his } = pronouns(person);
  const enemy = world.material.forces.find((force) => force.id === peril.enemyForceId);
  const enemyName = enemy?.name ?? "the enemy";
  const enemyCommander = world.characters.find((character) => character.id === enemy?.commanderCharacterId);
  const captor = world.map.polities.find((polity) => polity.id === peril.enemyPolityId)?.name ?? enemyName;
  const province = world.map.provinces.find((candidate) => candidate.id === peril.provinceId)?.name ?? peril.provinceId;
  const relief = reliefFor(world, peril, person);
  const n = peril.companions;
  const key = peril.id;
  const arms = armedWith(enemy);

  const deathBlow = pick([
    ...(arms.bows || !arms.slings ? [
      `an arrow took ${him} under the arm, where the cuirass is laced; ${he} kept ${his} seat for a dozen strides and then went down among the horses`,
      `an arrow came out of the dusk and struck ${him} in the throat above the rim of ${his} shield, and ${he} was dead before ${his} men could lift ${him}`,
    ] : []),
    ...(arms.slings ? [`a sling-stone caught ${him} on the temple and ${he} fell without a word, ${his} helmet rolling away down the slope`] : []),
    `a javelin from the second rank went through ${his} thigh and into ${his} horse, and when the horse fell they were on ${him} before ${he} could rise`,
    ...(arms.horse ? [`a rider came at ${him} from ${his} shield side and ran ${him} through below the ribs, and ${he} was dragged a long way before the horse was stopped`] : []),
  ], key, "blow");

  const body = (enemyCommander?.mind.temperament.cruelty ?? 40) >= 60
    ? `${enemyCommander?.name ?? "The enemy"} had the body stripped and the head carried through the camp on a spear.`
    : `${enemyCommander?.name ?? "The enemy"} had the body washed and sent back to ${his} people under a truce, with ${his} ring still on ${his} hand.`;

  const words: Record<FieldChoice, readonly string[]> = {
    break_out: [
      "Close up on me. We leave through them, or not at all.",
      "They made the ring long, so they made it thin. Find where it is thinnest.",
      "Any man who reaches the river owes me nothing more. Ride.",
    ],
    hold: [
      "Lock the shields. Let them climb to us and pay for every step.",
      "Hold until the light goes. The army knows where we are.",
      "Nobody sits down. The first man to sit, the rest will follow.",
    ],
    yield: [
      `Tell ${enemyCommander?.name ?? "your general"} he has taken ${person.name}. Let him decide what that is worth.`,
      "I will give my sword to your commander, not to you.",
      "These men did all I asked of them. Take me, and let them walk.",
    ],
    stand: [
      "Let them count us afterwards. It will take them a while.",
      "I was sent to hold this ground. I am still holding it.",
      "Nobody asks for terms. We are going to be remembered, and I would rather it were for this.",
    ],
  };
  const said = pick(words[choice], key, "said");
  const occasion = {
    break_out: `to ${his} guard at ${province}, before the charge`,
    hold: `to the men around ${him} on the rise at ${province}`,
    yield: `to ${enemyName}'s officers at ${province}`,
    stand: `to the last of ${his} men at ${province}`,
  }[choice].slice(0, 120);

  const began: Record<FieldChoice, string> = {
    break_out: `${person.name} gathered the ${n} men still with ${him}, put the fittest on what horses were left, and rode at the thinnest part of ${enemyName}'s line`,
    hold: `${person.name} locked ${his} ${n} men behind their shields on the rise at ${province} and waited`,
    yield: `${person.name} sent a man down with an olive branch to ask for terms`,
    stand: `${person.name} refused to ask for terms, and ${his} ${n} men would not leave ${him}`,
  };

  let summary: string;
  switch (outcome) {
    case "killed":
      summary = choice === "break_out"
        ? `${began.break_out}. They were almost through -- the leading riders had cleared the last of the enemy -- when ${deathBlow}. ${body}`
        : choice === "hold"
          ? `${began.hold} through the night for a relief that did not come. At first light ${enemyName} came up the slope for the last time, and ${deathBlow}. ${body}`
          : choice === "yield"
            ? `${began.yield}, and came down after it to give up ${his} sword. The men of ${enemyName}, who had lost friends on that slope, did not wait for their officers: ${he} was cut down with ${his} hand still on the hilt. ${body}`
            : `${began.stand}. They held three rushes, and in the fourth ${deathBlow}. ${body}`;
      break;
    case "captured":
      summary = choice === "yield"
        ? `${began.yield}. ${enemyCommander?.name ?? "The enemy"} granted them, and ${person.name} gave up ${his} sword in front of both lines. ${He} is a prisoner of ${captor}, and what ${he} is worth to them is now a question for ${his} own people.`
        : choice === "break_out"
          ? `${began.break_out}. The charge broke on a second line nobody had seen in the dark; ${his} horse was killed under ${him} and ${he} was pulled out from beneath it alive. ${He} is a prisoner of ${captor}.`
          : `${began[choice]}, until there were too few left to hold a line. ${person.name} was taken with the last of them, ${his} shield split and ${his} sword arm bleeding. ${He} is a prisoner of ${captor}.`;
      break;
    case "relieved":
      summary = `${began[choice]}. Near evening the standards of ${relief?.name ?? "the army"} came over the hill, and ${enemyName} drew off rather than be caught between them. ${person.name} came down from the rise on foot, with ${his} men around ${him}.`;
      break;
    case "escaped_wounded":
      summary = `${began[choice]}. ${He} got through, but not whole: ${pick([`a spear opened ${his} side`, `an arrow was left in ${his} shoulder`, `a sword laid ${his} forearm open to the bone`], key, "wound")}, and ${he} reached ${his} own lines slumped over the horse's neck, with fewer than half the men who set out.`;
      break;
    case "escaped":
      summary = choice === "stand"
        ? `${began.stand}. They threw back every rush, and at dusk ${enemyName} drew off and left them the hill. ${person.name} walked out of it the next morning, and the story was all over the army before ${he} reached it.`
        : `${began[choice]}. The ring gave where ${he} struck it, and ${he} came through with most of ${his} men and rejoined the army before the enemy could close it again.`;
      break;
  }
  return { summary: summary.slice(0, 600), said, occasion, reliefId: outcome === "relieved" ? relief?.id ?? null : null };
}

/** The standing plight of the player, if the report should end on it. */
export function playerPlight(world: WorldState, playerCharacterId: string | null): FieldPeril | undefined {
  return openFieldPerilOf(world.fieldPerils, playerCharacterId);
}
