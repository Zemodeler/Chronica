import { z } from "zod";
import { OrchestratorOutputSchema, abortsTheTurn, isTimeout, type OrchestratorOutput } from "@chronica/shared";
import { dropMalformedEntries, extractJson } from "./json";
import { readLeniently, type KindOf } from "./bare-refs";
import type { SimModelPort } from "./ports";
import { renderWorldSlice, type WorldSlice } from "./slice";
import { verifyPart } from "./order-verifier";

/**
 * The orchestrator call (VISION §27).
 *
 * One model call reads the world slice and the player's order and answers with
 * a `WorldTransaction` proposal: what the order means, what the world does
 * about it, who was told to do what, what becomes true, and what is scheduled.
 *
 * It is not asked to roleplay every NPC -- that is the cognition pass, and
 * mixing the two is how you get one omniscient voice pretending to be
 * everybody (VISION §28).
 */

// Defaults are applied by the parser; repeating them in the prompt adds no
// requirement and crowds out the instructions that preserve player intent.
const OUTPUT_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(OrchestratorOutputSchema, { io: "input" }), (key, value: unknown) => key === "default" ? undefined : value);

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the world of a historical grand-strategy simulation.

You decide what actually happens. You have genuine authority over causality: you
interpret what the person giving the order meant, decide how much of it their
standing can actually command, invent the people and institutions the situation
requires, and create plausible consequences. You are not a narrator decorating a rules engine.

What you do NOT own: arithmetic, dates, identity, and persistence. The engine owns
those. So:

- Never invent an id. To create something, give it a "localId" (lowercase letters,
  digits, underscores, hyphens). To refer to it later in this same answer, write
  "local:<localId>". To refer to something that already exists, use the id shown in
  the world slice, exactly as written.
- Never state an absolute date. Express time as a whole number of days from now.
- Never compute totals or balances: state the change.
- Keep every amount in the same scale as the money already in the world. TREASURY
  shows what this world's sums actually look like; a measure worth eighty times
  the whole treasury is a misread of the units, not an ambitious policy.
- Every amount is positive: direction is in the fields, and money leaving the
  world has a null "toAccountRef".
- Say what sort of person they are in "standing" -- "a merchant of Ostia", "a
  common soldier", "senatorial" -- and what they are worth in "wealth". The
  first bounds the second: a ranker does not have a senator's fortune, and a
  merchant you invented to lend the state money has to have something to lend.

How to answer well. Twelve principles; the schema says what each field is,
and these say how to use them. Where a case is not named here, apply the
principle it falls under.

1. Read intent, then do it.
   Preserve an explicit decision to break a treaty: arrange contact, lift hold
   and break peace before force_engage where needed; explain real obstructions
   in whyNot. Never substitute holding and attribute that choice to the player.
   Killing requires personnel deaths. A purpose such as "end this war" belongs
   to its mission unless a separate diplomatic action was requested.
   "Raise two legions" is an instruction to a
   government: decide where, who pays, who commands, how long. Then put the
   change in "deltas" -- the money moves, the force exists, the official is
   seated. Describing what will happen is not doing it, and an answer with no
   deltas says the world did not move. A short order delegates method; a
   specific one does not. An order that cannot be met in full is attempted,
   with what it cost or lacked in "frictions". An order to keep going with
   something ACTIVE PROJECTS already lists is answered around it, not by
   starting it again. List each thing the order asked in "intent.parts": its
   acts by their place in "deltas", what it is for where no act of yours shows
   it ("goals"), what it may spend, the
   facts that show it done, or "whyNot". A spending vote must name an
   "enacts.budget" with the public account, authorised amount and purpose; a
   construction vote must name "enacts.project". Reuse an existing question
   about the same work instead of starting a parallel deliberation. Preserve the FINAL destination and
   quantities in goals; a staging shore does not replace the ordered arrival.
   Conditional work uses "afterParts" (indices of prerequisite parts; where one is a letter, "whenAnswered" says how it must be answered -- "refused" for an "otherwise"), or
   "whenForceExists" (a future force name), with its actions in "deferredActs"
   instead of immediate "deltas". Routine officers handle it when ready.
   Never refuse a possible act because it starts a war, breaks a treaty or goes
   against usual policy: the person ordering sets policy. Do the steps it needs
   (declare war, break peace, lift a hold), then the act. An impossible or
   absurd part gets a plain "whyNot" and no acts, never another part's acts;
   difficulty or delay is no "whyNot": act now, time does the rest.
   "March toward X and fight it" is ONE part: the march is its goal, the fight
   a deferredAct of the same part, given to the army named -- never a fleet or
   ally nearer the enemy.
   A hiring contract and its company are one operation: "service_contract_open"
   with "company" creates the hired ships and their pay. Never separately levy
   ships as men, and never use the employer as his own hired captain.
   Routine chamber positions need no individual speeches: use the existing
   voting blocs; only pivotal leaders, opposition or vetoes need a voice.

2. Every order is answered. Where an order achieves nothing -- a request
   refused, a journey that finds nobody, a bid that fails -- say so in a fact
   the player can see. Silence is never the answer to an order.

3. Standing decides who obeys. WHAT THIS PERSON MAY DO is what they hold.
   Men, money and ground answer to whoever commands them: an order to an army,
   a treasury or a province that is somebody else's is carried out only if the
   one it depends on would do it anyway -- kin, a friend, a man who wanted it
   already -- and the engine decides that; otherwise it is refused in front of
   everybody. An instruction to a person is a "delegation", naming its "part":
   they answer in their own turn, and you never write their compliance. A
   person's own words, letters, opinions and what he pays for himself are his
   own business; a seat is taken only by whoever may fill it, or
   with men at the capital. Another power's men, money, offices and treaties
   answer only to its own people: in "deltas", which are the order and what it
   caused, they cannot be moved by the player's say-so.

4. Nothing is refused for want of a row. The world's lists are where it
   starts, not all it may contain: a person not under PEOPLE is made with
   "character_create" and named "local:<id>" everywhere else; an office that
   does not exist is made by naming it ("officeLabel", on creating or seating
   someone); a kind of soldier, a ford or pass, a city the map lacks, a faith,
   are made by naming them in the field that asks; kin between people who
   already exist is "family_tie_set". You say what sort of thing it is --
   "standing" and "wealth" for a person, "skills" in words, whose kin they are,
   a position's type, a troop kind's bands -- and the engine says what that is
   worth. Prefer what is already listed. Reach for real history first: where a
   people or city had a known leader in this decade, that is who leads it;
   invent only where history left no name, and never borrow a famous one.

5. Countries are full of people. Every power listed under COUNTRIES WITH
   NOBODY IN THEM gets, in this answer, a ruler of its own culture and the
   forces it would plainly field, under its own polityId. They were always
   there, so filling them in gets no fact; what they do about events does.

6. What takes time is a project, and a project produces something. Its
   "completionOutcome" is what exists when the last milestone falls -- a force,
   a structure, revenue, a transfer to a named account, an agreement with a
   named power, an army arriving ("force_move"). "none" is an effort whose only
   product is that it happened, and it finishes silently. Anything that can be
   done now is done now: an army moves one bordering province with
   "force_modify" and a person with "moveToProvinceId"; anything further is a
   journey, as long as the road really is. Saying someone arrived does not put
   them there.

7. Facts are what happened, not what obtains or is expected. A posture, a
   plan, a process or a thing not done is not a fact; where nothing happened, write
   none. Set visibility honestly and keep secrets secret in every field:
   "private" facts name who knows in "knownToRefs", and "narrativeSummary",
   "frictions" and "playerDecision" reach the player whatever they say, so they
   speak only of what the player could know. "polity" means the
   government knows; a secret done at home is "private", and its scheduled
   next step stays private with the same knownToRefs. News that travels is
   "delayed" or "rumoured" with "knowableInDays". Something already on record
   that somebody learns is a "discoveries" entry; something nobody wrote down
   that somebody now believes, true or not, is "belief_set". A mission reports what it found, or has not finished.
   "significance" runs from a routine payment near 0 to a battle or death 90+.

8. Everything costs. POLITICAL STANDING, THE COUNCIL and THE COUNTRY are real
   numbers: a measure that angers people moves them ("legitimacy_shift",
   "political_support_set"), and a deed that makes or breaks a name moves
   "standingDeltaBps", naming its "standingCause". People change: a slave freed, sold or a captive enslaved ("legal_status_set"), a defector's new "polityId", a skill
   learned or lost, an ambition taken up or given up. What no other act fits is an arrangement; it persists under
   STANDING ARRANGEMENTS, and so does a building: say what either does in
   "effects" and who keeps it in "upkeep"; the engine applies it monthly
   until it is repealed or unpaid. A man's land is a
   holding, bought or improved from his purse ("holding_create",
   "holding_improve"); his trade a venture between places, or in one ("trade_venture_open"); men or a ship he pays from his own purse are his to command; a province is a government's. A man in an
   army's ranks is not its commander: "force_membership_set" enlists, discharges or records a desertion. Money comes from somewhere: a government short of it borrows from
   a named lender with "loan_open", revenue from another power names that
   power, and nothing is banked before the body that grants it has granted it.

9. Questions are settled by those who settle them. A body's decision is a
   procedure: opened, supported by people, blocs or factions (never the room
   itself), resolved when the weight is in -- except an election, which the
   count decides on its day: a man stands by a "nomination" naming the office.
   A measure says what it "enacts" (a work it pays for is its "project"),
   and does it only if carried.
   Include BOTH parties' duties and deadlines in "clauses", even for a plain
   letter offering political terms. Undertakings' "completionGoals" track
   restoration, movement and safe passage; nearby armies prove none of these.
   Existing peace closes earlier talks: address implementation or a breach.
   A treaty's "clauses" are what it makes happen and all it binds -- a promise left in
   a letter's prose binds nobody. One power speaks to another by
   letter, and the answer belongs to the power it was put to; a letter that
   offers an agreement names it in "proposes", and accepting it makes it; a
   war ends by terms offered ("peace_offer", "clauses") and accepted. An
   offer that would bind the player's own power is theirs to settle, as "playerDecision".
   Ground won is governed by the man given it: an office or a grant
   ("authority_grant_upsert") over those provinces, asked of whoever may give it.
   A power's CONSTITUTION is its chambers -- each deciding what it lists, an
   advisory one only counselling its ruler, who pays for overruling it -- and
   how its offices are filled; it changes by a measure that "enacts" a
   "constitution" change, put to the chamber that holds it, or decreed by the
   ruler where none does. A power's work is done by its departments, made or
   abolished by a measure enacting a "department"; what none holds, its ruler
   does. "audit_open" goes through their books. A government taken by force or dictated is
   "regime_change": who, the route and the armies, never whether it works.
   What powers stand in is an agreement: war and peace close each other, armies
   at peace cannot fight until somebody declares the war, and an ordered
   agreement names first the party that pays tribute, is protected, or is
   given passage. An army may cross another's land without passage;
   the host hears of it.

10. The engine settles outcomes, and there is no field for any of them. Two
   forces in one province fight only when one is ordered to ("force_engage"): move the army there
   first in the same answer if the march is short (a longer one sets out and
   arrives later), then say who attacks, how,
   and what the plan rests on; casualties, rout, capture and ground are the
   engine's, and the fight goes on daily until a side is beaten ("hold" on
   "force_modify" stops an army attacking; a "manoeuvre" forces the issue;
   "force_provision" feeds an army its country will not). An army's "battlePlan" is how it fights whoever attacks it. A plot against a person ("covert_plot_open") says who, whose hand,
   what is paid and the cover story -- never whether it works; a spy is its
   "espionage", and what he learns is the engine's report. A conditional
   plan is "contingency_arm", paid for, because the engine sizes a trap from
   what was spent; a condition whose consequence is a judgment is "stand_to".
   A death somebody brings about is "character_death", and the engine decides
   whether it can be. Plunder comes from taking ground, beating armies and
   raiding ("force_raid", from inside the province, never your own); never
   write it as a "money_transfer". Ground is taken ("province_control_set")
   where a power has an army or borders what it holds, and held loosely at
   first; a rising that holds ground
   becomes a country with "polity_create", and never a riot or raiders.

11. Somebody pays the soldiers. Wages are an obligation drawn on an account
   and named as the army's "payObligationRef"; null means nobody has
   undertaken to pay them, which is a decision. Wages, salaries and pensions
   have no recipient account -- they go to people -- and no account is ever on
   both sides of anything. An army paid from what it takes draws on its own war
   chest. Ordinary changes to an army -- name, commander, controller,
   allegiance, rations, "drilling" -- are "force_modify"; men joining are
   "force_reinforce", keeping their own kind, and the engine draws them up in
   their power's legions, alae or phalanx; "authorizedStrengthDelta" is
   paper and puts no men anywhere. A new way of fighting is a "doctrine": one
   army's on its commander's word ("force_modify"), a power's by law
   ("enacts.military": recruits, kit, service, discharge, a body redrawn);
   its effects are levers in bands, and the engine prices every gain. An
   officer orders only his own formation ("formationRef"); a soldier's bearing
   in the next battle is "force_membership_set" "conduct". A city is not its province: it can be taken
   or held under siege on its own, and is "sacked" only if stormed. A man hired
   -- a captain and his "company", a physician, an envoy, a tax farmer -- is
   "service_contract_open": the engine pays him. Pirates and brigands answer to no power:
   "outlaw", paid from a private purse.

12. The world moves on its own. THE WORLD STIRS is the world acting beside
   the order: carry each seed out as deltas, give it facts that name who and
   where it touches (never the player as its author, and apart from the order's
   own facts), and open its thread with "storyline_open" and the seedKey shown. DUE NOW is the world's own promise
   falling due: carry it out. All of this, and every other power's own
   business, goes in "worldDeltas", never "deltas". OPEN THREADS advance with "storyline_advance"
   and close when over -- one thread per matter, never one for the order
   itself unless it will outlive it; a thread is the world's bookkeeping. STANDING AIMS are each power's
   private view, rewritten with "polity_outlook_set" whenever its situation
   changed. An order that is not finished when given sets "watch" to what would
   finish it.

Answer with a single JSON object and nothing else, matching this schema (the
"deltas" array inside it is the closed set of changes you may make to the world):

${OUTPUT_JSON_SCHEMA}`;

export interface OrchestrateResult {
  readonly output: OrchestratorOutput;
  readonly calls: number;
  /** Set when the model could not produce a valid proposal even after a repair attempt. */
  readonly parseFailure: string | null;
  /**
   * What was dropped to make an otherwise good answer parse, without spending
   * a call on it. Kept for the same reason `repairedFrom` is: if the same
   * field keeps appearing here, the schema or the prompt is at fault.
   */
  readonly salvaged: readonly string[];
  /**
   * Why the first attempt was rejected, when a repair then succeeded. Kept
   * because a repair costs a whole extra call: if the same complaint keeps
   * appearing here, the prompt or the schema is at fault, not the model.
   */
  readonly repairedFrom: string | null;
}

/**
 * A proposal that changes nothing, used when the model's answer cannot be
 * salvaged. The burst continues and the player is told the machinery of state
 * produced nothing this time -- far better than a stack trace, and honest about
 * what happened.
 */
function inertOutput(reason: string): OrchestratorOutput {
  return OrchestratorOutputSchema.parse({
    intent: { summary: "The order could not be interpreted.", domains: [] },
    narrativeSummary: "The order was received, but nothing came of it.",
    frictions: [reason],
    deltas: [],
    facts: [],
    delegations: [],
    schedule: [],
    cognitionCandidates: [],
    outcome: "continue",
    playerDecision: null,
  });
}


/**
 * The schema's own ceilings, and what happens when an answer goes past one.
 *
 * A live game lost an entire order because the answer carried twenty-five
 * deltas and the cap is twenty-four: the schema is strict, so all
 * twenty-five were discarded, the retry produced another long answer, and the
 * burst committed having done nothing. Twenty-four good acts thrown away over
 * the twenty-fifth is the worst trade in the pipeline.
 *
 * A ceiling is a budget, not a contract. Past it the tail is dropped -- the
 * model puts the important things first, and losing the last of a long list
 * is a far smaller loss than losing the list.
 */
const OUTPUT_CAPS: Readonly<Record<string, number>> = {
  deltas: 24, worldDeltas: 24, facts: 16, discoveries: 12, delegations: 8, schedule: 12,
};

export function trimToCaps(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  // A delta or fact written as a bare line is not one, and the schema is
  // strict, so a single stray sentence rejected the whole proposal. The same
  // trade as the ceilings below: lose the malformed entry, never the answer.
  const output = { ...(dropMalformedEntries(value, Object.keys(OUTPUT_CAPS)) as Record<string, unknown>) };
  for (const [key, cap] of Object.entries(OUTPUT_CAPS)) {
    const list = output[key];
    if (Array.isArray(list) && list.length > cap) output[key] = list.slice(0, cap);
  }
  return output;
}

async function orchestrateWhole(
  port: SimModelPort,
  slice: WorldSlice,
  /** What each id in the world is, so a reference written as a bare id can be put into shape (`wrapBareRefs`). */
  kindOf: KindOf = () => null,
): Promise<OrchestrateResult> {
  const userMessage = renderWorldSlice(slice);
  let calls = 0;
  const salvaged: string[] = [];

  const attempt = async (message: string) => {
    calls += 1;
    const raw = await port.complete("simulate_orchestrate", ORCHESTRATOR_SYSTEM_PROMPT, message);
    // Put right what can be (a reference written as a bare id: three whole
    // answers in seven were once lost to nothing else), then drop exactly what
    // the schema named, before paying for a second call. Sixteen deltas were
    // once thrown away over a misspelt enum in the sixteenth.
    const read = readLeniently(OrchestratorOutputSchema, trimToCaps(extractJson(raw)), kindOf);
    if (read.parsed.success) salvaged.push(...read.dropped);
    return read.parsed;
  };

  let failure: string;
  try {
    const first = await attempt(userMessage);
    if (first.success) return { output: first.data, calls, parseFailure: null, salvaged, repairedFrom: null };
    failure = first.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  } catch (error) {
    if (abortsTheTurn(error)) throw error;
    failure = error instanceof Error ? error.message : String(error);
    // A repair answers a complaint about the shape of the answer. A deadline is
    // not a complaint: the prompt was not wrong, so re-sending it whole buys a
    // second full-price wait that ends the same way. Give up and say so.
    if (isTimeout(error)) {
      return { output: inertOutput("The order reached the palace, but no answer came back in time."), calls, parseFailure: failure, salvaged, repairedFrom: null };
    }
  }

  // One repair attempt, carrying the exact complaints back. Two is not worth the
  // latency: a model that cannot produce the shape twice will not produce it on
  // the third try either.
  try {
    const firstFailure = failure;
    const repaired = await attempt(`${userMessage}\n\nYour previous answer was rejected. Fix exactly these problems and answer again with the whole object:\n${failure}`);
    if (repaired.success) return { output: repaired.data, calls, parseFailure: null, salvaged, repairedFrom: firstFailure };
    failure = repaired.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  } catch (error) {
    if (abortsTheTurn(error)) throw error;
    failure = error instanceof Error ? error.message : String(error);
  }

  return { output: inertOutput("The order reached the palace, but no workable instruction came back out of it."), calls, parseFailure: failure, salvaged, repairedFrom: null };
}

/**
 * An order of several independent lines, split into one call each. The answer
 * is mostly output tokens, so one call for four lines took as long as writing
 * all four acts end to end (69 s for a month's order); four calls at once take
 * as long as the longest. A line that continues the one before it ("Then
 * march...", "and tell...") stays with it, and an order that is one thought is
 * not split at all.
 */
/** The opening of a line that is a command of its own, as opposed to a sentence of a story ("Claudius would light fires...", "Should the battle be won..."). */
const COMMAND_START = /^(?:and\s+|then\s+|also\s+|first\s+|next\s+)?(?:march|move|send|hire|raise|recruit|build|construct|give|pay|appoint|name|declare|offer|ask|propose|make|reinforce|disband|seize|put|sail|write|train|drill|levy|muster|equip|fortify|station|garrison|attack|besiege|storm|raid|demand|invite|summon|release|arrest|forbid|ban|ordain|nominate|transfer|buy|sell|open|close|burn|destroy|capture|take|hold|defend|guard|scout|bribe|negotiate|conclude|cancel|rename|promote|dismiss|install|grant|award|reform|found|establish|dedicate|inspect|audit|repair|feed|supply|ship|carry|escort|pursue|retreat|withdraw|relieve|rally|marry|divorce|adopt|banish|pardon|execute|tax|lower|raise)\b/i;

export function splitOrder(order: string | null): string[] {
  if (order === null) return [];
  if (order.length < 160) return [order];
  const lines = order.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const sentences = order.split(/(?<=[.!?])\s+(?=[A-Z])/).map((line) => line.trim()).filter((line) => line.length > 0);
  // Split only where the order is a list of commands. A plan told as a story -- "He would light fires... Once satisfied he
  // would begin the retreat" -- is one order, its sentences leaning on each other, and cut apart each would lose the others.
  const commands = (units: string[]): boolean => units.length >= 2 && units.filter((unit) => COMMAND_START.test(unit)).length >= Math.ceil(units.length * 0.75);
  const units = lines.length >= 2 && commands(lines) ? lines : commands(sentences) ? sentences : [order];
  if (units.length < 2) return [order];
  const chunks: string[] = [];
  for (const line of units) {
    if (chunks.length > 0 && (/^(then|and|but|if|otherwise|after|before|once|so)\b/i.test(line) || line.length < 24)) chunks[chunks.length - 1] += "\n" + line;
    else chunks.push(line);
  }
  // At most four calls: the shortest neighbours are joined first.
  while (chunks.length > MAX_ORDER_CALLS) {
    let at = 0;
    for (let i = 1; i < chunks.length - 1; i += 1) if (chunks[i]!.length + chunks[i + 1]!.length < chunks[at]!.length + chunks[at + 1]!.length) at = i;
    chunks.splice(at, 2, chunks[at] + "\n" + chunks[at + 1]);
  }
  return chunks;
}
const MAX_ORDER_CALLS = 4;

/** Every id one answer made up is its own, so that two answers read together cannot name the same thing. */
function namespaced(value: unknown, prefix: string): unknown {
  if (typeof value === "string") return value.startsWith("local:") ? `local:${prefix}${value.slice(6)}` : value;
  if (Array.isArray(value)) return value.map((item) => namespaced(item, prefix));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === "localId" && typeof child === "string" ? `${prefix}${child}`
      : key === "factLocalIds" && Array.isArray(child) ? child.map((id) => typeof id === "string" ? `${prefix}${id}` : id)
        : namespaced(child, prefix),
  ]));
}

/** The answers to the lines of one order, read as the answer to the whole of it. */
export function mergeOrchestrations(outputs: readonly OrchestratorOutput[]): OrchestratorOutput {
  const parts: OrchestratorOutput["intent"]["parts"] = [];
  const deltas: OrchestratorOutput["deltas"] = [];
  const merged = {
    facts: [] as unknown[], discoveries: [] as unknown[], delegations: [] as unknown[], schedule: [] as unknown[],
    worldDeltas: [] as unknown[], cognitionCandidates: [] as unknown[], frictions: [] as string[],
  };
  outputs.forEach((raw, index) => {
    const output = namespaced(raw, `c${index + 1}_`) as OrchestratorOutput;
    const partBase = parts.length;
    const deltaBase = deltas.length;
    for (const part of output.intent.parts) {
      parts.push({
        ...part,
        ...(part.afterParts === undefined ? {} : { afterParts: part.afterParts.map((at) => at + partBase) }),
        acts: part.acts.map((at) => at + deltaBase),
      });
    }
    deltas.push(...output.deltas);
    merged.facts.push(...output.facts);
    merged.discoveries.push(...output.discoveries);
    merged.delegations.push(...output.delegations.map((delegation) => ({ ...delegation, part: delegation.part === null ? null : delegation.part + partBase })));
    merged.schedule.push(...output.schedule);
    merged.worldDeltas.push(...output.worldDeltas);
    merged.cognitionCandidates.push(...output.cognitionCandidates);
    merged.frictions.push(...output.frictions);
  });
  const lead = outputs[0]!;
  const trimmed = trimToCaps({ ...merged, deltas }) as typeof merged & { deltas: OrchestratorOutput["deltas"] };
  return {
    ...lead,
    intent: { ...lead.intent, summary: outputs.map((output) => output.intent.summary).join(" ").slice(0, 600), domains: [...new Set(outputs.flatMap((output) => output.intent.domains))].slice(0, 8),
      // A part pointing at an act the cap dropped points at nothing.
      parts: parts.map((part) => ({ ...part, acts: part.acts.filter((at) => at < trimmed.deltas.length) })) },
    narrativeSummary: outputs.map((output) => output.narrativeSummary).join(" ").slice(0, 600),
    utterance: outputs.find((output) => output.utterance !== null)?.utterance ?? null,
    frictions: trimmed.frictions.slice(0, 8),
    deltas: trimmed.deltas,
    facts: trimmed.facts as OrchestratorOutput["facts"],
    discoveries: trimmed.discoveries as OrchestratorOutput["discoveries"],
    delegations: trimmed.delegations as OrchestratorOutput["delegations"],
    schedule: trimmed.schedule as OrchestratorOutput["schedule"],
    worldDeltas: trimmed.worldDeltas as OrchestratorOutput["worldDeltas"],
    cognitionCandidates: (trimmed.cognitionCandidates as OrchestratorOutput["cognitionCandidates"]).slice(0, 12),
    outcome: outputs.some((output) => output.outcome === "player_decision") ? "player_decision" : outputs.some((output) => output.outcome === "chronicle") ? "chronicle" : "continue",
    playerDecision: outputs.find((output) => output.playerDecision !== null)?.playerDecision ?? null,
    watch: outputs.find((output) => output.watch !== null)?.watch ?? null,
  };
}

/** The answer to a stretch that has no order to read: time passes, and the world's own people are asked in the rounds. No call is made. */
export function quietOrchestration(): OrchestrateResult {
  const output = OrchestratorOutputSchema.parse({
    intent: { summary: "Time passes.", domains: [] }, narrativeSummary: "Time passed.", frictions: [], deltas: [], facts: [],
    delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });
  return { output, calls: 0, parseFailure: null, salvaged: [], repairedFrom: null };
}

async function orchestrateFirst(port: SimModelPort, slice: WorldSlice, kindOf: KindOf = () => null): Promise<OrchestrateResult> {
  const lines = splitOrder(slice.order);
  if (lines.length < 2 || slice.answeredDecision !== null) return orchestrateWhole(port, slice, kindOf);
  const results = await Promise.all(lines.map((line) => orchestrateWhole(port, { ...slice, order: line }, kindOf)));
  const failed = results.flatMap((result, index) => result.parseFailure === null ? [] : [index]);
  if (failed.length === results.length) return { ...results[0]!, calls: results.reduce((total, result) => total + result.calls, 0) };
  const output = mergeOrchestrations(results.map((result) => result.output));
  // A line whose answer could not be read is still a part of the order, said to have come to nothing rather than dropped.
  const lost = failed.map((index) => ({ said: lines[index]!.slice(0, 200), acts: [] as number[], goals: [], spend: null, factLocalIds: [] as string[], whyNot: "This part could not be worked out this time; give it again." }));
  return {
    output: lost.length === 0 ? output : { ...output, intent: { ...output.intent, parts: [...output.intent.parts, ...lost].slice(0, 10) } },
    calls: results.reduce((total, result) => total + result.calls, 0),
    parseFailure: null,
    salvaged: results.flatMap((result) => result.salvaged),
    repairedFrom: results.find((result) => result.repairedFrom !== null)?.repairedFrom ?? null,
  };
}

/** Reasons a part was given that are not the world's but the answer's own: a war not declared, a custom, a policy. */
const POLICY_REFUSAL = /((outside|beyond|exceeds?|lacks?|without|not within|no) [^.]{0,40}(authority|power|remit|standing|right)|belongs? to (a |an )?(separate|allied|another)|requires? (breaking|a declaration|declaring|ending)|breaking (rome'?s |the )?peace|not at war|does not exist as a war|not (yet )?(been )?declared|would (start|begin|provoke|cause|trigger) (a )?war|would (break|violate|breach)|against (rome'?s |its |our )?(usual |stated )?(policy|custom|interest)|policy of avoiding|no (cause|reason) for war|contradicts)/i;

/**
 * What the engine can do for the commonest kinds of order, said to the answer that left one undone. Kept out of the standing prompt
 * (which is as long as it may be) and given only where a part has been missed, for the words that part used.
 */
const CAPABILITIES: readonly { readonly when: RegExp; readonly can: string }[] = [
  { when: /\b(travel|journey|go to|goes to|visit|sail to|ride to|set out for|send\b.*\bto (the court|alexandria|egypt|carthage|syracuse|rome))/i, can: "A person sent somewhere -- to a court, to scout, to carry a proposal -- is a service_contract_open with role \"envoy\" or \"agent\", the person as employee and provinceId where he goes; the journey takes days and he arrives on his own." },
  { when: /\b(marry|marriage|wife|husband|betroth|bride)\b/i, can: "A marriage is proposed by a letter (diplomatic_message_send) carried by an envoy, and is recorded with family_tie_set (relation spouse, change form) once it is agreed or the person is the actor's own." },
  { when: /\b(run for|running for|campaign|candidate|stand for|election|elected|tribune|consul|praetor|aedile|censor|term as)\b/i, can: "Standing for office is political_procedure_open (an election or candidacy for that office, sponsorCharacterRef the man) with political_support_set for the backing he uses; he needs nobody's leave to stand." },
  { when: /\b(rally|raise|levy|recruit|muster|enlist|volunteers|conscript)\b/i, can: "A new army is force_create (commander, strength, place); more men for an existing one is force_reinforce. Men of another power are asked by letter or won by covert_plot_open unless the actor commands them." },
  { when: /\b(scout|spy|map|informant|herders|guides?|intelligence|reconnoitre|reconnaissance)\b/i, can: "Local people are hired with service_contract_open (role \"agent\" or \"guide\"); a detachment is posted with force_modify; a person is watched with covert_plot_open." },
  { when: /\b(ambush|trap|lure|feign|false retreat|surprise|flank|encircle|hammer and anvil)\b/i, can: "A way of fighting is force_modify battlePlan (factor surprise, deployment, cohesion...) on the army, and where the enemy is within reach, force_engage with a manoeuvre (lure, night_attack, provoke, storm_camp)." },
  { when: /\b(if|should|once|when|in case|provided)\b/i, can: "A conditional act is held: contingency_arm (an act armed to fire when its trigger holds) or deferredActs with afterParts naming the part it waits on." },
  { when: /\b(terms|surrender|auxiliar|citizenship|clemency|mercy|spare)\b/i, can: "Terms are diplomatic_message_send to the other side (with agreement_open clauses); survivors taken into an army are force_membership_set (enlist)." },
  { when: /\b(proclaim|proclamation|announce|decree|forbid|ban|edict|cult|denounce)\b/i, can: "A decree or proclamation is generic_entity_create (a standing decree, its effects, its province) with storyline_open; belief_set shifts what people hold." },
  { when: /\b(siege|besiege|blockade|surround|camps?|invest)\b/i, can: "A siege is siege_lay on the army at the settlement, and the army must be there (march it first, as its own part); force_provision feeds it." },
  { when: /\b(ask the senate|put to the senate|petition|motion|request the senate|senate for)\b/i, can: "A request to the Senate is political_procedure_open (a motion) with the Senate as institution and the actor as sponsor." },
  { when: /\b(economic|reform|aqueduct|road|harbou?r|walls|fortif|build|construct|temple)\b/i, can: "Works are project_create (what it builds, its cost, its milestones) or holding_improve; a reform is generic_entity_create with standing effects." },
  { when: /\b(feast|games|gift|dole|banquet|celebrat)\b/i, can: "A feast, games, a dole or a building for the people is public_benefaction." },
];

/** What the engine can do for the words of a part, at most three kinds of it. */
export function capabilityHints(said: string): string[] {
  return CAPABILITIES.filter((entry) => entry.when.test(said)).slice(0, 3).map((entry) => entry.can);
}

/** Reasons that say the world cannot do it, not that the answer would not: a river, a horse, a thing that is not. */
const IMPOSSIBLE = /(impossible|cannot be done|not possible|no (consul|man|one|mortal|power|ruler) can|a horse|reverse (the )?(tiber|river)|against nature|does not exist in this world)/i;

/** The parts of an order the answer did not carry out, though they were possible. */
export function partsNotCarriedOut(output: OrchestratorOutput): { readonly index: number; readonly said: string; readonly why: string | null }[] {
  const flagged: { index: number; said: string; why: string | null }[] = [];
  output.intent.parts.forEach((part, index) => {
    const own = part.acts.map((at) => output.deltas[at]).filter((delta) => delta !== undefined);
    const noAct = own.length === 0 && (part.deferredActs?.length ?? 0) === 0;
    const waiting = part.afterParts !== undefined;
    const handedOn = output.delegations.some((delegation) => delegation.part === index);
    if (handedOn) return;
    if (noAct && !waiting && part.whyNot === null && part.factLocalIds.length === 0 && !/\?\s*$/.test(part.said)) flagged.push({ index, said: part.said, why: null });
    else if (noAct && part.whyNot !== null && !IMPOSSIBLE.test(part.whyNot) && !/\?\s*$/.test(part.said)) flagged.push({ index, said: part.said, why: part.whyNot });
    else if (own.length > 0 && verifyPart({ said: part.said, ops: own.map((delta) => delta.op), handedOn }) !== null) flagged.push({ index, said: part.said, why: "what was written for it was not the kind of act it asks for" });
  });
  return flagged;
}

/** One part's answer put in place of the part the first answer left undone. */
export function replacingPart(original: OrchestratorOutput, index: number, retry: OrchestratorOutput): OrchestratorOutput {
  const answer = namespaced(retry, "r" + index + "_") as OrchestratorOutput;
  const was = original.intent.parts[index];
  if (was === undefined) return original;
  // The part of the new answer that is about the same thing as the one it replaces.
  const words = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wanted = words(was.said);
  const shared = (said: string): number => [...words(said)].filter((word) => wanted.has(word)).length;
  const first = [...answer.intent.parts].sort((x, y) => shared(y.said) - shared(x.said))[0];
  if (first === undefined || shared(first.said) === 0) return original;
  const deltaBase = original.deltas.length;
  const kept = trimToCaps({
    deltas: [...original.deltas, ...answer.deltas], facts: [...original.facts, ...answer.facts], discoveries: [...original.discoveries, ...answer.discoveries],
    delegations: [...original.delegations, ...answer.delegations.map((delegation) => ({ ...delegation, part: index }))], schedule: [...original.schedule, ...answer.schedule],
    worldDeltas: [...original.worldDeltas, ...answer.worldDeltas],
  }) as Pick<OrchestratorOutput, "deltas" | "facts" | "discoveries" | "delegations" | "schedule" | "worldDeltas">;
  const parts = original.intent.parts.map((part, at) => at !== index ? part : {
    ...first, said: was.said, ...(was.afterParts === undefined ? {} : { afterParts: was.afterParts }),
    acts: first.acts.map((act) => act + deltaBase).filter((act) => act < kept.deltas.length),
  });
  return {
    ...original, ...kept, intent: { ...original.intent, parts },
    frictions: [...original.frictions, ...answer.frictions].slice(0, 8),
    cognitionCandidates: [...original.cognitionCandidates, ...answer.cognitionCandidates].slice(0, 12),
    watch: original.watch ?? answer.watch,
  };
}

/**
 * What the player asked that was possible and was not done -- a part with no act at all, one refused for a war not declared or
 * a policy, one written as the wrong kind of act -- is asked for again, alone, told so. At most two parts, in parallel. The
 * engine never rejects an order for the answer's own misreading when one more question can set it right.
 */
export async function orchestrate(port: SimModelPort, slice: WorldSlice, kindOf: KindOf = () => null): Promise<OrchestrateResult> {
  const first = await orchestrateFirst(port, slice, kindOf);
  if (first.parseFailure !== null || slice.order === null || slice.answeredDecision !== null) return first;
  const flagged = partsNotCarriedOut(first.output).slice(0, 2);
  if (flagged.length === 0) return first;
  const retries = await Promise.all(flagged.map((part) => orchestrateWhole(port, {
    ...slice,
    order: part.said + "\n\n(An earlier answer did not carry this out" + (part.why === null ? "" : ": " + part.why) + ". It is possible. Do the steps it needs and then the act itself; do not refuse it for policy, war, custom or want of authority -- write the act, and the engine decides whether it stands or is an overreach -- and do not substitute another act." + capabilityHints(part.said).map((hint) => " What the engine can do: " + hint).join("") + ")",
  }, kindOf)));
  let output = first.output;
  retries.forEach((retry, at) => { if (retry.parseFailure === null) output = replacingPart(output, flagged[at]!.index, retry.output); });
  return { ...first, output, calls: first.calls + retries.reduce((total, retry) => total + retry.calls, 0), salvaged: [...first.salvaged, ...retries.flatMap((retry) => retry.salvaged)] };
}
