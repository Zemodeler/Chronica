import { computeOpinion, type Character, type WorldState } from "@chronica/shared";

/**
 * The king's friends and their cabals (docs/plans/government.md, "H6 as built").
 *
 * A king's court is a place where the friends (*philoi*) vie for his ear: the man who keeps his revenues (the *dioiketes*) or whoever stands highest with him is
 * the one the others envy, and a friend who thinks ill of him comes to want him put out of the king's favour. They go the way every want goes: they plan for it or
 * not (`grumbling.ts`, plots); an audit his rivals call for finds what it finds (`close-of-office.ts`, the king's justice names the friend who spoke). The want is made
 * of the opinions the men already have of one another; nothing here makes a quarrel that was not there.
 *
 * At most `MOST_RIVALS` friends set themselves against one favourite; a favourite is one man a court; the want goes when he does. By rule, monthly, for every
 * power whose head is a king; no model.
 */

export const MOST_RIVALS = 2;
/** How ill a friend must think of the favourite to want him out. */
export const ENVY_AT = -25;
const wantId = (favouriteId: string): string => `envy-${favouriteId}`.slice(0, 120);

/** The man the court envies: the officer of the revenues where there is one, else the friend of highest standing. */
export function favouriteOf(world: WorldState, polityId: string): Character | undefined {
  const living = (id: string | null): Character | undefined => (id === null ? undefined : world.characters.find((character) => character.id === id && character.alive));
  const finance = world.material.officeSeats
    .filter((seat) => seat.status === "held" && /dioiketes|finance|revenue/iu.test(seat.officeId) && living(seat.holderCharacterId)?.polityId === polityId)
    .map((seat) => living(seat.holderCharacterId)!);
  if (finance.length > 0) return [...finance].sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
  const friends = friendsOf(world, polityId);
  return [...friends].sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
}

/** The king's friends: those who hold a seat among his councillors. */
export function friendsOf(world: WorldState, polityId: string): Character[] {
  const seen = new Set<string>();
  const out: Character[] = [];
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null || seen.has(seat.holderCharacterId) || !/friend|councillor/iu.test(seat.officeId)) continue;
    const man = world.characters.find((character) => character.id === seat.holderCharacterId && character.alive && character.polityId === polityId);
    if (man === undefined) continue;
    seen.add(man.id);
    out.push(man);
  }
  return out;
}

/** Court rivalry for every king, once a month: the envy of the friends for the favourite, as wants. */
export function keepTheCourtRivalries(world: WorldState): WorldState {
  const rivals = new Map<string, { label: string; targetId: string }>();
  const stale = new Set<string>();
  for (const record of world.constitutions) {
    if (record.form !== "monarchy" && record.form !== "temple_state") continue;
    const favourite = favouriteOf(world, record.polityId);
    if (favourite === undefined) continue;
    const ranked = friendsOf(world, record.polityId)
      .filter((friend) => friend.id !== favourite.id && friend.prestigeBps <= favourite.prestigeBps && computeOpinion(friend, favourite.id) <= ENVY_AT)
      .sort((a, b) => computeOpinion(a, favourite.id) - computeOpinion(b, favourite.id) || a.id.localeCompare(b.id))
      .slice(0, MOST_RIVALS);
    for (const friend of ranked) rivals.set(friend.id, { label: `See ${favourite.name} put out of the king's favour`.slice(0, 200), targetId: favourite.id });
  }
  for (const character of world.characters) {
    for (const ambition of character.ambitions) if (ambition.status === "active" && ambition.targetId !== null && ambition.id === wantId(ambition.targetId) && rivals.get(character.id)?.targetId !== ambition.targetId) stale.add(character.id);
  }
  if (rivals.size === 0 && stale.size === 0) return world;
  return {
    ...world,
    characters: world.characters.map((character) => {
      const want = rivals.get(character.id);
      const settled = stale.has(character.id)
        ? character.ambitions.map((ambition) => (ambition.status === "active" && ambition.targetId !== null && ambition.id === wantId(ambition.targetId) && want?.targetId !== ambition.targetId ? { ...ambition, status: "abandoned" as const } : ambition))
        : character.ambitions;
      const fresh = want !== undefined && !settled.some((ambition) => ambition.id === wantId(want.targetId));
      if (!fresh && settled === character.ambitions) return character;
      return { ...character, ambitions: fresh ? [...settled, { id: wantId(want!.targetId), label: want!.label, kind: "office" as const, targetId: want!.targetId, status: "active" as const, steps: [] }] : settled };
    }),
  };
}
