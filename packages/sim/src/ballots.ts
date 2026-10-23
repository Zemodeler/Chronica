import {
  deriveDefaultMind,
  stableHash,
  type Character,
  type CharacterMind,
  type GovernmentInstitution,
  type PoliticalProcedure,
  type QuestionConcern,
  type VotingBloc,
  type WorldState,
} from "@chronica/shared";
import { leanAsAGens, type Kin } from "./gens-loyalty";

/**
 * A chamber of men, not a chamber of blocs.
 *
 * The Senate used to vote as two lumps -- "the patrician houses" sixty,
 * "the plebeian new men" forty -- each leaning together by its disposition and
 * splitting by a threshold rule. A senator's own nature never entered into it:
 * a coward and a firebrand in the same bloc voted alike on a war, a man who had
 * spoken against a measure was counted with the rest of his bloc for it, and
 * the same bloc voted the same way on every question that put the same number
 * to it. Here every seat in a council is somebody:
 *
 * - **Named senators** -- real characters of the polity who hold an office, or
 *   have spoken on the question -- sit in the bloc of their order and vote
 *   as themselves: by what they declared, and by their own minds.
 * - **The rest of the seats** are people too, each with a mind generated from
 *   the seat's own id (`deriveDefaultMind`, so as varied as anybody) who
 *   vote the same way every time they are asked the same thing, and differently
 *   from the man beside them.
 *
 * The bloc is now only a faction: its disposition, interests and leaders pull
 * the members who belong to it, and each member answers that pull by their
 * own temperament (a cautious man is slow to be moved, a sociable one follows
 * his friends, a dutiful one the Republic's need), on the question's own concerns
 * (a bold man for war, a rich one against taxes, a pious one for the gods),
 * and by the day's own mood. Only councils vote this way: an assembly of
 * citizens votes by centuries and tribes, which are not men.
 *
 * Deterministic: every roll hashes the seat and the question. No model.
 */

/**
 * Every chamber votes by seat. In a council the seats are its members; in an
 * assembly of citizens or soldiers each seat is one of the people who voted
 * (a century's or a tribe's voice), and the named men among them vote as
 * themselves while the rest are people nobody has written yet.
 */
export function votesBySeat(_institution: GovernmentInstitution): boolean {
  return true;
}

/** In a council only the men who hold office or have spoken are named; in an assembly, every citizen of the power is somebody who might vote. */
const NAMED_ONLY_IF_ACTIVE = new Set(["council", "chiefs", "priests"]);

/** What each question's concern asks of the parts of a mind: positive for the part that is for it. */
const CONCERN_PULL: Readonly<Record<QuestionConcern, Readonly<Record<string, number>>>> = {
  war: { boldness: 0.12, status: 0.06, caution: -0.1 },
  peace: { boldness: -0.12, status: -0.06, caution: 0.1 },
  taxes: { wealth: -0.12, duty: 0.06 },
  spending: { wealth: -0.06, duty: 0.05 },
  land: { wealth: -0.08, sociability: 0.05, duty: 0.04 },
  debt: { wealth: -0.1, sociability: 0.06 },
  trade: { wealth: 0.08, sociability: 0.04 },
  religion: { faith: 0.12, duty: 0.04 },
  levy: { duty: 0.1, boldness: 0.04 },
  grain: { sociability: 0.08, duty: 0.04, wealth: -0.04 },
  // A man who loves silver is for a heavy coin; one who thinks of his neighbours dislikes seeing it cheapened.
  coinage: { wealth: -0.06, duty: 0.04 },
  widen_franchise: { sociability: 0.08, status: -0.08 },
  narrow_franchise: { sociability: -0.08, status: 0.08 },
  strengthen_ruler: { duty: 0.06, security: 0.08, status: -0.06 },
  weaken_ruler: { duty: -0.06, security: -0.08, status: 0.06 },
  new_office: { status: 0.06 },
  punishment: { cruelty: 0.12, revenge: 0.06, sociability: -0.04 },
};

const MAX_MIND_PULL = 22;

const partOf = (mind: CharacterMind, part: string): number =>
  (mind.temperament as Record<string, number>)[part] ?? (mind.drives as Record<string, number>)[part] ?? 50;

/** How far a man's own nature moves him on this question, for or against: up to about a fifth of the scale. */
export function mindLean(mind: CharacterMind, concerns: readonly QuestionConcern[]): number {
  let lean = 0;
  for (const concern of concerns) {
    for (const [part, weight] of Object.entries(CONCERN_PULL[concern])) lean += (partOf(mind, part) - 50) * weight;
  }
  return Math.max(-MAX_MIND_PULL, Math.min(MAX_MIND_PULL, Math.round(lean)));
}

export interface Seat {
  readonly id: string;
  readonly name: string;
  /** The character, where the seat is a named one. */
  readonly characterId: string | null;
  readonly mind: CharacterMind;
  /** The gens a named man is of, and whether he is its first man (`gens-loyalty.ts`). */
  readonly gensId?: string | null;
  readonly leader?: boolean;
}

export interface Ballot {
  readonly seat: Seat;
  readonly lean: number;
  readonly choice: "yes" | "no" | "abstain";
}

const FLAT_SKILLS = { martial: 50, intrigue: 50, learning: 50, piety: 50, stewardship: 50, diplomacy: 50, body: 50, subSkills: {} };

/** Which bloc of the house a named man sits in: his order's, else the one his id falls to. */
function blocOfMan(character: Character, blocs: readonly VotingBloc[], groupsOf: ReadonlySet<string>): VotingBloc {
  // A member of a faction sits in its bloc, whatever his order.
  const factional = blocs.find((bloc) => bloc.groupId != null && groupsOf.has(bloc.groupId));
  if (factional !== undefined) return factional;
  const wanted = character.ordo === "patrician" ? /patric|noble|landed|senator/i : character.ordo === "plebeian" ? /pleb|popular|commons|people|new men/i : null;
  const byOrder = wanted === null ? undefined : blocs.find((bloc) => wanted.test(`${bloc.id} ${bloc.name} ${bloc.representedInterest}`));
  if (byOrder !== undefined) return byOrder;
  const total = blocs.reduce((sum, bloc) => sum + bloc.weight, 0);
  let at = stableHash([character.id, "bloc"]) % Math.max(1, total);
  for (const bloc of blocs) { if (at < bloc.weight) return bloc; at -= bloc.weight; }
  return blocs[0]!;
}

/**
 * Who sits in each bloc of the house: named men first (those who hold an
 * office or have spoken, highest standing first, never more than the bloc has
 * seats), then seats nobody has named, each their own person.
 */
export function seatsOf(world: WorldState, institution: GovernmentInstitution, speakers: ReadonlySet<string>): Map<string, Seat[]> {
  const blocs = institution.votingBlocs;
  const heldSeat = new Set(world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!));
  const named = new Map<string, Character[]>(blocs.map((bloc) => [bloc.id, []]));
  const memberships = new Map<string, Set<string>>();
  for (const membership of world.material.groupMemberships) {
    if (membership.leftAtStep !== null) continue;
    const set = memberships.get(membership.characterId) ?? new Set<string>();
    set.add(membership.groupId);
    memberships.set(membership.characterId, set);
  }
  const wholePeople = !NAMED_ONLY_IF_ACTIVE.has(institution.franchise ?? "citizens");
  for (const character of world.characters) {
    if (!character.alive || character.polityId !== institution.polityId) continue;
    if (!wholePeople && character.officeId === null && !heldSeat.has(character.id) && !speakers.has(character.id) && !memberships.has(character.id)) continue;
    named.get(blocOfMan(character, blocs, memberships.get(character.id) ?? new Set()).id)!.push(character);
  }
  const out = new Map<string, Seat[]>();
  for (const bloc of blocs) {
    const men = (named.get(bloc.id) ?? [])
      .sort((a, b) => Number(speakers.has(b.id)) - Number(speakers.has(a.id)) || b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))
      .slice(0, bloc.weight);
    const seats: Seat[] = men.map((man) => ({
      id: man.id, name: man.name, characterId: man.id, mind: man.mind,
      ...(man.dynastyId === null ? {} : { gensId: man.dynastyId, leader: world.gentes.some((gens) => gens.id === man.dynastyId && gens.princepsId === man.id) }),
    }));
    for (let n = seats.length; n < bloc.weight; n += 1) {
      const id = `${institution.id}:${bloc.id}:seat-${n}`;
      seats.push({ id, name: `a member of ${bloc.name.toLowerCase()}`, characterId: null, mind: deriveDefaultMind({ id, officeId: null, skills: FLAT_SKILLS, ageYears: 45, cultureId: "unnamed" }) });
    }
    out.set(bloc.id, seats);
  }
  return out;
}

/**
 * How every seat of one bloc votes on a question.
 *
 * `blocLean` is the faction's own pull on the question (its disposition, its
 * interests, what its leaders and the house have said). Each member answers it
 * by their own nature: slow to be moved if cautious or disciplined, swayed by
 * their own concerns (`mindLean`), carried on the day by their own mood, and --
 * if they spoke -- bound by what they said.
 */
export function ballotsOfBloc(
  seats: readonly Seat[],
  bloc: Pick<VotingBloc, "yesThreshold" | "noThreshold" | "groupId">,
  blocLean: number,
  procedure: PoliticalProcedure,
  concerns: readonly QuestionConcern[],
  ownWords: ReadonlyMap<string, "support" | "oppose">,
  kin?: Kin,
): Ballot[] {
  // What each seat leans before the gens has its say; then the gentes draw their men together and their feuds turn them.
  const own = seats.map((seat) => {
    const { temperament } = seat.mind;
    const followsFaction = 0.7 + (bloc.groupId == null ? 0 : 0.15) + (temperament.sociability - 50) / 220 - (temperament.discipline - 50) / 400;
    const mood = ((stableHash([seat.id, procedure.id, "mood"]) % 2_001) / 1_000 - 1) * (4 + 12 * (1.2 - temperament.discipline / 100));
    return blocLean * Math.max(0.25, Math.min(1, followsFaction)) + mindLean(seat.mind, concerns) + mood;
  });
  const together = leanAsAGens(seats, own, kin);
  return seats.map((seat, index) => {
    const { temperament } = seat.mind;
    // A man who thinks for himself is less carried by his faction; a sociable one more.
    // A faction holds its members closer than a house holds its estates: they go where their leader goes.
    const followsFaction = 0.7 + (bloc.groupId == null ? 0 : 0.15) + (temperament.sociability - 50) / 220 - (temperament.discipline - 50) / 400;
    // The day's mood: each seat's own, on each question, larger in the impulsive.
    const mood = ((stableHash([seat.id, procedure.id, "mood"]) % 2_001) / 1_000 - 1) * (4 + 12 * (1.2 - temperament.discipline / 100));
    let lean = together[index]!;
    // A man who moved the question votes for it, unless he has said otherwise since (a playtest's own motion was voted against by its mover).
    const said = seat.characterId === null ? undefined : ownWords.get(seat.characterId) ?? (seat.characterId === procedure.sponsorCharacterId ? "support" : undefined);
    if (said === "support") lean = Math.max(lean, bloc.yesThreshold + 5) + 10;
    else if (said === "oppose") lean = Math.min(lean, bloc.noThreshold - 5) - 10;
    lean = Math.max(-100, Math.min(100, Math.round(lean)));
    // The cautious abstain across a wider middle; the decided cross their line sooner.
    // A bloc's lines are for the bloc as a whole: a man takes a side well before he is at them.
    const slack = (temperament.caution - 50) / 8;
    const choice = lean >= bloc.yesThreshold * 0.45 + slack ? "yes" : lean <= bloc.noThreshold * 0.45 - slack ? "no" : "abstain";
    return { seat, lean, choice };
  });
}
