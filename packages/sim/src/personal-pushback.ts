import {
  boundedId,
  createPressure,
  difficultyRules,
  readDepartments,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";
import { armiesLedBy, prosecutionOf } from "./command-tenure";
import { remember } from "./grievances";
import type { NarratorSeed } from "./narrator";

/**
 * The world pushing back on the player as a person (play-test L11).
 *
 * On hard the world organised against Rome and never against the man: a
 * private man could do anything the law forbade and nobody brought him to
 * court, an accusation the narrator laid on him was a line of prose, and a man
 * who told his legions to march on the city drew no answer from the city.
 * These are the rules that answer him, sized to what he is.
 */

/** Whether a man is out of office and out of command: nothing covers him. */
function isPrivate(world: WorldState, characterId: string): boolean {
  const man = world.characters.find((character) => character.id === characterId);
  if (man === undefined || !man.alive || man.officeId !== null) return false;
  if (world.material.officeSeats.some((seat) => seat.holderCharacterId === characterId && seat.status === "held")) return false;
  return armiesLedBy(world, characterId, man.polityId).length === 0;
}

/**
 * Once a month: a private man answers for what he has done beyond the law.
 *
 * What a man does without the authority to do it is written down as something
 * to answer for (`burst.ts`), and only a magistrate leaving office was ever
 * made to answer -- a private man was answerable to nobody, ever. Now one
 * whose account has reached the difficulty's `prosecuteAt` is prosecuted by
 * whoever of his people thinks worst of him (`prosecutionOf`); with nobody
 * willing, the account waits.
 */
export function prosecutePrivateMen(world: WorldState, day: number, playerCharacterId: string | null): { world: WorldState; facts: FactProposalDraft[] } {
  const prosecuteAt = difficultyRules(world.difficulty).prosecuteAt;
  const accused = [...new Set(world.answerable.map((entry) => entry.characterId))].filter((id) => isPrivate(world, id)).sort();
  let next = world;
  const facts: FactProposalDraft[] = [];
  for (const characterId of accused) {
    const charges = next.answerable.filter((entry) => entry.characterId === characterId);
    const polityId = charges[0]!.polityId;
    const brought = prosecutionOf(next, characterId, polityId, charges, day, playerCharacterId, "", prosecuteAt);
    if (brought === null) continue;
    next = {
      ...next,
      answerable: next.answerable.filter((entry) => entry.characterId !== characterId),
      material: { ...next.material, politicalProcedures: [...next.material.politicalProcedures, brought.procedure] },
    };
    facts.push({ localId: `prosecuted_${characterId}_${day}`.slice(0, 60), ...brought.fact });
  }
  return { world: next, facts };
}

/**
 * An accusation the narrator lays on the player, brought before a court in
 * earnest where the difficulty says so (`accusationsInEarnest`): not a rumour
 * the model may or may not turn into anything, but a charge with a day set for
 * the vote, pressed by whoever of his people thinks worst of him. A minor
 * accusation stays a rumour. The seed handed on to the orchestrator says the
 * charge is already brought, so it decides what of rather than bringing it twice.
 */
export function accuseInEarnest<S extends Pick<NarratorSeed, "archetype" | "severity" | "target" | "brief">>(world: WorldState, seed: S, playerCharacterId: string | null, day: number): { world: WorldState; facts: FactProposalDraft[]; seed: S } {
  const untouched = { world, facts: [] as FactProposalDraft[], seed };
  if (playerCharacterId === null || seed.archetype !== "accusation" || seed.severity === "minor" || seed.target.characterId !== playerCharacterId) return untouched;
  if (!difficultyRules(world.difficulty).accusationsInEarnest) return untouched;
  const player = world.characters.find((character) => character.id === playerCharacterId && character.alive);
  if (player?.polityId == null) return untouched;
  const brought = prosecutionOf(world, player.id, player.polityId, [{ label: "a charge his enemies mean to press", weight: seed.severity === "grave" ? 8 : 3 }], day, playerCharacterId, "", 1);
  if (brought === null) return untouched;
  return {
    world: { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, brought.procedure] } },
    facts: [{ localId: `accused_${player.id}_${day}`.slice(0, 60), ...brought.fact }],
    seed: { ...seed, brief: `${seed.brief} The charge is already before the court [${brought.procedure.id}]: decide what it is and whether it is true; do not open another.` },
  };
}

/** Words in an order that threaten the state with arms. */
const THREAT = /\b(march(?:es|ing)? on (?:rome|the city|the capital|carthage|syracuse)|seize (?:the city|the state|power|the government|the forum|the capitol)|overthrow|make (?:myself|me) (?:king|dictator|tyrant|master)|take (?:the city|power) by force|armed (?:men|band|rally|followers) (?:in|into) the forum|threaten the senate|cow the senate|tyranny)\b/i;

/** Days a city remembers that a man threatened it, before a second threat is a second alarm. */
const THREAT_REMEMBERED_DAYS = 60;

/**
 * A public threat against the state, or an armed rally in the city, answered
 * (play-test, the coup run): the city takes fright, the government is decreed
 * to see that the state takes no harm, the men who rule it are pressed to act
 * against him, and he is prosecuted for treason. The attempt itself, if he
 * makes it, is `regime_change` and is settled by `regime.ts`; this is what a
 * city does when a man says he will.
 */
export function answerAThreat(world: WorldState, playerCharacterId: string | null, orderText: string | null, day: number): { world: WorldState; facts: FactProposalDraft[] } {
  if (playerCharacterId === null || orderText === null || !THREAT.test(orderText)) return { world, facts: [] };
  const player = world.characters.find((character) => character.id === playerCharacterId && character.alive);
  if (player?.polityId == null) return { world, facts: [] };
  const polityId = player.polityId;
  const rulers = readDepartments(world).rulers(polityId).filter((ruler) => ruler.alive && ruler.id !== player.id);
  if (rulers.length === 0) return { world, facts: [] };
  const already = world.material.politicalProcedures.some((procedure) => procedure.type === "denunciation" && procedure.subjectId === player.id && procedure.outcome === null && procedure.label.includes("treason")
    && day - procedure.openedAtStep < THREAT_REMEMBERED_DAYS);
  if (already) return { world, facts: [] };
  const polity = world.map.polities.find((candidate) => candidate.id === polityId)?.name ?? polityId;
  const armed = armiesLedBy(world, player.id, polityId).length > 0;
  // The men who rule it think the worse of him for it, and are pressed to act.
  let next = remember(world, rulers.map((ruler) => ({
    subjectCharacterId: ruler.id, targetCharacterId: player.id, label: `He threatened ${polity} with ${armed ? "his army" : "violence"}.`, score: -20, dimensions: { trust: -40, fear: armed ? 25 : 5 },
  })), day, `threat:${player.id}:${day}`);
  for (const ruler of rulers) {
    const pressed = createPressure(next, {
      id: boundedId("defend-the-state", ruler.id, player.id, day), characterId: ruler.id, kind: "political_danger", intensity: armed ? 85 : 60,
      label: `${player.name} [${player.id}] threatens the state${armed ? " and has an army" : ""}: the decree is that ${ruler.name} see that ${polity} takes no harm`.slice(0, 200),
      sourceEventId: null, atStep: day, reviewInSteps: 3, expiresInSteps: 90, visibility: "polity",
    });
    next = { ...next, characters: [...pressed.characters], characterPressures: [...pressed.characterPressures] };
  }
  const facts: FactProposalDraft[] = [{
    localId: `threat_${player.id}_${day}`.slice(0, 60), kind: "state_threatened",
    summary: `${player.name} has threatened ${polity}${armed ? " at the head of an army" : ""}. The city is in alarm; its government is decreed to see that the state takes no harm, and ${rulers.map((ruler) => ruler.name).join(" and ")} must answer it.`.slice(0, 600),
    affectedRefs: [{ kind: "character", id: player.id }, { kind: "polity", id: polityId }, ...rulers.slice(0, 2).map((ruler) => ({ kind: "character" as const, id: ruler.id }))],
    visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 75,
  }];
  // And he is charged with treason by whoever now thinks worst of him.
  const brought = prosecutionOf(next, player.id, polityId, [{ label: `treason, for threatening ${polity}${armed ? " with an army" : ""}`, weight: armed ? 10 : 8 }], day, playerCharacterId, "", 1);
  if (brought !== null) {
    next = { ...next, material: { ...next.material, politicalProcedures: [...next.material.politicalProcedures, brought.procedure] } };
    facts.push({ localId: `treason_${player.id}_${day}`.slice(0, 60), ...brought.fact });
  }
  return { world: next, facts };
}
