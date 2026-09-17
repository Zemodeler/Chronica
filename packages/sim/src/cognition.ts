import { z } from "zod";
import {
  CognitionOutputSchema,
  TRAIT_REGISTRY,
  deriveRelationDimension,
  formatWorldDate,
  outlookFor,
  queryBeliefs,
  relationshipLabelFor,
  type Character,
  type CognitionOutput,
  type ScenarioClock,
  type WorldState,
} from "@chronica/shared";
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

- Never invent an id. Every person, force and place already in your section is
  named with its id in square brackets -- use exactly that, including for
  yourself. "local:" belongs only to something you are creating in this very
  answer; writing "local:hanno-carthage" for a person who already exists names
  nobody, and the act is discarded.
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

/**
 * How much of a person reaches their own prompt.
 *
 * Each of these is a cap, not a target. The batched cognition call carries
 * several people at once, so a section that grows by ten lines grows the call by
 * thirty, and a prompt nobody can hold in view is worse than a thin one.
 */
const ACTOR_CAPS = { beliefs: 8, pressures: 6, commitments: 6, relations: 6, ambitions: 4, arrangements: 3, drives: 3, skills: 3 } as const;

/** Scores at the ends of the scale say something; a 50 says nothing worth a line. */
const NOTABLE_HIGH = 65;
const NOTABLE_LOW = 35;

const TEMPERAMENT_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  boldness: ["timid", "bold"],
  caution: ["reckless", "cautious"],
  honesty: ["deceitful", "honest"],
  sociability: ["withdrawn", "sociable"],
  discipline: ["undisciplined", "disciplined"],
  cruelty: ["merciful", "cruel"],
};

const DRIVE_WORDS: Readonly<Record<string, string>> = {
  security: "their own safety",
  status: "standing and honour",
  wealth: "wealth",
  family: "their family",
  faith: "faith",
  duty: "duty",
  revenge: "revenge",
};

const SKILL_WORDS: Readonly<Record<string, string>> = {
  martial: "war",
  intrigue: "intrigue",
  learning: "learning",
  piety: "religion",
  stewardship: "administration",
  diplomacy: "diplomacy",
  body: "physical endurance",
};

/** The way this character is spoken of, from their traits -- labels, never raw ids. */
function describeTraits(character: Character): string[] {
  const lines: string[] = [];
  const named = character.traits.map((id) => TRAIT_REGISTRY[id]?.label ?? id);
  if (named.length > 0) lines.push(`Known for: ${named.join(", ")}.`);
  const guidance = character.traits
    .map((id) => TRAIT_REGISTRY[id]?.dialogueGuidance)
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, 3);
  if (guidance.length > 0) lines.push(...guidance.map((entry) => `  - ${entry}`));
  return lines;
}

/**
 * The mind (VISION §11).
 *
 * Every field here has existed on `Character` from the start and none of it was
 * ever printed, so cognition was answering for people it had been told nothing
 * about beyond their office -- and produced uniformly sensible strategists
 * instead of the timid, greedy, vengeful people the world actually contains.
 */
function describeMind(character: Character): string[] {
  const lines: string[] = [];
  const { mind } = character;

  const nature = Object.entries(mind.temperament)
    .map(([dimension, score]) => {
      const words = TEMPERAMENT_WORDS[dimension];
      if (words === undefined) return null;
      if (score >= NOTABLE_HIGH) return words[1];
      if (score <= NOTABLE_LOW) return words[0];
      return null;
    })
    .filter((word): word is string => word !== null);
  if (nature.length > 0) lines.push(`Nature: ${nature.join(", ")}.`);
  lines.push(`Risk they will take: ${mind.riskTolerance}/100.`);

  const drives = Object.entries(mind.drives)
    .filter(([, score]) => score >= 60)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ACTOR_CAPS.drives)
    .map(([drive]) => DRIVE_WORDS[drive] ?? drive);
  if (drives.length > 0) lines.push(`Driven by: ${drives.join(", ")}.`);

  const label = (id: string): string => TRAIT_REGISTRY[id]?.label ?? id;
  if (mind.values.length > 0) lines.push(`Holds to: ${mind.values.map(label).join(", ")}.`);
  if (mind.taboos.length > 0) lines.push(`Will not: ${mind.taboos.map(label).join(", ")}.`);

  const skills = Object.entries(character.skills)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= 60)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ACTOR_CAPS.skills)
    .map(([skill]) => SKILL_WORDS[skill] ?? skill);
  if (skills.length > 0) lines.push(`Capable at: ${skills.join(", ")}.`);

  const ambitions = character.ambitions.filter((ambition) => ambition.status === "active").slice(0, ACTOR_CAPS.ambitions);
  if (ambitions.length > 0) lines.push("They want:", ...ambitions.map((ambition) => `  - ${ambition.label}`));

  return lines;
}

/**
 * What this person can actually reach.
 *
 * An NPC asked to act with no idea what they command answers in generalities.
 * Every id here is printed because these are the very things they would name in
 * a delta.
 */
function describeMeans(character: Character, world: WorldState): string[] {
  const lines: string[] = [];
  const purse = world.material.accounts.find((account) => account.id === character.personalAccountId);
  if (purse !== undefined) lines.push(`Their purse [${purse.id}] holds ${purse.balance}.`);

  const commanded = world.material.forces.filter(
    (force) => force.commanderCharacterId === character.id || force.controllerCharacterId === character.id,
  );
  if (commanded.length > 0) {
    lines.push(
      "Forces answering to them:",
      ...commanded.map((force) => {
        const fit = force.personnel.reduce((sum, category) => sum + category.fit, 0);
        return `  - ${force.name} [${force.id}] — ${fit} men at ${force.locationId}, morale ${Math.round(force.moraleBps / 100)}/100, ${force.provisionStatus}`;
      }),
    );
  }

  const arrangements = world.genericEntities
    .filter((entity) => entity.ownerRef?.kind === "character" && entity.ownerRef.id === character.id)
    .slice(0, ACTOR_CAPS.arrangements);
  if (arrangements.length > 0) {
    lines.push("Arrangements in their hands:", ...arrangements.map((entity) => `  - ${entity.label} [${entity.id}] (${entity.kind})`));
  }

  return lines;
}

/**
 * How they see the people this situation puts in front of them.
 *
 * Bounded to people already in play: everyone in this batch, anyone they have
 * promised something, and anyone named in what they know. Walking the whole
 * relation list would print a court.
 */
function describeRelations(character: Character, world: WorldState, others: readonly string[], name: (id: string) => string): string[] {
  const candidates = new Set<string>(others);
  for (const commitment of world.commitments) {
    if (commitment.promisorCharacterId === character.id) candidates.add(commitment.beneficiaryCharacterId);
    if (commitment.beneficiaryCharacterId === character.id) candidates.add(commitment.promisorCharacterId);
  }
  for (const relation of character.relations) candidates.add(relation.subjectCharacterId);
  candidates.delete(character.id);

  const rows: string[] = [];
  for (const otherId of candidates) {
    if (rows.length >= ACTOR_CAPS.relations) break;
    const readings = (["trust", "affection", "fear", "respect"] as const)
      .map((dimension) => ({ dimension, score: deriveRelationDimension(character, otherId, dimension) }))
      // A neutral reading is the absence of an opinion; printing it would make
      // strangers look like considered judgements.
      .filter((reading) => Math.abs(reading.score) >= 30)
      .map((reading) => relationshipLabelFor(reading.dimension, reading.score));
    if (readings.length === 0) continue;
    rows.push(`  - ${name(otherId)} [${otherId}]: ${readings.join(", ")}`);
  }
  return rows.length === 0 ? [] : ["How they see others:", ...rows];
}

/** One actor's section: their situation, as they alone understand it. */
function renderActor(actor: RoutedActor, world: WorldState, clock: ScenarioClock, others: readonly string[]): string {
  const character = world.characters.find((candidate) => candidate.id === actor.characterId);
  const name = (id: string): string => world.characters.find((candidate) => candidate.id === id)?.name ?? id;
  const lines: string[] = [`## ${actor.name} [${actor.characterId}]`];

  if (character !== undefined) {
    lines.push(`Office: ${character.officeId ?? "none"}. Polity: ${character.polityId ?? "none"}.`);
    lines.push(...describeTraits(character));
    lines.push(...describeMind(character));
    lines.push(...describeMeans(character, world));

    // Their own government's aims, never a foreign power's. A rival's outlook is
    // what espionage exists to win; handing it over here would make the world
    // one mind again.
    const outlook = outlookFor(world.polityOutlooks, character.polityId);
    if (outlook !== undefined) {
      lines.push(
        `What their government is trying to do: ${outlook.primaryObjective} (it will risk ${outlook.riskTolerance}/100).`,
        ...outlook.concerns.map((concern) => `  - worried about ${concern.label}: ${concern.level}`),
        ...outlook.intentions.map((intention) => `  - it means to ${intention}`),
      );
    }
  }
  lines.push(`Why they are paying attention: ${actor.why}.`);

  // Active beliefs only: a superseded belief is what they used to think, and
  // acting on it puts words in the mouth of someone who has already changed
  // their mind. Kind and confidence are printed because a rumour they half
  // credit should not move them like something they witnessed.
  const beliefs = queryBeliefs(world, actor.characterId).slice(0, ACTOR_CAPS.beliefs);
  if (beliefs.length > 0) {
    lines.push("They believe:", ...beliefs.map((belief) => `  - ${belief.claim} (${belief.kind}, ${belief.confidence}/100 sure)`));
  }

  const pressures = world.characterPressures
    .filter((pressure) => pressure.characterId === actor.characterId && pressure.status === "active")
    .slice(0, ACTOR_CAPS.pressures);
  if (pressures.length > 0) lines.push("Under pressure:", ...pressures.map((pressure) => `  - ${pressure.kind} (${pressure.intensity}/100): ${pressure.label}`));

  const commitments = world.commitments
    .filter((commitment) => commitment.promisorCharacterId === actor.characterId && commitment.status === "pending")
    .slice(0, ACTOR_CAPS.commitments);
  if (commitments.length > 0) {
    lines.push("They have promised:", ...commitments.map((commitment) => `  - to ${name(commitment.beneficiaryCharacterId)}: ${commitment.description}`));
  }

  if (character !== undefined) lines.push(...describeRelations(character, world, others, name));

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

  const inBatch = actors.map((actor) => actor.characterId);
  const userMessage = actors.map((actor) => renderActor(actor, world, clock, inBatch)).join("\n\n");
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
