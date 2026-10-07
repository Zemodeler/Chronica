import type { WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";

/**
 * What a turn changed, read from state alone (plan chronicle-and-order-truth,
 * 4.5): treasury and purse, where the armies stand, who holds which seat, what
 * work finished. Arithmetic over two worlds -- no model, no historian -- so the
 * player can always see what his turn did whatever the prose chose to tell.
 */
export interface WhatChangedInput {
  readonly before: WorldState;
  readonly after: WorldState;
  readonly polityId: string | null;
  readonly characterId: string | null;
}

const sumOf = (world: WorldState, owner: "polity" | "character", id: string): number => world.material.accounts
  .filter((account) => account.owner.kind === owner && account.owner.id === id)
  .reduce((total, account) => total + account.balance, 0);

export function whatChanged(input: WhatChangedInput): string[] {
  const { before, after } = input;
  const lines: string[] = [];
  const currency = after.material.currency.name;
  const provinceName = (world: WorldState, id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const money = (label: string, from: number, to: number): void => {
    if (from !== to) lines.push(`${label}: ${from} to ${to} ${currency} (${to > from ? "+" : ""}${to - from}).`);
  };
  if (input.polityId !== null) money("Treasury", sumOf(before, "polity", input.polityId), sumOf(after, "polity", input.polityId));
  if (input.characterId !== null) money("Your purse", sumOf(before, "character", input.characterId), sumOf(after, "character", input.characterId));

  for (const force of after.material.forces) {
    if (input.polityId === null || force.polityId !== input.polityId) continue;
    const was = before.material.forces.find((candidate) => candidate.id === force.id);
    if (was === undefined) lines.push(`${force.name} raised at ${provinceName(after, force.locationId)}.`);
    else if (was.locationId !== force.locationId) lines.push(`${force.name} moved from ${provinceName(before, was.locationId)} to ${provinceName(after, force.locationId)}.`);
  }
  for (const was of before.material.forces) {
    if (input.polityId !== null && was.polityId === input.polityId && !after.material.forces.some((force) => force.id === was.id)) lines.push(`${was.name} is no more.`);
  }

  const nameOf = (world: WorldState, id: string | null): string => id === null ? "nobody" : world.characters.find((character) => character.id === id)?.name ?? id;
  for (const seat of after.material.officeSeats) {
    const was = before.material.officeSeats.find((candidate) => candidate.id === seat.id);
    // Seats of other powers fill and empty all the time: the world's business, not this turn's.
    const holderId = seat.status === "held" ? seat.holderCharacterId : was?.status === "held" ? was.holderCharacterId : null;
    if (input.polityId !== null && after.characters.find((character) => character.id === holderId)?.polityId !== input.polityId) continue;
    const holder = seat.status === "held" ? seat.holderCharacterId : null;
    const held = was === undefined ? null : was.status === "held" ? was.holderCharacterId : null;
    // A seat filled from nothing is the world settling, not a turn of this one's; his own seat and a change of hands are told.
    if (holder !== held && (held !== null || holder === input.characterId)) {
      const office = seat.officeId.replace(/-/g, " ");
      lines.push(holder === null ? `${office}: ${nameOf(before, held)} no longer holds it.` : `${office}: ${nameOf(before, held)} to ${nameOf(after, holder)}.`);
    }
  }

  for (const project of after.projects) {
    const was = before.projects.find((candidate) => candidate.id === project.id);
    if (project.status === "completed" && was !== undefined && was.status !== "completed") lines.push(`Finished: ${project.label}.`);
    // A march is the army's movement, told as where it stands; its bookkeeping label is not an event.
    else if (was === undefined && project.status !== "completed" && !/ marches (to|on|towards) /i.test(project.label)) lines.push(`Begun: ${project.label}.`);
  }
  return lines.slice(0, 12);
}

/** The lines as a recorded entry, dated at the end of the turn; null when nothing changed. */
export function whatChangedEntry(input: WhatChangedInput, atInstantSortKey: number): ChronicleEntry | null {
  const lines = whatChanged(input);
  if (lines.length === 0) return null;
  return {
    kind: "recorded", title: "What changed", body: lines.map((line) => `- ${line}`).join("\n"),
    factIds: [], subjects: [], tags: [], changes: [], quote: null, fromInstantSortKey: atInstantSortKey, toInstantSortKey: atInstantSortKey,
  };
}
