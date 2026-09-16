import { z } from "zod";
import { CognitionOutputSchema, formatWorldDate, type CognitionOutput, type ScenarioClock, type WorldState } from "@chronica/shared";
import type { RoutedActor } from "./attention";
import type { SimModelPort } from "./ports";

/**
 * NPC cognition (VISION §28).
 *
 * One batched call answers for every actor the router selected, and each actor's
 * section of the prompt is built *only* from what that actor knows: the facts
 * `factsVisibleTo` let them see, their own pressures, commitments and
 * relationships. Never the world slice, and never each other's secrets.
 *
 * That restriction is the whole point. Handing one model the omniscient world
 * and asking it to "play" several characters produces one narrator wearing
 * masks, which is precisely what §28 says to avoid -- and it leaks: a general
 * who has not been told of the treaty starts acting as though he had.
 *
 * The answer comes back in the *same* proposal shape the orchestrator uses, so
 * an NPC and the player act through one action language (VISION §10).
 */

const OUTPUT_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(CognitionOutputSchema, { io: "input" }));

export const COGNITION_SYSTEM_PROMPT = `You are several people in a historical world, reasoning separately.

You will be given one section per person. Each section contains only what that
person currently knows. Treat it as the whole of their knowledge: if something is
not in their section, they have not heard it, and they must not act on it. Two
people in this batch may hold contradictory beliefs, and both are right to act on
their own.

For each person, decide what they actually do now — if anything. Most people, most
of the time, do nothing of consequence, and answering "nothing" is a real answer:
return them with an empty "deltas" list and say why in "reasoning".

Someone may act within their authority, beyond it, or against it. A general may
march without orders; an official may quietly divert funds; a senator may begin
opposing the very policy they were told to support. None of these are invalid. They
are what makes the world political. Where someone acts outside their authority, do
it anyway and record it honestly as a fact.

The same engine rules apply as elsewhere:

- Never invent an id. Use "localId" for anything new, "local:<localId>" to refer
  back to it, and the ids given to you for anything that exists.
- Express time as a whole number of days from now, never as a date.
- State changes, never running totals.
- Mark anything done in secret with visibility "private", and news that has to
  travel with discovery "delayed" or "rumoured" plus "knowableInDays".
- Score each fact's "significance" from 0 to 100 by how much a historian would care.

Answer with a single JSON object and nothing else, matching this schema:

${OUTPUT_JSON_SCHEMA}`;

export interface CognitionResult {
  readonly output: CognitionOutput;
  readonly calls: number;
  readonly parseFailure: string | null;
}

/** One actor's section: their situation, as they alone understand it. */
function renderActor(actor: RoutedActor, world: WorldState, clock: ScenarioClock): string {
  const character = world.characters.find((candidate) => candidate.id === actor.characterId);
  const name = (id: string): string => world.characters.find((candidate) => candidate.id === id)?.name ?? id;
  const lines: string[] = [`## ${actor.name} [${actor.characterId}]`];

  if (character !== undefined) {
    lines.push(`Office: ${character.officeId ?? "none"}. Polity: ${character.polityId ?? "none"}.`);
    if (character.traits.length > 0) lines.push(`Traits: ${character.traits.join(", ")}.`);
  }
  lines.push(`Why they are paying attention: ${actor.why}.`);

  const beliefs = world.characterBeliefs.filter((belief) => belief.holderCharacterId === actor.characterId).slice(0, 8);
  if (beliefs.length > 0) lines.push("They believe:", ...beliefs.map((belief) => `  - ${belief.claim}`));

  const pressures = world.characterPressures.filter((pressure) => pressure.characterId === actor.characterId && pressure.status === "active").slice(0, 6);
  if (pressures.length > 0) lines.push("Under pressure:", ...pressures.map((pressure) => `  - ${pressure.kind} (${pressure.intensity}/100): ${pressure.label}`));

  const commitments = world.commitments
    .filter((commitment) => commitment.promisorCharacterId === actor.characterId && commitment.status === "pending")
    .slice(0, 6);
  if (commitments.length > 0) {
    lines.push("They have promised:", ...commitments.map((commitment) => `  - to ${name(commitment.beneficiaryCharacterId)}: ${commitment.description}`));
  }

  const owed = world.orderAttempts.filter(
    (attempt) => attempt.recipientRef.id === actor.characterId && (attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed"),
  );
  if (owed.length > 0) {
    lines.push("Orders awaiting their answer:", ...owed.map((attempt) => `  - [${attempt.id}] from ${name(attempt.issuerRef.id)} — lawful: ${attempt.authorityCheck.authorized}`));
  }

  lines.push("What they know of recent events:", ...actor.knownFacts.map((fact) => `  - ${fact.summary}`));
  lines.push(`Today is ${formatWorldDate(world.instant, clock)}.`);
  return lines.join("\n");
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in the response");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

const EMPTY: CognitionOutput = { actors: [] };

export async function runCognition(
  port: SimModelPort,
  actors: readonly RoutedActor[],
  world: WorldState,
  clock: ScenarioClock,
): Promise<CognitionResult> {
  if (actors.length === 0) return { output: EMPTY, calls: 0, parseFailure: null };

  const userMessage = actors.map((actor) => renderActor(actor, world, clock)).join("\n\n");
  try {
    const raw = await port.complete("simulate_cognition", COGNITION_SYSTEM_PROMPT, userMessage);
    const parsed = CognitionOutputSchema.safeParse(extractJson(raw));
    if (parsed.success) return { output: parsed.data, calls: 1, parseFailure: null };
    // No repair retry here, unlike orchestration. A failed orchestration means
    // the player's order goes unanswered; a failed cognition only means nobody
    // reacted this iteration, which the world can absorb silently.
    return { output: EMPTY, calls: 1, parseFailure: parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  } catch (error) {
    return { output: EMPTY, calls: 1, parseFailure: error instanceof Error ? error.message : String(error) };
  }
}
