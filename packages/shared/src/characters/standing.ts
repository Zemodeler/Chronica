import { allOffices, type Character, type Office } from "./character";
import { officeRequirements } from "./candidates";
import { resolveEligibility } from "./political-authority";
import { standingInWords } from "./skills-in-words";
import { clampStandingShift, formatStanding, type StandingCause } from "./standing-causes";
import type { EligibilityRequirement } from "../material-state";
import type { WorldState } from "../world/world-state";

/**
 * A man's standing, as the engine moves it and as he is shown it.
 *
 * Standing is what every office's gate asks and what an election is counted
 * on. A soldier's valour, a city stormed, a year in office, a feast given
 * moved it not at all, and the sheet hid the number behind a trait: a player
 * had no way to rise and no way to see how far he had to go.
 */

/** The top of the scale, as the player is told it. */
export const STANDING_SCALE_BPS = 10_000;

/**
 * Moves a man's standing by a deed, no further than its cause allows
 * (`standing-causes.ts`), and never below nothing or above the scale. The
 * dead are past it.
 */
export function shiftStanding(world: WorldState, characterId: string, bps: number, cause: StandingCause): WorldState {
  const shift = Math.round(clampStandingShift(bps, cause));
  if (shift === 0) return world;
  let changed = false;
  const characters = world.characters.map((character) => {
    if (character.id !== characterId || !character.alive) return character;
    const prestigeBps = Math.max(0, Math.min(STANDING_SCALE_BPS, character.prestigeBps + shift));
    if (prestigeBps === character.prestigeBps) return character;
    changed = true;
    return { ...character, prestigeBps };
  });
  return changed ? { ...world, characters } : world;
}

/** What a man is, which no deed changes: a gate barred by these is not one he is climbing towards. */
const WHO_HE_IS = new Set<EligibilityRequirement["kind"]>(["polity_membership", "culture_membership", "faith_membership", "legal_status", "gender", "ordo"]);

export interface StandingGate {
  readonly officeId: string;
  readonly label: string;
  readonly neededBps: number;
  readonly met: boolean;
}

/** The standing an office's own requirements ask, where they ask one. */
export function standingGateOf(world: Pick<WorldState, "material">, office: Office): number | null {
  const { requirementIds } = officeRequirements(world, office);
  const requirement = world.material.eligibilityRequirements.find((candidate) => candidate.kind === "min_prestige" && requirementIds.includes(candidate.id));
  return requirement === undefined ? null : (requirement.params.minPrestigeBps as number | undefined) ?? 0;
}

/**
 * Every office of his own power that asks a standing, and that nothing about
 * who he is bars him from: a patrician is not shown the tribunate of the plebs.
 * Lowest gate first.
 */
export function standingGates(world: WorldState, scenarioOffices: readonly Office[], character: Character): StandingGate[] {
  const gates: StandingGate[] = [];
  for (const office of allOffices(world, scenarioOffices)) {
    if (office.polityId !== character.polityId) continue;
    const neededBps = standingGateOf(world, office);
    if (neededBps === null) continue;
    const { requirementIds } = officeRequirements(world, office);
    const fixed = requirementIds.filter((id) => WHO_HE_IS.has(world.material.eligibilityRequirements.find((requirement) => requirement.id === id)?.kind ?? "alive"));
    if (!resolveEligibility(world, character.id, fixed, office.id).eligible) continue;
    gates.push({ officeId: office.id, label: office.label, neededBps, met: character.prestigeBps >= neededBps });
  }
  return gates.sort((a, b) => a.neededBps - b.neededBps || a.label.localeCompare(b.label));
}

/** "2,190 of 10,000". */
export function standingFigure(prestigeBps: number): string {
  return `${formatStanding(prestigeBps)} of ${formatStanding(STANDING_SCALE_BPS)}`;
}

/**
 * The gates grouped by what they ask: the highest he has passed, and the next
 * two he has not: "Roman quaestor and Military tribune at 3,000 (810 short)".
 */
export function gatesInWords(gates: readonly StandingGate[], prestigeBps: number): { readonly passed: string | null; readonly next: readonly string[] } {
  const byNeed = new Map<number, string[]>();
  for (const gate of gates) byNeed.set(gate.neededBps, [...(byNeed.get(gate.neededBps) ?? []), gate.label]);
  const groups = [...byNeed.entries()].sort(([a], [b]) => a - b);
  const said = ([need, labels]: [number, string[]]): string => `${labels.length <= 1 ? labels[0] ?? "" : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`} at ${formatStanding(need)}`;
  const passed = groups.filter(([need]) => need <= prestigeBps).at(-1);
  const next = groups.filter(([need]) => need > prestigeBps).slice(0, 2).map((group) => `${said(group)} (${formatStanding(group[0] - prestigeBps)} short)`);
  return { passed: passed === undefined ? null : said(passed), next };
}

/**
 * One line a reader can answer "can I stand for quaestor?" from: the
 * number, its words, and the gates either side of it. For the orchestrator's
 * view of the man it acts for.
 */
export function standingLine(world: WorldState, scenarioOffices: readonly Office[], characterId: string): string | null {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  if (character === undefined) return null;
  const words = gatesInWords(standingGates(world, scenarioOffices, character), character.prestigeBps);
  const parts = [
    `${standingFigure(character.prestigeBps)} (${standingInWords(character.prestigeBps)})`,
    words.passed === null ? null : `enough for ${words.passed}`,
    words.next.length === 0 ? null : `next: ${words.next.join("; ")}`,
  ].filter((part): part is string => part !== null);
  return `${parts.join("; ")}.`;
}
