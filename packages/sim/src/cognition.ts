import { z } from "zod";
import {
  CognitionOutputSchema,
  LEVERS,
  STANDARD_LEVERS,
  readDepartments,
  LOOSE_COHESION_BPS,
  TRAIT_REGISTRY,
  cohesionInWords,
  alliesLedBy,
  DICTATE_AT,
  warStanding,
  enemiesOf,
  groundToRetake,
  hopsBetween,
  isDelivered,
  estimateMen,
  warsOf,
  standingInWords,
  abortsTheTurn,
  isTimeout,
  deriveRelationDimension,
  formatWorldDate,
  openStorylines,
  outlookFor,
  queryBeliefs,
  relationshipLabelFor,
  currentAgeYears,
  injuriesOf,
  isAilment,
  type Character,
  type CognitionOutput,
  type ScenarioClock,
  type WorldState,
} from "@chronica/shared";
import type { RoutedActor } from "./attention";
import { answersAnOrder, assessExecution } from "./delegation";
import { isOpenIntent, mostPressingFirst } from "./intents";
import { dropMalformedEntries, extractJson } from "./json";
import { kindsIn, readLeniently } from "./bare-refs";
import type { SimModelPort } from "./ports";
import { ruleInWords } from "./mechanics/mechanic-words";
import { describePlans } from "./plans";

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

/**
 * The schema the model is shown, without the prose nothing needs. `reasoning`
 * and the proposal's `narrativeSummary` stay in the schema that parses (an
 * answer that has them is still good) but are not asked for: the facts already
 * say what happened, and each is worth a sentence or two per person, per call.
 */
function shownSchema(): string {
  const schema = z.toJSONSchema(CognitionOutputSchema, { io: "input" }) as Record<string, unknown>;
  const actor = (schema.properties as { actors?: { items?: { properties?: Record<string, unknown>; required?: string[] } } } | undefined)?.actors?.items;
  if (actor?.properties !== undefined) delete actor.properties.reasoning;
  const proposal = actor?.properties?.proposal as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (proposal?.properties !== undefined) delete proposal.properties.narrativeSummary;
  if (proposal?.required !== undefined) proposal.required = proposal.required.filter((key) => key !== "narrativeSummary");
  if (actor?.required !== undefined) actor.required = actor.required.filter((key) => key !== "reasoning");
  return JSON.stringify(schema);
}

const OUTPUT_JSON_SCHEMA = shownSchema();

/** The lists that belong inside a proposal, and that a model keeps putting beside one. */
const PROPOSAL_LISTS = ["deltas", "facts", "delegations", "schedule", "discoveries", "socialEvents"] as const;

/**
 * Ops a model writes as a key of the proposal rather than as a delta in it.
 *
 * `social_events` was the first: it reads like a field because every other
 * thing named in the same breath -- `relationCauses`, `observedTraits` -- *is*
 * a field. A batch of four people's answers was lost to it in a live game, all
 * four of them correct in substance.
 *
 * `storyline_advance` is the same mistake and was measured making it: two
 * bursts in a row, four people each, every one of them rejected over
 * `Unrecognized key: "storyline_advance"` and every one repaired at full price.
 * The prompt asks for it in the same breath as `storylineRef`, which really is
 * a field on a fact, so the confusion is the prompt's own doing.
 *
 * The flag says whether the op carries a list of its own: `social_events`
 * wraps its contents in `events`, and everything else is a plain delta whose
 * fields sit at the top level.
 */
const MISPLACED_OPS: Readonly<Record<string, { readonly wrapsEvents: boolean }>> = {
  social_events: { wrapsEvents: true },
  storyline_advance: { wrapsEvents: false },
};

/**
 * Puts a proposal's own lists back inside the proposal.
 *
 * Cognition answers in the same shape the orchestrator does, and the shape the
 * orchestrator answers in has `facts`, `delegations` and `schedule` at the top
 * level. So a model writing for several people sometimes hoists them there --
 * and the schema is strict, so the whole answer was thrown away over a
 * nesting level, with nothing kept and nothing retried. A live game lost a
 * season to it: three people had been asked what they were doing, all three
 * had answered at length, and the world recorded nothing at all.
 *
 * A stray list beside an actor's own `proposal` is unambiguous and is folded
 * into it. A stray list at the root belongs to nobody in particular, so it is
 * folded in only when there is exactly one actor to fold it into -- guessing
 * which of five people said a thing would put words in somebody's mouth, and
 * a fact carries its author's visibility with it.
 */
export function foldStrayProposalKeys(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const root = { ...(value as Record<string, unknown>) };
  if (!Array.isArray(root.actors)) return root;

  const drain = (from: Record<string, unknown>, into: Record<string, unknown>): void => {
    for (const key of PROPOSAL_LISTS) {
      if (!Array.isArray(from[key])) continue;
      const already = Array.isArray(into[key]) ? (into[key] as unknown[]) : [];
      into[key] = [...already, ...(from[key] as unknown[])];
      delete from[key];
    }
  };

  // A person written as a bare sentence is not a person. Before this, one such
  // entry failed `actors.1: expected object, received string` and took the
  // other five people's answers with it.
  const people = (root.actors as unknown[]).filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry));

  const actors = people.map((entry): unknown => {
    const actor = { ...(entry as Record<string, unknown>) };
    const proposal = typeof actor.proposal === "object" && actor.proposal !== null && !Array.isArray(actor.proposal)
      ? { ...(actor.proposal as Record<string, unknown>) }
      : {};
    drain(actor, proposal);
    // A plan is the person's, not an act of the proposal, and the proposal is
    // strict: written one level down it would cost the whole answer.
    for (const key of ["plan", "stepsTaken"] as const) {
      if (proposal[key] !== undefined && actor[key] === undefined) actor[key] = proposal[key];
      delete proposal[key];
    }
    // An op written as a key of the proposal is still that op. Put it back in
    // the deltas where it belongs rather than losing the whole answer to it.
    for (const [op, shape] of Object.entries(MISPLACED_OPS)) {
      const stray = proposal[op] ?? actor[op];
      if (stray === undefined || stray === null) continue;
      delete proposal[op];
      delete actor[op];
      const deltas = Array.isArray(proposal.deltas) ? [...(proposal.deltas as unknown[])] : [];
      const entries = Array.isArray(stray) ? stray : [stray];
      for (const entry of entries) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
        const asDelta = entry as Record<string, unknown>;
        if (!shape.wrapsEvents) { deltas.push({ op, ...asDelta }); continue; }
        // Either "{events: [...]}" or a bare list of events; both are meant.
        deltas.push(Array.isArray(asDelta.events) ? { op, ...asDelta } : { op, events: [asDelta] });
      }
      proposal.deltas = deltas;
    }
    // The actor's own "reasoning", written one level down inside the proposal
    // -- either under that name or as "reason". The proposal schema is strict,
    // so four people's complete answers were rejected, twice in one evening's
    // play, over the placement of a field that is kept for inspection and
    // never applied to anything.
    const strayReason = proposal.reasoning ?? proposal.reason ?? actor.reason;
    delete proposal.reasoning;
    delete proposal.reason;
    delete actor.reason;
    if (actor.reasoning === undefined && typeof strayReason === "string") actor.reasoning = strayReason;

    // And a delta, fact or scheduled event written as a bare line is not one.
    // Dropping it keeps everything the same answer got right.
    actor.proposal = dropMalformedEntries(proposal, PROPOSAL_LISTS);
    return actor;
  });

  if (actors.length === 1 && typeof actors[0] === "object" && actors[0] !== null) {
    const only = actors[0] as Record<string, unknown>;
    drain(root, only.proposal as Record<string, unknown>);
  }
  for (const key of PROPOSAL_LISTS) delete root[key];

  return { ...root, actors };
}

export const COGNITION_SYSTEM_PROMPT = `You are several people in a historical world, reasoning separately.

You will be given one section per person. Each section contains only what that
person currently knows. Treat it as the whole of their knowledge: if something is
not in their section, they have not heard it, and they must not act on it. Two
people in this batch may hold contradictory beliefs, and both are right to act on
their own.

For each person, decide what they actually do now — if anything. Most people, most
of the time, do nothing of consequence, and "nothing" is a real answer: leave them
out of "actors" altogether. An entry saying nobody did anything costs as much to
write as one that did something, and changes nothing.

That is the answer for someone reacting to news. It is rarely the answer for
someone whose section says nobody has brought them news: they are in the batch
because they have a war to press, a promise to keep, a city to hold or a rival to
manage, and a month of their own is not nothing. Move their business on by a step
they could actually take from where they stand -- an act the world takes: an
army moved or engaged, a letter sent, money spent, a man hired, a question put
to a chamber -- with the fact that says it happened beside it. Reviewing,
maintaining, reaffirming and waiting for reports change nothing; an answer of
only those is "nothing", and a step is not done by it. They are not waiting for the ruler; they do not know
what the ruler is doing. Business that will take months is a plan: give it in
"plan" as up to four steps in order, each an act of that kind, with the days
by which it should be done and, if it must wait for something, "when". A step
they carry out in this answer goes in "stepsTaken" by its id, and so does a promise they keep; one shown as
missed means the plan has fallen behind, and they carry on late, lay it again,
or give it up. What their government means to do is somebody's to carry out,
and if it is theirs -- their office, their army -- it is their plan.

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
  travel with discovery "delayed" or "rumoured" plus "knowableInDays". A private
  fact lists in "knownToRefs" exactly who knows it -- yourself and whoever was
  there.
- A matter under "Caught up in" is theirs to move, and moving it is a real
  answer: record the step as a fact with its "storylineRef", and advance the
  thread with "storyline_advance".
- Score each fact's "significance" from 0 to 100 by how much a historian would care.
- A fact is something that happened, never a condition that obtains and never
  something expected. "Holding the province rather than advancing" is a posture,
  "is expected to answer" is a diary entry: neither happened. If nothing
  happened, write no fact. Say what was done, never what was not: "without
  conceding allegiance", "made no pledge", "ordered no attack" are not things
  anybody did.
- Someone who sets out to find something out, and succeeds, records it in
  "discoveries" -- the fact already existed; what changed is that they now know
  it. Someone who sets out to deceive uses "belief_set" on the person they are
  deceiving. A belief is never checked against the truth.
- An army can only fight what it is standing next to. To attack, step it into
  the enemy's province with "force_modify" and engage in the same answer; if
  the enemy is further off, send it there with "force_modify" anyway -- it sets
  out, and arrives when the road has been walked. An engagement between two
  provinces is refused, and the attack simply does not happen.
- Two powers at peace do not fight. Declaring the war is a decision somebody
  takes, with "agreement_open"; an engagement without it is refused. A war
  ends by terms one side offers ("peace_offer", its "clauses") and the other
  accepts; the side the war has gone for may dictate them.
- Ground taken is said with "province_control_set", and only for a province you
  have an army standing in or one next to ground your power already holds. A
  walled city is besieged with "siege_lay" by an army standing in its province;
  the engine starves it and says when it falls.
- Someone who raises a province against its ruler and holds it has founded a
  country: "polity_create", taking the ground from the power it breaks from.
  Riots are not a country, and neither is a claimant who wants the throne that
  already exists.
- Water is crossed in ships. An army at a strait needs a fleet of its own power
  standing with it, and the fleet crosses with it. Ships and armies do not give
  battle to each other.
- You do not decide who wins. Propose the engagement; the casualties, the rout
  and the ground are the engine's, and final.
- At a death, a victory, an oath, a refusal somebody will remember, a speech
  in a council, a person says something worth writing down. Put it in
  "utterance": their own words, under twenty, laconic and concrete -- the line
  men repeated afterwards, never a slogan -- with the occasion; a
  speaker in a chamber puts them in the "words" of "political_support_set".
  Routine business leaves it null.
- Dealing with somebody changes what you think of them. Where this turn put
  two people in the same room, on the same order or on opposite sides of a
  refusal, record it as a delta in "deltas" with "op": "social_events" -- it
  is a delta like any other, not a field of the proposal. Its "events" name
  both people in "participantCharacterRefs", and "relationCauses" gives one
  entry per direction that changed, scored -20 to 20 with the dimensions it
  moves (trust, respect, fear, affection, obligation). A season in which
  nobody's opinion of anybody moved is a season nobody lived through.
- And where somebody has now seen enough of another person to say what they
  are like, put it in that same event's "observedTraits": the person judged,
  the person judging, and one of cautious, bold, ambitious, dutiful, vengeful,
  sociable, disciplined, deceitful, compassionate, cruel -- those ten words
  and no others. Say only what this person actually saw. It takes two
  different people to make it true, so one opinion is an opinion, and that is
  deliberate.
- Something they have found out that somebody did without the authority to do
  it is theirs to make of what they will. They may sit on it, tell somebody
  ("belief_set"), demand an accounting, or put it to the body that can judge it
  ("political_procedure_open"). Whatever they do, write what *they* did as a
  fact in their own words: the ledger entry that caught it is not the event, and
  a man saying so is.
- An order or a request put to them is theirs to answer: "order_attempt_decide",
  naming it and saying why in their own words. "accept" means they do it -- so
  actually do it, in the same answer, with the deltas it takes. "refuse",
  "delay" and "ignore" are real answers, and the right ones when the man asking
  has no standing to command them, or when obeying would cost them more than
  refusing. "subvert" is appearing to comply and doing otherwise. Answer every
  one of them: an order left unanswered is simply put to them again next time.
  A refusal is an event, and the man who gave the order will hear of it.
- A letter put to them is theirs to answer: "diplomatic_message_answer", naming
  the letter, accepting, refusing or countering it, and saying why in their own
  words. Answer it as the person who received it, weighing what it would cost
  them -- not as the power that sent it would like. Accepting an offer makes
  the agreement it offered; where it offered more than one, name the one taken
  in "agreementKind". To counter, answer
  "countered" and send a letter back with "diplomatic_message_send" in the same
  breath, naming the original in "inReplyToRef". They may also write first, to
  anyone they have reason to.

Answer with a single JSON object and nothing else, matching this schema:

${OUTPUT_JSON_SCHEMA}`;

export interface CognitionResult {
  readonly output: CognitionOutput;
  readonly calls: number;
  readonly parseFailure: string | null;
  /** What was dropped to make an otherwise good answer parse, without a call. */
  readonly salvaged: readonly string[];
}

/**
 * How much of a person reaches their own prompt.
 *
 * Each of these is a cap, not a target. The batched cognition call carries
 * several people at once, so a section that grows by ten lines grows the call by
 * thirty, and a prompt nobody can hold in view is worse than a thin one.
 */
const ACTOR_CAPS = { beliefs: 8, pressures: 6, commitments: 6, relations: 6, ambitions: 4, arrangements: 3, drives: 3, skills: 3, storylines: 2, intents: 3 } as const;

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

const SUBSKILL_WORDS: Readonly<Record<string, string>> = {
  strategist: "choosing the field of battle", authority: "holding men to their duty", espionage: "spies and informers", manipulation: "working on people",
  rhetoric: "speaking in public", arbitration: "settling quarrels and refusing without offence", logistics: "feeding and moving armies", taxation: "the tax roll",
  theology: "the gods' law", scholarship: "letters and building", devotion: "the gods' favour", rites: "the rites", endurance: "hardship and sickness", prowess: "fighting hand to hand",
};

/**
 * What he is in charge of, and how it goes (docs/plans/departments.md): the
 * work his power's gifts are his gifts for, whether he holds too much of it
 * to do any of it well, and what men say of the departments he sits in.
 * Printed only where there is something to say, since it is carried for
 * every person in the batch.
 */
function describeCharge(character: Character, world: WorldState): string[] {
  if (character.polityId === null) return [];
  const reader = readDepartments(world);
  const scope = { kind: "polity" as const, id: character.polityId };
  const held = STANDARD_LEVERS.filter((lever) => reader.holding(scope, lever).people.some((person) => person.id === character.id));
  const lines: string[] = [];
  if (held.length > 0) {
    const by = new Map<string, string[]>();
    for (const lever of held) {
      const department = reader.holding(scope, lever).department;
      const key = department === null ? "as head of state" : `in ${department.name}`;
      by.set(key, [...(by.get(key) ?? []), LEVERS[lever].words]);
    }
    lines.push(`In charge of: ${[...by.entries()].map(([where, work]) => `${work.join(", ")} (${where})`).join("; ")}.`);
  }
  const load = reader.workload(character.id);
  if (load <= -9) lines.push("Holds more than one man can do well: every part of it suffers until he hands some of it to others.");
  else if (load < 0) lines.push("Stretched: holds a little more than he can do well.");
  const talked = world.departments.filter((department) => department.abolishedAtStep === null && department.rumouredAtStep !== null
    && world.elapsedStep - department.rumouredAtStep <= 180 && department.scope.id === character.polityId);
  if (talked.length > 0) lines.push(`Men say less reaches ${talked.map((department) => department.name).join(" and ")} than the rolls promise.`);
  // A gift that has gone.
  const faded = Object.entries(character.skillRecord?.peaks ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= 70 && entry[1] - ((character.skills.subSkills as Record<string, number | undefined>)[entry[0]] ?? entry[1]) >= 10)
    .slice(0, 2)
    .map(([skill]) => SUBSKILL_WORDS[skill] ?? skill);
  if (faded.length > 0) lines.push(`Once had a gift for ${faded.join(" and ")}, which age or disuse has worn down.`);
  return lines;
}

/** The way this character is spoken of, from their traits -- labels, never raw ids. */
/**
 * How old he is and how he is in body: what the player was never told of
 * himself, and what an old man or a wounded one has to answer as. One line,
 * silent on health for anybody sound.
 */
function describeBody(character: Character, world: WorldState): string {
  const parts: string[] = [];
  const health = character.healthBps >= 8_000 ? null
    : character.healthBps >= 5_000 ? "in indifferent health"
      : character.healthBps >= 2_500 ? "in poor health" : "gravely unwell";
  if (health !== null) parts.push(health);
  if (character.disqualifyingStatuses.includes("incapacitated")) parts.push("ill, and keeping to the house");
  const ailments = character.disqualifyingStatuses.filter(isAilment);
  if (ailments.length > 0) parts.push(`suffering from ${ailments.join(", ")}`);
  parts.push(...injuriesOf(character).map((injury) => injury.label));
  return `Age ${currentAgeYears(character, world.elapsedStep)}${parts.length === 0 ? "" : `; ${parts.join("; ")}`}.`;
}

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
  // The finer gifts that stand out -- only where written, and only the ones
  // the engine reads, so what the world says of a man is what his acts do.
  const gifts = Object.entries(character.skills.subSkills ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && (entry[1] >= 70 || entry[1] <= 30))
    .sort((a, b) => Math.abs(b[1] - 50) - Math.abs(a[1] - 50))
    .slice(0, 3)
    .map(([skill, value]) => `${value >= 70 ? "a gift for" : "no hand at"} ${SUBSKILL_WORDS[skill] ?? skill}`);
  if (gifts.length > 0) lines.push(`In particular: ${gifts.join("; ")}.`);

  // What they actually reach for, which is not the same as what they are good
  // at. "Capable at: intrigue" is a fact about a man; naming the operation it
  // reaches for is what makes him use it. Two at most, and only where
  // something is clearly dominant, because this is carried for every person in
  // the batch and most people have no signature instrument at all.
  const instruments: string[] = [];
  if (mind.drives.wealth >= 65 || (character.skills.stewardship ?? 0) >= 70) {
    instruments.push('money, moved where it obliges somebody -- "money_transfer", "loan_open"');
  }
  if ((character.skills.intrigue ?? 0) >= 70) instruments.push('what others would rather was not known -- agents, "discoveries", "belief_set"');
  if ((character.skills.diplomacy ?? 0) >= 70) instruments.push('other powers, written to directly with "diplomatic_message_send"');
  if ((character.skills.martial ?? 0) >= 70) instruments.push("the men they command, and what an army lets a man ask for");
  if (instruments.length > 0) lines.push(`What they reach for first: ${instruments.slice(0, 2).join("; ")}.`);

  // And what they will not do, which is most of what makes somebody a person
  // in particular rather than a competent actor.
  if (mind.temperament.cruelty <= 30) {
    lines.push("They will not get at a man through his family, or through people who have done nothing. That is a line they keep, not squeamishness.");
  } else if (mind.temperament.cruelty >= 70) {
    lines.push("They see no reason to spare a man's household or the people who depend on him, if that is where he is reachable.");
  }

  return lines;
}

/**
 * What this person can actually reach.
 *
 * An NPC asked to act with no idea what they command answers in generalities.
 * Every id here is printed because these are the very things they would name in
 * a delta.
 */
const placeOf = (world: WorldState, provinceId: string): string =>
  `${world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId} [${provinceId}]`;

/** How far an enemy may be and still be something a commander has to answer. */
const ENEMY_NEAR_HOPS = 2;

/**
 * The wars their power is in, and the enemy close enough to matter.
 *
 * Nobody was ever told. Carthage had been at war with Rome for four months and
 * its admiral kept "watch over the strait"; the Campanians of Rhegium had been
 * at war with Rome since the first day and their leader reviewed the walls
 * fifteen times. A portrait listed a man's own army by a location id and never
 * mentioned that there was a war, or who was in it, or where.
 *
 * Armies within two provinces are the kind of thing scouts, merchants and
 * rumour make known; further off, what they know is what they have been told.
 */
function describeWars(character: Character, world: WorldState): string[] {
  if (character.polityId === null) return [];
  const polityId = character.polityId;
  const enemies = enemiesOf(world.polityAgreements, polityId);
  if (enemies.length === 0) return [];
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const lines = warsOf(world.polityAgreements, polityId).map((enemy) => {
    const war = world.polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active"
      && [agreement.polityId, agreement.otherPolityId].includes(polityId) && [agreement.polityId, agreement.otherPolityId].includes(enemy));
    const days = war === undefined ? null : world.elapsedStep - war.sinceStep;
    const allies = alliesLedBy(world.polityAgreements, enemy);
    // How it stands, which is what decides the peace: at 50 the winner dictates.
    const standing = warStanding(world, polityId, enemy);
    const how = standing.dictates ? "they have won it, and may dictate the peace"
      : standing.score <= -DICTATE_AT ? "they have lost it, and must take the terms they are given"
        : standing.score >= 15 ? "it goes well for them" : standing.score <= -15 ? "it goes badly for them" : "it is even";
    return `Their power is at war with ${polityName(enemy)} [${enemy}]${allies.length === 0 ? "" : ", and the allies who follow it"}${days === null ? "" : `, and has been for ${days} days`}${war === undefined ? "" : `: ${war.terms}`}. It stands at ${standing.score} of 100 for them -- ${how}${standing.parts.length === 0 ? "" : ` (${standing.parts.join("; ")})`}.`;
  });
  const own = world.material.forces.filter((force) => force.commanderCharacterId === character.id || force.controllerCharacterId === character.id);
  const from = [...new Set([character.locationProvinceId, ...own.map((force) => force.locationId)].filter((id): id is string => id !== null))];
  const near = world.material.forces
    .filter((force) => enemies.includes(force.polityId))
    .map((force) => ({ force, hops: Math.min(...from.map((here) => hopsBetween(world, here, force.locationId, ENEMY_NEAR_HOPS) ?? Infinity)) }))
    .filter((entry) => entry.hops <= ENEMY_NEAR_HOPS)
    .sort((a, b) => a.hops - b.hops)
    .slice(0, 6);
  // A war nobody is fighting. Rome was at war with the Campanians of Rhegium
  // for five months and no Roman army went near them: the only legions were
  // the consul's in Sicily, and his colleague, told nothing, advocated. A man
  // holding a magistracy of a power at war is told when none of its armies is
  // within reach of the enemy -- raising one, or sending one, is somebody's.
  // A magistracy, not a seat in a council or a priesthood: a senator does not raise legions.
  const magistrate = world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === character.id
    && !/(senat|council|elder|priest|member|assembly)/i.test(seat.officeId));
  if (magistrate) {
    // Armies, not fleets: ships and armies do not give battle to each other.
    const afloat = (force: WorldState["material"]["forces"][number]): boolean => force.personnel.length > 0 && force.personnel.every((group) => /ship|galley|fleet|naval|trireme|quinquereme/i.test(group.categoryId));
    const ours = world.material.forces.filter((force) => force.polityId === polityId && !afloat(force));
    for (const enemy of warsOf(world.polityAgreements, polityId)) {
      const theirs = [
        ...world.map.provinces.filter((province) => province.controllerPolityId === enemy).map((province) => province.id),
        ...world.material.forces.filter((force) => force.polityId === enemy).map((force) => force.locationId),
      ];
      if (theirs.length === 0) continue;
      const inReach = ours.some((force) => theirs.some((place) => (hopsBetween(world, force.locationId, place, ENEMY_NEAR_HOPS) ?? Infinity) <= ENEMY_NEAR_HOPS));
      if (!inReach) lines.push(`No army of their power stands within reach of ${polityName(enemy)}: to raise one or send one against them is the business of whoever may.`);
    }
  }
  // Ground their power lost in the war, and how far their own army is from it.
  for (const lost of groundToRetake(world, polityId).slice(0, 4)) {
    const reach = own.map((force) => ({ force, hops: hopsBetween(world, force.locationId, lost.provinceId, ENEMY_NEAR_HOPS) })).filter((entry) => entry.hops !== null).sort((a, b) => a.hops! - b.hops!)[0];
    lines.push(`Their power lost ${placeOf(world, lost.provinceId)} to ${polityName(lost.holderId)} ${lost.daysAgo} days ago${reach === undefined ? "" : `; ${reach.force.name} is ${reach.hops === 0 ? "there" : reach.hops === 1 ? "one province from it" : `${reach.hops} provinces from it`}`}.`);
  }
  // Sieges their power lays or suffers, with the siege's id for "siege_lift".
  const sieges = world.sieges.filter((siege) => siege.status === "active" && (siege.besiegerPolityId === polityId || siege.defenderPolityId === polityId));
  for (const siege of sieges.slice(0, 4)) {
    const besieger = world.material.forces.find((force) => force.id === siege.forceId)?.name ?? siege.forceId;
    const city = world.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === siege.settlementId)?.name
      ?? world.map.provinces.find((province) => province.id === siege.provinceId)?.name ?? siege.provinceId;
    lines.push(`Siege [${siege.id}]: ${besieger} has besieged ${city} for ${world.elapsedStep - siege.startedAtStep} days, and the city is ${Math.round(siege.pressureBps / 100)}% of the way to yielding.`);
  }
  if (near.length > 0) {
    // Counted as the player's own scouts would count them (`estimateMen`): by
    // eye where they stand in the same province, by report a province or two
    // off -- never the true muster, which a portrait printed to the man.
    lines.push("Enemy forces near them:", ...near.map(({ force, hops }) => {
      const fit = force.personnel.reduce((sum, category) => sum + category.fit, 0);
      const seenThisWeek = Math.floor(world.elapsedStep / 7);
      const count = estimateMen(fit, hops === 0 ? "own_eyes" : "report", 0, [force.id, character.id, seenThisWeek]).label;
      const where = hops === 0 ? "here, in the same province" : hops === 1 ? "one province off" : `${hops} provinces off`;
      return `  - ${force.name} [${force.id}] of ${polityName(force.polityId)} — ${count} at ${placeOf(world, force.locationId)}, ${where}`;
    }));
  }
  return lines;
}

/**
 * What ground their power still holds, where it is little. The Mamertines lost
 * Messana and their spokesman went on seeking "provisions for Messana" for a
 * month, keeping a garrison ready that was three provinces away: nothing told
 * him the city was Rome's.
 */
function describeGround(character: Character, world: WorldState): string[] {
  if (character.polityId === null) return [];
  const held = world.map.provinces.filter((province) => province.controllerPolityId === character.polityId);
  if (held.length === 0) return ["Their power holds no ground at all: its cities and country are in other hands."];
  if (held.length > 4) return [];
  return [`Their power holds only ${held.map((province) => placeOf(world, province.id)).join(", ")}.`];
}

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
        return `  - ${force.name} [${force.id}] — ${fit} men at ${placeOf(world, force.locationId)}, morale ${Math.round(force.moraleBps / 100)}/100, ${force.provisionStatus}`;
      }),
    );
  }

  const arrangements = world.genericEntities
    .filter((entity) => entity.ownerRef?.kind === "character" && entity.ownerRef.id === character.id)
    .slice(0, ACTOR_CAPS.arrangements);
  if (arrangements.length > 0) {
    // With the rule behind each, so a man knows what his racket does.
    lines.push("Arrangements in their hands:", ...arrangements.map((entity) =>
      `  - ${entity.label} [${entity.id}] (${entity.kind})${entity.mechanic === undefined || entity.mechanic.endedAtStep !== null ? "" : `; rule: ${ruleInWords(entity.mechanic, world, entity.id)}`}`));
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
/**
 * Everything a prompt says about one person.
 *
 * Split out of `renderActor` so the world slice can show the *player* the same
 * way cognition shows everyone else. The slice used to carry
 * `{id, name, office, polityId}` and nothing more -- so the world reasoned in
 * detail about a minor Carthaginian admiral and knew nothing whatever about the
 * person whose order it was answering.
 *
 * Reused rather than reimplemented, deliberately: two portraits written twice
 * drift, and the one that drifts is always the player's, because the player is
 * the one nobody is testing the prompt for.
 */
export interface PortraitOptions {
  /** What they know. The slice carries its own RECENT HISTORY, so it omits this. */
  readonly knownFacts?: readonly { readonly id: string; readonly summary: string }[] | undefined;
  /** Why they are being asked. The player is not being asked anything. */
  readonly impetus?: { readonly why: string; readonly ownBusiness: boolean } | undefined;
  /** Other people in view, for the relations block. */
  readonly others?: readonly string[] | undefined;
  /** Appended before the closing line -- where "what this person may do" goes. */
  readonly extra?: readonly string[] | undefined;
  /** The slice prints the date once, at its head. */
  readonly closeWithDate?: boolean | undefined;
}

export function renderCharacterPortrait(
  characterId: string,
  displayName: string,
  world: WorldState,
  clock: ScenarioClock,
  options: PortraitOptions = {},
): string {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  const name = (id: string): string => world.characters.find((candidate) => candidate.id === id)?.name ?? id;
  const lines: string[] = [`## ${displayName} [${characterId}]`];

  if (character !== undefined) {
    lines.push(`Office: ${character.officeId ?? "none"}. Polity: ${character.polityId ?? "none"}. Standing: ${standingInWords(character.prestigeBps)}.`);
    lines.push(describeBody(character, world));
    lines.push(...describeTraits(character));
    lines.push(...describeMind(character));
    lines.push(...describeCharge(character, world));
    // What they want, with the plan for it where they have one. Its own
    // block because a plan needs the calendar, and a mind does not.
    lines.push(...describePlans(character, world, clock, ACTOR_CAPS.ambitions));
    lines.push(...describeMeans(character, world));
    lines.push(...describeWars(character, world));
    lines.push(...describeGround(character, world));

    // What they can actually speak for. A chieftain of a people who never had a
    // centre does not answer for the people; he answers for his own ground and
    // the men who follow him, and a treaty he signs binds him. Told nothing, he
    // answered as though he were a foreign ministry.
    const power = world.map.polities.find((polity) => polity.id === character.polityId);
    if (power !== undefined && power.cohesionBps < LOOSE_COHESION_BPS) {
      const home = world.map.provinces.find((province) => province.id === character.locationProvinceId);
      lines.push(
        `${power.name} ${cohesionInWords(power.cohesionBps)}. They speak for ${home === undefined ? "their own people" : `${home.name} [${home.id}] and the men who follow them`}, not for the whole of it: what they agree to binds them, and the rest of ${power.name} may do otherwise.`,
      );
    }

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
  if (options.impetus !== undefined) {
    lines.push(
      options.impetus.ownBusiness
        ? `Nobody has brought them news. They are here because of their own affairs: ${options.impetus.why}. What do they do about them now?`
        : `Why they are paying attention: ${options.impetus.why}.`,
    );
  }

  // Active beliefs only: a superseded belief is what they used to think, and
  // acting on it puts words in the mouth of someone who has already changed
  // their mind. Kind and confidence are printed because a rumour they half
  // credit should not move them like something they witnessed.
  const beliefs = queryBeliefs(world, characterId).slice(0, ACTOR_CAPS.beliefs);
  if (beliefs.length > 0) {
    lines.push("They believe:", ...beliefs.map((belief) => `  - ${belief.claim} (${belief.kind}, ${belief.confidence}/100 sure)`));
  }

  const pressures = world.characterPressures
    .filter((pressure) => pressure.characterId === characterId && pressure.status === "active")
    .slice(0, ACTOR_CAPS.pressures);
  if (pressures.length > 0) lines.push("Under pressure:", ...pressures.map((pressure) => `  - ${pressure.kind} (${pressure.intensity}/100): ${pressure.label}`));

  // The threads they are in, with what is at stake and what comes next. They
  // used to learn of these only as a reason string -- "is caught up in
  // something already under way" -- which told them nothing they could act on.
  const threads = openStorylines(world.storylines)
    .filter((storyline) => storyline.participantIds.includes(characterId))
    .sort((a, b) => b.updatedAtStep - a.updatedAtStep)
    .slice(0, ACTOR_CAPS.storylines);
  if (threads.length > 0) {
    lines.push("Caught up in:", ...threads.map((storyline) => {
      const lately = storyline.history.length === 0 ? "" : ` Lately: ${storyline.history[storyline.history.length - 1]}`;
      return `  - ${storyline.title} [${storyline.id}] — ${storyline.phase}. At stake: ${storyline.stakes}${lately} What comes next: ${storyline.nextDevelopment}`;
    }));
  }

  const intents = mostPressingFirst(world.characterIntents.filter((intent) => intent.actorCharacterId === characterId && isOpenIntent(intent)))
    .slice(0, ACTOR_CAPS.intents);
  if (intents.length > 0) lines.push("They mean to:", ...intents.map((intent) => `  - ${intent.actionType}: ${intent.rationale}`));

  const commitments = world.commitments
    .filter((commitment) => commitment.promisorCharacterId === characterId && (commitment.status === "pending" || commitment.status === "deferred"))
    .slice(0, ACTOR_CAPS.commitments);
  if (commitments.length > 0) {
    lines.push("They have promised:", ...commitments.map((commitment) => `  - [${commitment.id}] to ${name(commitment.beneficiaryCharacterId)}: ${commitment.description}${commitment.reviewAtStep <= world.elapsedStep ? " (its day has come)" : ""}`));
  }

  if (character !== undefined) lines.push(...describeRelations(character, world, options.others ?? [], name));

  const owed = world.orderAttempts.filter(
    (attempt) => attempt.recipientRef.id === characterId && (attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed"),
  );
  if (owed.length > 0) {
    // What was actually asked, and by somebody with what standing to ask it.
    // This used to print "lawful: true" for every order ever recorded, because
    // that field was a constant -- so a recipient was told, of a merchant's
    // request and a consul's command alike, that it was lawful.
    lines.push("Orders and requests put to them, still unanswered:", ...owed.map((attempt) => {
      const asking = attempt.standing === "binding" ? "" : attempt.standing === "requested" ? " He is asking, not commanding." : " He has no business commanding them.";
      return `  - [${attempt.id}] from ${attempt.authorityCheck.reason}${asking} What he wants: "${attempt.instruction}"`;
    }));
    // What sort of workman is being handed this (VISION §13). Their skills
    // were printed above as "Capable at: ..." and nothing, here or anywhere,
    // said what that meant for work somebody else had asked them to do -- so
    // a corrupt quaestor and an honest one carried out the same order the same
    // way. The engine takes the cost and the delay out of this; the words are
    // here so the answer reads like the man rather than like the order.
    if (character !== undefined) {
      const hand = assessExecution(world, characterId, "fiscal");
      const field = assessExecution(world, characterId, "military");
      const each = [hand, field].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      if (each.length > 0) {
        const answers = answersAnOrder(character);
        lines.push(
          "Carrying out somebody else's business, they are:",
          `  - with money and administration: ${each[0]!.words}`,
          ...(each[1] === undefined ? [] : [`  - with soldiers and campaigns: ${each[1].words}`]),
          // What sort of answer this particular man gives, where his
          // temperament decides it. Silent for the middle of the range, which
          // is most people: they answer as the situation suggests.
          ...(answers === null ? [] : [`  ${answers}`]),
          "  Answer as that man. Doing it badly, slowly, or partly is a real answer, and so is doing it your own way.",
        );
      }
    }
  }

  // Letters put to them or to their government, unanswered. The answer is
  // theirs: a power's reply should come from the person who has to give it,
  // with their own temperament and their own fears, not from the world.
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const letters = world.diplomacy.filter(
    (message) =>
      message.status === "awaiting_reply" && isDelivered(message, world.instant.day) &&
      (message.toCharacterId === characterId || (message.toCharacterId === null && character?.polityId != null && message.toPolityId === character.polityId)),
  );
  const enemyPowers = new Set(character?.polityId == null ? [] : enemiesOf(world.polityAgreements, character.polityId));
  if (letters.length > 0) {
    lines.push(
      "Letters awaiting their answer:",
      // A letter from the enemy says so: a power at war was answered as though
      // the letter came from a neutral, because nothing on it said otherwise.
      ...letters.map((message) => `  - [${message.id}] ${message.kind} from ${polityName(message.fromPolityId)}${enemyPowers.has(message.fromPolityId) ? " (the enemy: their power is at war with it)" : ""}, by ${name(message.fromCharacterId)} — ${message.subject}: ${message.terms}`),
    );
  }

  if (options.knownFacts !== undefined) {
    lines.push("What they know of recent events:", ...options.knownFacts.map((fact) => `  - ${fact.summary} [${fact.id}]`));
  }
  if (options.extra !== undefined && options.extra.length > 0) lines.push(...options.extra);
  if (options.closeWithDate === true) lines.push(`Today is ${formatWorldDate(world.instant, clock)}.`);
  return lines.join("\n");
}

/** One person's section of the batched cognition call. Byte-identical to what it always was. */
function renderActor(actor: RoutedActor, world: WorldState, clock: ScenarioClock, others: readonly string[]): string {
  return renderCharacterPortrait(actor.characterId, actor.name, world, clock, {
    knownFacts: actor.knownFacts,
    impetus: { why: actor.why, ownBusiness: actor.impetus === "own_business" },
    others,
    ...(actor.note === undefined ? {} : { extra: [actor.note] }),
    closeWithDate: true,
  });
}


const EMPTY: CognitionOutput = { actors: [] };

/**
 * How many people one call answers for before the batch is split in two.
 *
 * The batch is one generation, and generation is serial: ten people's
 * proposals come back one after another in a single stream, so the round takes
 * as long as the whole cast's output put together. Nothing about that is
 * required -- each person's section is built only from what that person knows
 * and never refers to another's -- so past this size the cast is dealt onto two
 * calls that run at once, and the round costs the longer half instead of the
 * sum.
 *
 * This buys wall time, not tokens: the same portraits go out and the same
 * proposals come back. The only duplication is a second copy of the system
 * prompt, which is the one part of the request that is cached.
 */
const BATCH_SPLIT_THRESHOLD = 6;

/**
 * Roughly how many people one call should answer for once the cast is split.
 *
 * A round costs the slowest of its calls, so the shorter each one's answer the
 * sooner the round is done. Not smaller than this, though: every call repeats
 * the whole cast's context, and past a point the fixed cost of another request
 * outweighs the shorter answer it produces.
 */
const ACTORS_PER_CALL = 4;

/** Not wider than the database pool is prepared to hold coin holds open. */
const MAX_BATCHES = 3;

/** How a cast is dealt onto calls. The defaults are the measured guess; `CHRONICA_COGNITION_SHARDS` overrides them to measure another. */
export interface CognitionSharding {
  readonly maxBatches: number;
  readonly actorsPerCall: number;
}
export const DEFAULT_SHARDING: CognitionSharding = { maxBatches: MAX_BATCHES, actorsPerCall: ACTORS_PER_CALL };

/** The cast, dealt into the calls that will answer for it, in the router's order. */
export function deal(actors: readonly RoutedActor[], sharding: CognitionSharding = DEFAULT_SHARDING): readonly (readonly RoutedActor[])[] {
  if (actors.length < BATCH_SPLIT_THRESHOLD) return [actors];
  const batches = Math.max(1, Math.min(sharding.maxBatches, Math.ceil(actors.length / Math.max(1, sharding.actorsPerCall))));
  const size = Math.ceil(actors.length / batches);
  return Array.from({ length: batches }, (_, index) => actors.slice(index * size, (index + 1) * size))
    .filter((batch) => batch.length > 0);
}

/** One call's worth: the actors it answers for, against the whole cast's context. */
async function runOneBatch(
  port: SimModelPort,
  actors: readonly RoutedActor[],
  world: WorldState,
  clock: ScenarioClock,
  inBatch: readonly string[],
): Promise<CognitionResult> {
  const userMessage = actors.map((actor) => renderActor(actor, world, clock, inBatch)).join("\n\n");
  const kindOf = kindsIn(world);
  const complain = (issues: readonly { path: readonly PropertyKey[]; message: string }[]): string =>
    issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");

  const salvaged: string[] = [];
  /** Parses, and if that fails drops what the schema named and parses again. */
  const read = (raw: string) => {
    // A reference written as the bare id is put into shape, and a bad line
    // inside one person's answer costs that line, not the other five people's.
    const read = readLeniently(CognitionOutputSchema, foldStrayProposalKeys(extractJson(raw)), kindOf);
    if (read.parsed.success) salvaged.push(...read.dropped);
    return read.parsed;
  };

  let failure: string;
  try {
    const parsed = read(await port.complete("simulate_cognition", COGNITION_SYSTEM_PROMPT, userMessage));
    if (parsed.success) return { output: parsed.data, calls: 1, parseFailure: null, salvaged };
    failure = complain(parsed.error.issues);
  } catch (error) {
    if (abortsTheTurn(error)) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    // A deadline is not a complaint about the answer's shape, so the repair
    // below would re-send a prompt that was never wrong and wait all over
    // again for the same nothing.
    if (isTimeout(error)) return { output: EMPTY, calls: 1, parseFailure: reason, salvaged };
    // Anything else is an answer that could not be read -- most often one cut
    // off mid-object, which is not JSON at all and so throws here rather than
    // failing the schema. That used to skip the repair and lose the whole
    // half-round in silence, which is precisely the case the repair exists
    // for: the model had something to say and the engine could not hear it.
    failure = reason;
  }

  // One repair attempt, the same one orchestration gets.
  //
  // This used to be deliberately absent, on the reasoning that "a failed
  // cognition only means nobody reacted this iteration, which the world can
  // absorb silently". Watching it happen says otherwise: a batch is three to
  // six people, each of whom had somewhere to be, and it failed on three
  // bursts out of six in one evening's play. Silently absorbing that is a
  // season in which a third of the world stood still for no reason anybody
  // can see. The deterministic repairs above catch the shapes that recur;
  // this catches the ones that do not.
  try {
    const raw = await port.complete(
      "simulate_cognition",
      COGNITION_SYSTEM_PROMPT,
      `${userMessage}\n\nYour previous answer was rejected. Fix exactly these problems and answer again with the whole object:\n${failure}`,
    );
    const repaired = read(raw);
    if (repaired.success) return { output: repaired.data, calls: 2, parseFailure: null, salvaged };
    return { output: EMPTY, calls: 2, parseFailure: complain(repaired.error.issues), salvaged };
  } catch (error) {
    if (abortsTheTurn(error)) throw error;
    return { output: EMPTY, calls: 2, parseFailure: error instanceof Error ? error.message : String(error), salvaged };
  }
}

/**
 * NPC cognition for one round (VISION §28).
 *
 * Every actor the router selected is answered for, from their own knowledge
 * and nobody else's. A large cast is dealt onto two concurrent calls rather
 * than one long one -- see `BATCH_SPLIT_THRESHOLD` -- and the answers are put
 * back in the order the router chose, so the deltas are applied in the same
 * sequence whether the round took one call or two.
 */
export async function runCognition(
  port: SimModelPort,
  actors: readonly RoutedActor[],
  world: WorldState,
  clock: ScenarioClock,
  sharding: CognitionSharding = DEFAULT_SHARDING,
): Promise<CognitionResult> {
  if (actors.length === 0) return { output: EMPTY, calls: 0, parseFailure: null, salvaged: [] };

  // The whole cast, whichever call a given person travels in. This is what
  // `renderActor` uses for the relations block, so every portrait comes out
  // byte-identical to the unsplit batch -- the split changes which request
  // carries a person, and nothing about what is said of them.
  const inBatch = actors.map((actor) => actor.characterId);

  const chunks = deal(actors, sharding);
  const results = await Promise.all(chunks.map((chunk) => runOneBatch(port, chunk, world, clock, inBatch)));

  if (results.length === 1) return results[0]!;

  // Back into the router's order. A model may answer for its people in any
  // order it likes, and one half finishing first must not reorder the other's
  // deltas: what the attention router decided mattered most is applied first,
  // exactly as it was before the split.
  const rank = new Map(inBatch.map((characterId, index) => [characterId, index]));
  const merged = results
    .flatMap((result) => result.output.actors)
    .sort((a, b) => (rank.get(a.actorRef.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.actorRef.id) ?? Number.MAX_SAFE_INTEGER));

  // One half failing is half a round lost, not a whole one. Both complaints
  // are kept: a shape the model keeps getting wrong should be legible here.
  const failures = results.map((result) => result.parseFailure).filter((failure): failure is string => failure !== null);

  return {
    output: { actors: merged },
    calls: results.reduce((sum, result) => sum + result.calls, 0),
    parseFailure: failures.length === 0 ? null : failures.join(" | "),
    salvaged: results.flatMap((result) => result.salvaged),
  };
}
