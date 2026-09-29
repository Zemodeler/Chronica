import {
  LOOSE_COHESION_BPS,
  deriveRelationDimension,
  openStorylines,
  stableChoice,
  nemesisOf,
  type Character,
  type Nemesis,
  type NemesisArena,
  type NemesisMethod,
  type NemesisStance,
  type WorldState,
} from "@chronica/shared";
import { answersAnOrder } from "./delegation";

/**
 * Choosing the ruler's antagonist, and reading where he stands this season.
 *
 * The attention router is fair, and fairness is the problem. It wakes whoever
 * the week's facts happen to touch, so a man who has been working against the
 * ruler for two years is heard only when he scores high enough that round --
 * and a reign comes back as a sequence of unrelated difficulties rather than
 * as a struggle with somebody in particular. This is the one exception: a
 * single named person, guaranteed a hearing, with a thread of his own.
 *
 * Code owns who, when, and whether their interests currently run with the
 * ruler's. Everything the man actually does is his own, answered in cognition
 * like anybody else's business -- the same division as `narrator.ts`, for the
 * same reason. Nothing here tells the model he is The Nemesis: it tells it
 * what he holds, what he is working toward, and who he is working against,
 * which is all a person would know about themselves.
 */

/** Days between asking whether somebody has become the ruler's problem. */
const REVIEW_EVERY_DAYS = 120;

/** Below this, nobody in the world is antagonist enough to be worth the slot. */
const MINIMUM_SCORE = 5;

export interface NemesisInput {
  readonly world: WorldState;
  readonly gameId: string;
  readonly playerCharacterId: string | null;
  readonly ownPolityId: string | null;
}

/** A candidate, and what makes him one. */
interface Candidate {
  readonly character: Character;
  readonly score: number;
  readonly arena: NemesisArena;
  readonly reason: string;
}

/**
 * Where this man's quarrel would be fought, from what he actually holds.
 *
 * Never rolled. A man with an army is a military problem, a man with a seat is
 * a political one, and a governor three weeks away in a country that barely
 * coheres is a separatist one -- because those are the things he could do,
 * not because the dice said so.
 */
function arenaFor(character: Character, world: WorldState, player: Character | undefined, ownPolityId: string | null): NemesisArena {
  if (character.polityId !== ownPolityId) return "foreign";

  const sameHouse = player !== undefined && character.dynastyId !== null && character.dynastyId === player.dynastyId;
  if (sameHouse) return "dynastic";

  const province = world.map.provinces.find((candidate) => candidate.id === character.locationProvinceId);
  const polity = world.map.polities.find((candidate) => candidate.id === character.polityId);
  const farAndLoose =
    province !== undefined
    && province.controllerPolityId === ownPolityId
    && polity !== undefined
    && polity.cohesionBps < LOOSE_COHESION_BPS;
  if (farAndLoose) return "separatist";

  const commands = world.material.forces.some((force) => force.commanderCharacterId === character.id);
  if (commands) return "military";
  return "political";
}

/** What the arena means he is trying to do, in words the thread can carry. */
export function arenaStakes(arena: NemesisArena, rival: string, ruler: string): string {
  switch (arena) {
    case "political":
      return `${rival} means to have what ${ruler} holds, and to take it by the constitution rather than against it.`;
    case "military":
      return `${rival} commands men, and what he does with them is no longer certain to be what ${ruler} wants done.`;
    case "dynastic":
      return `${rival} is of ${ruler}'s own house, and believes the succession should have run through him.`;
    case "separatist":
      return `${rival} governs ground far enough from the centre to be held against it, and has begun to wonder whether it should be.`;
    case "foreign":
      return `${rival} has made this war ${ruler}'s in particular, and means to be the one who ends him.`;
  }
}

/**
 * How much of a problem this man could be, and how much he wants to be one.
 *
 * Capability and grievance both, because either alone is nothing: a bitter man
 * with no office and no men is a complainer, and a powerful man with no reason
 * to move is a colleague.
 */
function scoreOf(character: Character, world: WorldState, player: Character | undefined, ownPolityId: string | null): Candidate | null {
  const reasons: string[] = [];
  let score = 0;

  // ── What he could do about it ─────────────────────────────────────────
  if (character.officeId !== null) { score += 3; reasons.push("holds an office"); }
  const commanded = world.material.forces.filter((force) => force.commanderCharacterId === character.id);
  if (commanded.length > 0) {
    const men = commanded.reduce((sum, force) => sum + force.personnel.reduce((count, category) => count + category.fit, 0), 0);
    score += men >= 5_000 ? 4 : 2;
    reasons.push(`commands ${men} men`);
  }
  const purse = world.material.accounts.find((account) => account.id === character.personalAccountId);
  if (purse !== undefined && purse.balance >= 10_000) { score += 1; reasons.push("has money of his own"); }

  // ── What he has against the ruler ─────────────────────────────────────
  if (player !== undefined) {
    const trust = deriveRelationDimension(character, player.id, "trust");
    const respect = deriveRelationDimension(character, player.id, "respect");
    const fear = deriveRelationDimension(character, player.id, "fear");
    if (trust <= -30) { score += 3; reasons.push("does not trust him"); }
    if (respect <= -30) { score += 2; reasons.push("does not respect him"); }
    // Fear cuts both ways and is deliberately worth less than contempt: a man
    // who is frightened of the ruler is more careful, not less dangerous.
    if (fear >= 50) { score += 1; reasons.push("is afraid of him"); }
    if (character.dynastyId !== null && character.dynastyId === player.dynastyId) { score += 2; reasons.push("is of his house"); }
  }

  const ambitions = character.ambitions.filter((ambition) => ambition.status === "active");
  if (ambitions.length > 0) { score += 1; reasons.push(`wants ${ambitions[0]!.label}`); }
  if (character.mind.drives.status >= 65) { score += 2; reasons.push("is driven by standing"); }
  if (character.mind.riskTolerance >= 60) { score += 1; reasons.push("will take a risk"); }
  // Deliberately no bonus for dishonesty. It used to be worth a point, which
  // quietly made deceit a qualification for the job and filled the role with
  // plotters: the honest man who thinks the office is being misused is every
  // bit as much somebody's antagonist, and a better one. Temperament decides
  // how he fights (`nemesisMethod`), never whether he is chosen.
  if (character.mind.drives.duty >= 65) { score += 2; reasons.push("holds that the office is being misused"); }

  // Already caught up in something with the ruler: the world has been building
  // this quarrel without anybody calling it one.
  const shared = openStorylines(world.storylines).filter(
    (storyline) => player !== undefined && storyline.participantIds.includes(character.id) && storyline.participantIds.includes(player.id),
  );
  if (shared.length > 0) { score += 3; reasons.push("is already in a thread with him"); }

  if (score < MINIMUM_SCORE) return null;
  return {
    character,
    score,
    arena: arenaFor(character, world, player, ownPolityId),
    reason: reasons.join(", "),
  };
}

/**
 * Whether a nemesis is due, and who.
 *
 * Null most of the time: one is already live, the review is not due, or nobody
 * in the world has both the means and the reason. Deterministic on the game and
 * the day, like every other choice the engine makes for itself.
 */
export function chooseNemesis(input: NemesisInput): { characterId: string; arena: NemesisArena; reason: string } | null {
  const { world, playerCharacterId } = input;
  if (playerCharacterId === null) return null;
  if (nemesisOf(world.nemeses, playerCharacterId) !== undefined) return null;

  // A ruler who has just been rid of one is left alone for a while. Without
  // this, the day a nemesis dies the next is chosen before the body is cold.
  const lastRetired = world.nemeses
    .filter((entry) => entry.targetCharacterId === playerCharacterId && entry.retiredAtStep !== null)
    .reduce((latest, entry) => Math.max(latest, entry.retiredAtStep ?? 0), 0);
  const since = world.instant.day - lastRetired;
  if (world.nemeses.length > 0 && since < REVIEW_EVERY_DAYS) return null;

  const player = world.characters.find((character) => character.id === playerCharacterId);
  const candidates = world.characters
    .filter((character) => character.alive && character.id !== playerCharacterId)
    .map((character) => scoreOf(character, world, player, input.ownPolityId))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((a, b) => b.score - a.score || a.character.id.localeCompare(b.character.id));

  if (candidates.length === 0) return null;
  // Among the strongest, one of them rather than always the same one: the
  // ordering is deterministic and would otherwise make the choice inevitable.
  const top = candidates.filter((candidate) => candidate.score === candidates[0]!.score);
  const chosen = top[stableChoice([input.gameId, "nemesis", String(world.instant.day)], top.length)]!;
  return { characterId: chosen.character.id, arena: chosen.arena, reason: chosen.reason };
}

/**
 * How this man fights, read off the man.
 *
 * Honesty is the hinge, because it is the one temperament that decides whether
 * a thing is done in front of you or behind you. Discipline and risk move the
 * middle: a patient, careful man who is not especially scrupulous will still
 * wait for the quiet opening rather than force a public quarrel, and a bold
 * one will force it.
 */
export function nemesisMethod(character: Character): NemesisMethod {
  const { honesty, discipline } = character.mind.temperament;
  if (honesty >= 60) return "open";
  if (honesty <= 35) return "covert";
  // The middle. A careful, patient man of no strong scruple finds the quiet
  // way without needing to prefer it; a bold one has no patience for it.
  if (discipline >= 60 && character.mind.riskTolerance <= 45) return "covert";
  return "pragmatic";
}

/**
 * Everything this man will and will not do about it, channel by channel.
 *
 * Written as instructions about his conduct rather than as characterisation.
 * Every portrait already prints "Nature: bold, cruel" and every model already
 * reads it and then has the man do the generically sensible thing anyway --
 * description does not constrain. A temperament only reaches the world when it
 * is spelt out as what he reaches for and what he refuses, against the actual
 * operations he would use.
 *
 * Only the antagonist gets this. It is several hundred tokens, cognition
 * carries up to ten people a round, and he is the one the whole system exists
 * to give more room to.
 */
export function conductInWords(character: Character, ruler: string): string {
  const lines: string[] = [];
  const { boldness, caution, sociability, discipline } = character.mind.temperament;
  const { status, family, duty, revenge, security } = character.mind.drives;
  const risk = character.mind.riskTolerance;

  // ── The spine: whether a thing is done in front of him or behind him ──
  switch (nemesisMethod(character)) {
    case "open":
      lines.push(
        `How they go about it: in the open, and they would think less of themselves for doing otherwise. They say what they intend, to ${ruler}'s face where the occasion allows it, and oppose through what a man may lawfully use -- a question put to a council with "political_procedure_open", weight gathered with "political_support_set", a speech, a resignation. Their acts are "public" or "polity" facts and they do not mind who knows.`,
        `They will not conspire and they will not pretend: no secret arrangement, no "belief_set" planted to deceive, no appearing to comply while doing otherwise. If they cannot beat ${ruler} in the open they lose in the open, and that is a real outcome for them.`,
      );
      break;
    case "covert":
      lines.push(
        `How they go about it: quietly, and never where it can be traced. In front of ${ruler} they are agreeable. What they actually do is a "private" fact naming in "knownToRefs" only themselves and whoever was there.`,
        `The instruments are theirs: "belief_set" on anyone worth deceiving, agents sent to find things out, money moved where it does the most good. They do not force a confrontation they might lose; they arrange for ${ruler} to lose one.`,
      );
      break;
    case "pragmatic":
      lines.push(
        `How they go about it: openly where open will serve -- a council, a vote, a refusal given straight -- because it costs less and keeps their name clean. But they are not principled about it: where a quiet arrangement is cheap and could not be traced back, they take it, and do not agonise afterwards.`,
      );
      break;
  }

  // ── Timing ────────────────────────────────────────────────────────────
  if (discipline >= 65) lines.push("They are patient. This is a campaign of years, and a step that gains a little and risks nothing is a good step.");
  if (boldness >= 65 || risk >= 70) lines.push("They will not wait for certainty: where there is an opening now they take it, and mend what it breaks afterwards.");
  else if (caution >= 65 || risk <= 30) lines.push("They move only when they can see how it ends. An opening that might be a trap is left alone.");

  // What he reaches for, and what he will not do, are in every portrait now
  // (`describeMind`), so they are deliberately not repeated here. What stays
  // is what is only true of the man who is somebody's antagonist: how he
  // fights, how patient he is, what is driving him at somebody in particular.

  // ── What moves them ───────────────────────────────────────────────────
  if (revenge >= 65) lines.push(`They do not let a slight go. Anything ${ruler} has done to them personally is still owed, and being owed is itself a reason to act.`);
  if (family >= 65) lines.push("Their own house comes before the quarrel. An advantage that cost their kin something is not an advantage.");
  if (status >= 65) lines.push("It is standing they are after, not comfort. They would rather be feared and second than safe and nobody.");
  if (security >= 65 && risk <= 40) lines.push("Their own safety is the first consideration. They will give up a real chance rather than be exposed by it.");

  // ── How they answer an instruction ────────────────────────────────────
  //
  // The one place where two antagonists most visibly differ: the same order,
  // the same man's authority behind it, three different answers. Shared with
  // every other character who has one outstanding, so the antagonist's rule
  // and everybody else's cannot drift apart.
  const answers = answersAnOrder(character);
  if (answers !== null) lines.push(answers);

  // Almost every answer leaves `utterance` null, and it should. But a man of
  // this temperament is the one who does say something, and saying so here is
  // what makes him quotable rather than merely present.
  if (sociability >= 60 && boldness >= 60) {
    lines.push("When this matter turns on something, they are the one who says so out loud. Give them the line in \"utterance\".");
  }

  if (character.mind.taboos.length > 0 || duty >= 65) {
    lines.push("What is listed above under \"Will not\" is not negotiable for them, and neither is their own standing with the people who matter to them. Winning by a means they despise is losing.");
  }

  return lines.join(" ");
}

/**
 * Where the antagonist stands *this season*, which is not a fact about him.
 *
 * A rival who wants the ruler's office still wants the country to outlive the
 * war it is being invaded in. An enemy who can never be on your side is a
 * villain, and a villain is a duller thing to play against than a man whose
 * interests sometimes run with yours and who will remember that they did.
 *
 * "converged" is not peace. He is still working toward the same end; he has
 * simply found that this season it is served by standing with the ruler.
 */
export function nemesisStance(world: WorldState, nemesis: Nemesis, ownPolityId: string | null): NemesisStance {
  const rival = world.characters.find((character) => character.id === nemesis.characterId);
  if (rival === undefined || !rival.alive) return "dormant";
  // A man who has lost everything he could fight with is not fighting.
  const commands = world.material.forces.some((force) => force.commanderCharacterId === rival.id);
  if (rival.officeId === null && !commands && nemesis.arena !== "dynastic") return "dormant";

  if (nemesis.arena === "foreign") return "opposed";

  // The country is being fought over by somebody else. An internal quarrel is
  // a luxury, and a man who presses one while the enemy is in the fields is
  // remembered for it.
  const atWar = ownPolityId !== null && world.conflicts.wars.some((war) => war.polityAId === ownPolityId || war.polityBId === ownPolityId);
  if (!atWar) return "opposed";

  // Whether a war is a reason to stand down depends entirely on the man.
  //
  // One who is held by duty closes ranks the moment the country is fought
  // over, and does not need it to be going badly first. One who is in this for
  // himself sees the same war as the opening he has been waiting for -- the
  // ruler is busy, the army is committed, and nobody is watching him. The same
  // crisis, read two opposite ways, which is the whole point of deriving this
  // from the person rather than from the situation alone.
  const { duty, status } = rival.mind.drives;
  const selfServing = status >= 65 && duty <= 40;
  if (selfServing) return "opposed";

  const dutiful = duty >= 65 || rival.mind.temperament.honesty >= 65;
  if (dutiful) return "converged";

  const ownForces = world.material.forces.filter((force) => force.polityId === ownPolityId);
  const badly = ownForces.some((force) => force.provisionStatus === "critical" || force.moraleBps < 4_000);
  return badly ? "converged" : "opposed";
}

/** What a stance means he is doing about it, for his own section of the prompt. */
export function stanceInWords(stance: NemesisStance, ruler: string): string {
  switch (stance) {
    case "opposed":
      return `Their interests and ${ruler}'s do not run together, and they are working on it.`;
    case "converged":
      return `For this season their interest and ${ruler}'s run together -- the country is at war and going badly, and a man who presses a private quarrel now will be remembered for it. They have not given anything up; they are waiting, and helping, and expecting to be owed for it.`;
    case "dormant":
      return `They have nothing left to press it with for now.`;
  }
}

/** A nemesis whose thread has closed, or who is past pressing anything, is retired. */
export function shouldRetire(world: WorldState, nemesis: Nemesis): boolean {
  const rival = world.characters.find((character) => character.id === nemesis.characterId);
  if (rival === undefined || !rival.alive) return true;
  const thread = world.storylines.find((storyline) => storyline.id === nemesis.storylineId);
  return thread !== undefined && thread.phase === "closed";
}

/** Opens the thread a nemesis's campaign is told in, and records the choice. */
export function recordNemesis(
  world: WorldState,
  chosen: { characterId: string; arena: NemesisArena; reason: string },
  targetCharacterId: string,
  ids: { next(prefix: string): string },
): WorldState {
  const rival = world.characters.find((character) => character.id === chosen.characterId);
  const ruler = world.characters.find((character) => character.id === targetCharacterId);
  if (rival === undefined || ruler === undefined) return world;

  const storylineId = ids.next("storyline");
  // Names are the world's, up to a hundred and twenty characters each, and two
  // of them in a thread title the schema caps at a hundred and sixty is a save
  // that will not load. Clipped, never refused: the quarrel still begins.
  const stakes = clip(arenaStakes(chosen.arena, rival.name, ruler.name), 320);
  return {
    ...world,
    storylines: [
      ...world.storylines,
      {
        id: storylineId,
        title: clip(`${rival.name} and ${ruler.name}`, 160),
        // The rival alone, and deliberately.
        //
        // A thread is shown to everyone in it, and the world slice draws the
        // ruler's own portrait the same way cognition draws everybody else's.
        // Listing the ruler here would have handed them, in their very first
        // slice, a thread called "X and you" whose stakes read "X means to
        // have what you hold" -- the whole quarrel, announced, before the man
        // had done anything. It is the world's bookkeeping about him, not
        // something he is party to. He joins it when it becomes open, which
        // `storyline_advance` can do with "addParticipantRefs".
        participantIds: [chosen.characterId],
        provinceId: rival.locationProvinceId,
        phase: "brewing" as const,
        stakes,
        history: [],
        nextDevelopment: "He has not moved openly yet.",
        // The quarrel is the world's bookkeeping and nobody's announcement.
        // What he actually does becomes visible when he does it.
        visibility: "private" as const,
        origin: "world" as const,
        openedByRef: null,
        openedAtStep: world.elapsedStep,
        updatedAtStep: world.elapsedStep,
        closedAtStep: null,
        causalFactIds: [],
        seedKey: null,
      },
    ],
    nemeses: [
      ...world.nemeses,
      {
        id: ids.next("nemesis"),
        characterId: chosen.characterId,
        targetCharacterId,
        arena: chosen.arena,
        storylineId,
        chosenAtStep: world.elapsedStep,
        retiredAtStep: null,
        reason: chosen.reason,
      },
    ],
  };
}

/** Retires the live nemesis for this ruler, if it is time. */
export function retireNemesis(world: WorldState, nemesis: Nemesis): WorldState {
  return {
    ...world,
    nemeses: world.nemeses.map((entry) => (entry.id === nemesis.id ? { ...entry, retiredAtStep: world.elapsedStep } : entry)),
  };
}

/** Text cut to a schema's length, with an ellipsis to show it was. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}
