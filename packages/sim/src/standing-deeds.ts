import {
  allOffices,
  aptitude,
  isMagistracy,
  shiftStanding,
  stableHash,
  type BattleResult,
  type Character,
  type FactProposalDraft,
  type Office,
  type PoliticalProcedure,
  type StandingCause,
  type VoteRecord,
  type WorldState,
} from "@chronica/shared";

/**
 * Standing earned by deeds, decided by the engine (L2 of the 2026-10-02
 * play-test).
 *
 * Nothing a man in the ranks could do moved his standing: an election added
 * 500, a commander's victory 400, a rare decoration a little more, and every
 * other deed -- a battle fought and won, a city stormed, a year in office, a
 * speech on the side that carried -- added nothing at all. A legionary began
 * at 2,000 and the lowest office asks 3,000, so the soldier's road to the
 * Senate did not exist. Each deed here is small and certain; together they
 * are a career.
 */

/** What a battle won is worth to a named man who came through it, and to one who bled for it. */
export const BATTLE_WON_BPS = 50;
export const BATTLE_WON_WOUNDED_BPS = 100;
/** What a rout costs the men of the army that broke. */
export const ROUTED_BPS = -50;
/** What a city taken is worth to the named men of the army that took it. */
export const CITY_TAKEN_BPS = 100;
/** And to the man first over its wall, when it was stormed: the corona muralis. */
export const FIRST_OVER_THE_WALL_BPS = 200;
/** What holding a relieved city is worth to the men who held it, and the men who came for them. */
export const CITY_RELIEVED_BPS = 150;
/** A month in a magistracy. */
export const OFFICE_MONTH_BPS = 100;
const OFFICE_MONTH_DAYS = 30;
/** A speech on the side that carried, from the plainest speaker to the best. */
const SPEECH_WON_MIN_BPS = 50;
const SPEECH_WON_MAX_BPS = 150;
/** A speech on a side beaten by more than two to one. */
const SPEECH_ROUTED_BPS = -50;

/** A fact's local id: lowercase and short, as the fact contract asks. */
const localIdOf = (prefix: string, ...parts: readonly (string | number)[]): string => `${prefix}_${stableHash([prefix, ...parts]).toString(36)}`.slice(0, 60);

/**
 * What the player is told of his own name moving. Only the player: every
 * soldier of every army gains a little after every battle, and the record of
 * it is the number on their sheets, not a fact apiece.
 */
function standingFact(person: Character, summary: string, localId: string, significance: number): FactProposalDraft {
  return {
    localId,
    kind: "standing_changed",
    summary: summary.slice(0, 600),
    affectedRefs: [{ kind: "character", id: person.id }],
    knownToRefs: [{ kind: "character", id: person.id }],
    visibility: "private",
    discoveryState: "private",
    knowableInDays: 0,
    significance,
  };
}

/** Moves a man's standing and, if he is the player, tells him why. */
function credit(world: WorldState, facts: FactProposalDraft[], characterId: string, bps: number, cause: StandingCause, playerId: string | null, summary: (person: Character) => string, localId: string, significance = 30): WorldState {
  const before = world.characters.find((character) => character.id === characterId);
  const after = shiftStanding(world, characterId, bps, cause);
  const moved = after.characters.find((character) => character.id === characterId);
  if (before !== undefined && moved !== undefined && moved.prestigeBps !== before.prestigeBps && characterId === playerId) {
    facts.push(standingFact(moved, summary(moved), localId, significance));
  }
  return after;
}

// ── The field ─────────────────────────────────────────────────────────────

/**
 * A named man's battle, in standing: the men of a winning army are spoken of
 * in the camp, the more for a wound; the men of an army that broke and ran
 * are spoken of too, and not kindly.
 */
export function standingFromTheLine(
  world: WorldState,
  result: BattleResult,
  fate: { readonly characterId: string; readonly forceId: string; readonly outcome: string },
  playerId: string | null,
): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  if (fate.outcome === "killed" || result.outcome === "inconclusive") return { world, facts };
  const attacked = result.attackerForceIds.includes(fate.forceId);
  const won = (result.outcome === "attacker_victory") === attacked;
  const force = world.material.forces.find((candidate) => candidate.id === fate.forceId);
  const army = force?.name ?? "the army";
  if (won) {
    const hurt = fate.outcome === "wounded" || fate.outcome === "maimed";
    const next = credit(world, facts, fate.characterId, hurt ? BATTLE_WON_WOUNDED_BPS : BATTLE_WON_BPS, "victory", playerId,
      (person) => `${person.name}'s name is known in ${army}'s camp after the victory${hurt ? ", and the wound he took for it" : ""}.`,
      localIdOf("standing_battle", result.battleId, fate.characterId), 25);
    return { world: next, facts };
  }
  // Broke and ran: no orderly retreat, or none at all.
  const routed = !result.retreats.some((retreat) => retreat.forceId === fate.forceId && retreat.orderly);
  if (!routed) return { world, facts };
  const next = credit(world, facts, fate.characterId, ROUTED_BPS, "defeat", playerId,
    (person) => `${army} broke and ran, and ${person.name} ran with it: it is not forgotten in the city.`,
    localIdOf("standing_rout", result.battleId, fate.characterId), 25);
  return { world: next, facts };
}

// ── Sieges ────────────────────────────────────────────────────────────────

/** What a siege's end did, for the men who were there. */
export type SiegeDeed =
  | { readonly kind: "taken"; readonly siegeId: string; readonly place: string; readonly provinceId: string; readonly polityId: string; readonly stormed: boolean }
  | { readonly kind: "relieved"; readonly siegeId: string; readonly place: string; readonly forceIds: readonly string[] };

/** Every named man of an army: its commander and the men in its ranks. */
function namedMenOf(world: WorldState, forceIds: ReadonlySet<string>): string[] {
  const men = new Set<string>();
  for (const force of world.material.forces) {
    if (!forceIds.has(force.id)) continue;
    if (force.commanderCharacterId !== null) men.add(force.commanderCharacterId);
    for (const id of force.memberCharacterIds) men.add(id);
  }
  return [...men].filter((id) => world.characters.some((character) => character.id === id && character.alive));
}

/**
 * A city taken: every named man of the armies that took it is the better
 * spoken of, and when it was stormed, one of the men in the ranks -- the
 * boldest likelier -- was first over the wall and is crowned for it. A city
 * held until it was relieved: the men who held it, and the men who came.
 */
export function honourSieges(world: WorldState, deeds: readonly SiegeDeed[], toDay: number, playerId: string | null): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let next = world;
  for (const deed of deeds) {
    if (deed.kind === "relieved") {
      for (const id of namedMenOf(next, new Set(deed.forceIds))) {
        next = credit(next, facts, id, CITY_RELIEVED_BPS, "victory", playerId,
          (person) => `${person.name} is spoken of as one of the men who saved ${deed.place}.`,
          localIdOf("standing_relief", deed.siegeId, id), 35);
      }
      continue;
    }
    const takers = new Set(next.material.forces.filter((force) => force.polityId === deed.polityId && force.locationId === deed.provinceId).map((force) => force.id));
    const men = namedMenOf(next, takers);
    for (const id of men) {
      next = credit(next, facts, id, CITY_TAKEN_BPS, "victory", playerId,
        (person) => `${person.name}'s name is known in the camp after the ${deed.stormed ? "storm" : "taking"} of ${deed.place}.`,
        localIdOf("standing_taken", deed.siegeId, id), 35);
    }
    if (!deed.stormed) continue;
    const commanders = new Set(next.material.forces.filter((force) => takers.has(force.id)).map((force) => force.commanderCharacterId));
    const first = men
      .filter((id) => !commanders.has(id))
      .find((id) => {
        const bold = next.characters.find((character) => character.id === id)?.service?.conduct === "glory";
        return stableHash([deed.siegeId, id, "first over the wall"]) % 100 < (bold ? 30 : 12);
      });
    if (first === undefined) continue;
    const hero = next.characters.find((character) => character.id === first)!;
    const establishment = next.establishments.find((candidate) => candidate.polityId === hero.polityId);
    const crown = establishment?.honours.find((honour) => honour.kind === "decoration" && honour.for === "first_over_the_wall");
    if (crown !== undefined && hero.service !== undefined) {
      next = {
        ...next,
        characters: next.characters.map((character) => (character.id === hero.id && character.service !== undefined
          ? { ...character, service: { ...character.service, decorations: [...character.service.decorations, { label: crown.label, atStep: toDay, reason: `First over the wall of ${deed.place}`.slice(0, 200) }].slice(-20) } }
          : character)),
      };
    }
    next = shiftStanding(next, hero.id, FIRST_OVER_THE_WALL_BPS, "victory");
    facts.push({
      localId: localIdOf("first_over", deed.siegeId, hero.id),
      kind: "soldier_deed",
      summary: `${hero.name} was the first man over the wall of ${deed.place}${crown === undefined ? "" : `, and is given ${crown.label}`}.`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: hero.id }],
      visibility: hero.id === playerId ? "private" : "polity",
      discoveryState: hero.id === playerId ? "private" : "polity",
      knowableInDays: 0,
      significance: hero.id === playerId ? 60 : 30,
    });
  }
  return { world: next, facts };
}

// ── Office ────────────────────────────────────────────────────────────────

/**
 * A month in a magistracy is a month of being seen to govern: each whole
 * month a magistrate sits adds to his name, counted from the day his term
 * began or the day last counted. A seat held for life -- a king's, a
 * senator's -- is not counted: it is what he is, not what he is doing.
 */
export function honourTheSitting(world: WorldState, scenarioOffices: readonly Office[], toDay: number, playerId: string | null): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  const offices = new Map(allOffices(world, scenarioOffices).map((office) => [office.id, office]));
  let next = world;
  const counted = new Map<string, number>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null || seat.termExpiresAtStep === null) continue;
    const office = offices.get(seat.officeId);
    if (office === undefined || !isMagistracy(office)) continue;
    const since = Math.max(seat.termStartedAtStep ?? toDay, seat.honouredThroughStep ?? Number.NEGATIVE_INFINITY);
    const months = Math.floor((toDay - since) / OFFICE_MONTH_DAYS);
    if (months <= 0) {
      if (seat.honouredThroughStep === undefined && seat.termStartedAtStep === null) counted.set(seat.id, since);
      continue;
    }
    counted.set(seat.id, since + months * OFFICE_MONTH_DAYS);
    next = credit(next, facts, seat.holderCharacterId, months * OFFICE_MONTH_BPS, "office", playerId,
      (person) => `${months === 1 ? "A month" : `${months} months`} as ${office.label} add${months === 1 ? "s" : ""} to ${person.name}'s name.`,
      localIdOf("standing_office", seat.id, toDay), 10);
  }
  if (counted.size === 0) return { world: next, facts };
  return {
    world: { ...next, material: { ...next.material, officeSeats: next.material.officeSeats.map((seat) => (counted.has(seat.id) ? { ...seat, honouredThroughStep: counted.get(seat.id)! } : seat)) } },
    facts,
  };
}

// ── Speeches ──────────────────────────────────────────────────────────────

/**
 * The player's own speech on a question the house has now decided: on the
 * side that carried, he is the better spoken of, the more the better he
 * speaks; on a side beaten by more than two to one, the worse. Only his:
 * every senator speaks on every question, and a house where each of them
 * gained by it would rise without anybody doing anything.
 */
export function creditTheSpeech(world: WorldState, procedure: PoliticalProcedure, record: VoteRecord, playerId: string | null): { readonly world: WorldState; readonly facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  if (playerId === null) return { world, facts };
  const said = [...world.material.supportPositions].reverse()
    .find((position) => position.procedureId === procedure.id && position.supporterKind === "character" && position.supporterId === playerId);
  const speaker = world.characters.find((character) => character.id === playerId);
  if (said === undefined || (said.position !== "support" && said.position !== "oppose") || speaker === undefined) return { world, facts };
  const carried = record.outcome === "passed";
  const hisSideWon = (said.position === "support") === carried;
  if (hisSideWon) {
    const gift = Math.max(aptitude(speaker, "rhetoric"), speaker.skills.diplomacy) / 100;
    const bps = Math.round(SPEECH_WON_MIN_BPS + (SPEECH_WON_MAX_BPS - SPEECH_WON_MIN_BPS) * gift);
    const next = credit(world, facts, playerId, bps, "oratory", playerId,
      (person) => `${person.name} spoke ${said.position === "support" ? "for" : "against"} "${procedure.label}" and the house went his way: he is the better spoken of for it.`,
      localIdOf("standing_speech", procedure.id), 30);
    return { world: next, facts };
  }
  const forHim = said.position === "support" ? record.yesWeight : record.noWeight;
  const againstHim = said.position === "support" ? record.noWeight : record.yesWeight;
  if (againstHim <= forHim * 2) return { world, facts };
  const next = credit(world, facts, playerId, SPEECH_ROUTED_BPS, "oratory", playerId,
    (person) => `${person.name} spoke ${said.position === "support" ? "for" : "against"} "${procedure.label}" and was beaten ${againstHim} to ${forHim}: it did his name no good.`,
    localIdOf("standing_speech", procedure.id), 30);
  return { world: next, facts };
}
