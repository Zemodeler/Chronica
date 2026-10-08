import type { FactProposalDraft, WorldState } from "@chronica/shared";
import { powersDealtWith, powersNearThePlayer } from "./far-powers";

/**
 * The far calendar, in one line (docs/plans/government.md, "Offices and data gaps closed").
 *
 * Ninety powers electing and laying down their offices on one March day are their own people's news and were kept so (`far-powers.ts`): told to nobody else, not
 * even as a count. But a man whose circle is touched has a reason to know that the Aetolians chose their magistrates this spring, so for each kind of business of
 * the calendar there is one line a turn, naming the powers beyond his borders that are in his circle (the bloc he leads or follows and the borders of
 * its members, the powers that trust or distrust his, those he writes to) or that hold an open treaty with a power near him. A calendar that touches nobody he has
 * dealings with stays hidden, as it was.
 */

/** The kinds of the ordinary calendar, and how each is said of a number of powers. */
const CALENDAR: Readonly<Record<string, (count: number, names: string) => string>> = {
  election_held: (count, names) => `Elections were held in ${count === 1 ? "one power" : `${count} powers`} within your circle beyond your borders: ${names}.`,
  office_term_ended: (count, names) => `Magistrates laid down their offices at the end of their terms in ${count === 1 ? "one power" : `${count} powers`} within your circle beyond your borders: ${names}.`,
};

/** The names of up to three, and how many more. */
function named(names: readonly string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const list = shown.length <= 1 ? shown.join("") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return more > 0 ? `${list} and ${more} more` : list;
}

/** One public line for each calendar kind that touches the player's circle: facts already told as the far powers' own news are counted, never shown. */
export function summariseTheFarCalendar(world: WorldState, facts: readonly FactProposalDraft[], playerCharacterId: string | null | undefined): FactProposalDraft[] {
  const near = powersNearThePlayer(world, playerCharacterId);
  const circle = powersDealtWith(world, playerCharacterId);
  if (near === null || circle === null) return [];
  const openTreaty = (polityId: string): boolean => world.polityAgreements.some((agreement) =>
    agreement.status === "active" && ((agreement.polityId === polityId && near.has(agreement.otherPolityId)) || (agreement.otherPolityId === polityId && near.has(agreement.polityId))));
  const out: FactProposalDraft[] = [];
  for (const [kind, say] of Object.entries(CALENDAR)) {
    const far = new Set<string>();
    for (const fact of facts) {
      if (fact.kind !== kind || fact.visibility !== "polity") continue;
      const polityId = (fact.affectedRefs ?? []).find((ref) => ref.kind === "polity")?.id;
      if (polityId !== undefined && !near.has(polityId)) far.add(polityId);
    }
    const touching = [...far].filter((polityId) => circle.has(polityId) || openTreaty(polityId)).sort();
    if (touching.length === 0) continue;
    const names = touching.map((polityId) => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId);
    out.push({
      localId: `far_calendar_${kind}`,
      kind: "far_calendar",
      summary: say(touching.length, named(names)),
      affectedRefs: touching.slice(0, 8).map((id) => ({ kind: "polity" as const, id })),
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 15,
    });
  }
  return out;
}
