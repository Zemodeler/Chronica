import { ORDER_PART_STATUS_LABEL, isOrderPartOpen, openStorylines, orderPartStatus, waitingUntil, type WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";

/**
 * "Still open": the forward-looking part of the record, kept out of the prose
 * (plan chronicle-and-order-truth, decision D3). The historian never looks
 * ahead; the page can, from what the world holds -- threads the player's side
 * can see, and his own orders that wait on something.
 */
const MAX_LINES = 6;
/** A thread quiet for this long is not an open question any more. */
const STALE_DAYS = 90;
const SENATE_VOTE = /\b(senate|senatorial|vote|votes|voted|motion|rivalry)\b/i;

export function openThreadLines(world: WorldState, playerCharacterId: string | null): string[] {
  const lines: string[] = [];
  if (playerCharacterId !== null) {
    for (const order of world.orders) {
      if (order.actorCharacterId !== playerCharacterId) continue;
      for (const part of order.parts) {
        if (!isOrderPartOpen(world, part)) continue;
        const waiting = waitingUntil(world, part);
        if (waiting !== null) lines.push(`"${part.said}": waiting until ${waiting}.`);
        else if (["under_way", "awaiting_reply", "acknowledged", "authorized"].includes(orderPartStatus(world, part))) lines.push(`"${part.said}": ${ORDER_PART_STATUS_LABEL[orderPartStatus(world, part)]}.`);
      }
    }
  }
  const visible = openStorylines(world.storylines)
    .filter((storyline) => storyline.visibility !== "private" && world.elapsedStep - storyline.updatedAtStep <= STALE_DAYS)
    // Other people's health is nothing to act on, and the Senate's votes are
    // told where they are counted, not as a thread left hanging on this page.
    .filter((storyline) => !storyline.seedKey?.startsWith("peril:") || (playerCharacterId !== null && storyline.participantIds.includes(playerCharacterId)))
    .filter((storyline) => !SENATE_VOTE.test(`${storyline.title} ${storyline.stakes} ${storyline.nextDevelopment}`))
    .sort((a, b) => b.updatedAtStep - a.updatedAtStep);
  // One line a subject: "The Mamertine appeal to Rome" and "...enters crisis" are one matter.
  const told = new Set<string>();
  for (const storyline of visible) {
    const subject = storyline.title.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
    if (told.has(subject)) continue;
    told.add(subject);
    lines.push(`${storyline.title}: ${storyline.nextDevelopment.replace(/[.\s]+$/, "")}.`);
  }
  return lines.slice(0, MAX_LINES);
}

/** The lines as a recorded entry at the end of the turn; null when nothing is open. */
export function openThreadsEntry(world: WorldState, playerCharacterId: string | null, atInstantSortKey: number): ChronicleEntry | null {
  const lines = openThreadLines(world, playerCharacterId);
  if (lines.length === 0) return null;
  return {
    kind: "recorded", title: "Still open", body: lines.map((line) => `- ${line}`).join("\n"),
    factIds: [], subjects: [], tags: [], changes: [], quote: null, fromInstantSortKey: atInstantSortKey, toInstantSortKey: atInstantSortKey,
  };
}
