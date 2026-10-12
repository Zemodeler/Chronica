import { formatWorldDate, letterTally, letterTallyInWords, spentForOrderPart, type ScenarioClock } from "@chronica/shared";
import { goalEvidence, orderPartLabel, orderPartStatus, procedureReasonOf, type OrderPart, type OrderPartStatus, type WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";
import { refOfPart, whyNothingSetAside } from "./order-money";
import { refusalInPeriodWords } from "./order-lines";

/**
 * What came of each part of an order, in the engine's words, set under the
 * passage that answers it.
 *
 * The historian was handed "nothing came of the delegation" and "no crossing
 * is recorded" as facts of the answer, and wrote a passage that said the
 * transport order would be used and left both out: a fact given to the
 * historian is protected from being cut, not from being unsaid (C06). What an
 * order asked for and what became of it is not the historian's to choose, so
 * it is not the historian's to write. One line a part, read from the work
 * itself (`orderPartStatus`), after the prose.
 */
export function orderOutcomeLines(world: WorldState, orderRecordId: string, clock?: ScenarioClock): readonly string[] {
  const order = world.orders.find((candidate) => candidate.id === orderRecordId);
  if (order === undefined) return [];
  const told = order.parts.map((part) => lineOf(world, part, order.actorCharacterId, clock));
  // A one-part order carried out is answered by its passage, and a line
  // saying "done" under it says nothing the passage did not.
  // (A motion put to a body is always told: how it came out, with the count, is not in the passage.)
  if (order.parts.length === 1 && orderPartStatus(world, order.parts[0]!) === "achieved" && order.parts[0]!.note === null && motionOf(world, order.parts[0]!) === undefined) return [];
  return told;
}

/** The motion a part put to a body that has been decided, passed, failed or lapsed (a candidacy is read as its own). */
export function motionOf(world: WorldState, part: OrderPart): WorldState["material"]["politicalProcedures"][number] | undefined {
  for (const ref of part.workRefs) {
    if (ref.kind !== "procedure") continue;
    const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === ref.id);
    if (procedure !== undefined && procedure.outcome !== null && procedure.type !== "nomination" && procedure.type !== "appointment") return procedure;
  }
  return undefined;
}

/** What a part is told as, with the evidence that raised it, if any (`toldOutcome`). */
export interface ToldOutcome {
  readonly status: OrderPartStatus;
  /** The engine's own reading, before any linked evidence. */
  readonly reckoned: OrderPartStatus;
  readonly raised: { readonly name: string; readonly locationId: string } | undefined;
  readonly appointed: { readonly name: string } | undefined;
  /** A work found only by its words: shown as a possible answer, never credited. */
  readonly mayAnswer: WorldState["projects"][number] | undefined;
}

/**
 * What a part is told as.
 *
 * The engine's reading (`orderPartStatus`) is the answer. It is raised to
 * "done" only by evidence tied to this very part: an army the part itself
 * made (a `force` work ref of the actor's own power) standing under the name
 * asked for, or the named man commanding or holding a post in such an army. A
 * name or a post anywhere in the world proves nothing: "raise an army called
 * X" read done because a foreign power already had an X, and "appoint Y" read
 * done because Y held an unrelated seat. A part refused or failed is never
 * raised. A work found by its words alone is never the part's work.
 */
export function toldOutcome(world: WorldState, part: OrderPart, actorId: string): ToldOutcome {
  const reckoned = orderPartStatus(world, part);
  const unmatched = reckoned === "unanswered" || reckoned === "carried_unverified";
  const actorPolityId = world.characters.find((character) => character.id === actorId)?.polityId ?? null;
  const linked = unmatched ? linkedForces(world, part, actorPolityId) : [];
  const raised = linked.length === 0 ? undefined : namedForceRaised({ ...world, material: { ...world.material, forces: linked } }, part.said);
  const appointed = linked.length === 0 || raised !== undefined ? undefined : appointmentInForces(world, part.said, linked);
  const order = unmatched && raised === undefined && appointed === undefined ? world.orders.find((candidate) => candidate.parts.includes(part)) : undefined;
  const mayAnswer = order === undefined ? undefined : projectBegunFor(world, part.said, order.givenAtStep, actorId, actorPolityId);
  return { status: raised !== undefined || appointed !== undefined ? "achieved" : reckoned, reckoned, raised, appointed, mayAnswer };
}

/** The armies this part itself made, of the actor's own power. */
function linkedForces(world: WorldState, part: OrderPart, actorPolityId: string | null): WorldState["material"]["forces"] {
  if (actorPolityId === null) return [];
  const ids = new Set(part.workRefs.filter((ref) => ref.kind === "force").map((ref) => ref.id));
  return world.material.forces.filter((force) => ids.has(force.id) && force.polityId === actorPolityId);
}

/** "Appoint X as its legate": X commands, or holds a post in, one of these armies. */
function appointmentInForces(world: WorldState, said: string, forces: WorldState["material"]["forces"]): { readonly name: string } | undefined {
  const person = personNamedForAppointment(world, said);
  if (person === undefined) return undefined;
  return forces.some((force) => force.commanderCharacterId === person.id || (force.posts ?? []).some((post) => post.characterId === person.id)) ? { name: person.name } : undefined;
}

/** A work begun on or after the order's day, by the actor or his power, sharing the part's words. */
function projectBegunFor(world: WorldState, said: string, givenAtStep: number, actorId: string, actorPolityId: string | null): WorldState["projects"][number] | undefined {
  const candidates = world.projects.filter((project) => project.startedAtStep >= givenAtStep
    && (project.sponsorEntityRef.id === actorId || (actorPolityId !== null && project.sponsorEntityRef.id === actorPolityId)));
  return candidates.length === 0 ? undefined : projectForWords({ ...world, projects: candidates }, said);
}

/** One part's line: what it came to, in the engine's words. */
export function lineOf(world: WorldState, part: OrderPart, actorId: string, clock?: ScenarioClock): string {
  const { status, reckoned, raised, appointed, mayAnswer } = toldOutcome(world, part, actorId);
  const project = part.workRefs.find((ref) => ref.kind === "project");
  const work = project === undefined ? undefined : world.projects.find((candidate) => candidate.id === project.id);
  const next = work?.milestones.find((milestone) => milestone.status === "pending");
  const how = status === "under_way" && work !== undefined
    ? `: ${work.label}${next === undefined ? "" : `, next ${lowerFirst(next.label)}`}`
    : "";
  // Several letters are told as what they came to, counted (E4).
  const tally = letterTally(world, part);
  const letters = tally === null ? "" : `: ${letterTallyInWords(tally)}`;
  // On the day it was refused or failed: a line read at the end of the report
  // otherwise reads as though it had been so all along (E8).
  const settledAt = part.refusedAtStep ?? part.stages.reduce<number | null>((latest, stage) => stage.failedAtStep === null ? latest : Math.max(latest ?? 0, stage.failedAtStep), null);
  const on = clock === undefined || settledAt === null || (status !== "refused" && status !== "failed" && status !== "partly_done") ? "" : ` on ${formatWorldDate({ day: settledAt, minute: 0 }, clock)}`;
  // A vote that has been counted says why it failed; the refusal written before it was put ("authorization is pending") is stale by then.
  const why = refusalInPeriodWords(world, part, actorId, (status === "refused" ? procedureReasonOf(world, part) : null) ?? part.refusal ?? part.whyNot ?? procedureReasonOf(world, part));
  const reason = why === null || status === "achieved" || status === "under_way" ? "" : `: ${sentencesWithin(withoutRecordIds(why.replace(/\s+/g, " ")), 320)}`;
  // A motion is said as what it came to, with the count the body gave: carried, failed or lapsed.
  const motion = motionOf(world, part);
  const motionWords = motion === undefined || motion.outcome !== "passed" || motion.outcomeReason === null ? "" : `: carried, ${sentencesWithin(withoutRecordIds(motion.outcomeReason.replace(/\s+/g, " ")), 260)}`;
  const lapsed = motion !== undefined && (motion.outcome === "withdrawn" || motion.outcome === "blocked");
  // Secret work says what it cost and whose money it was, to the man who paid.
  const plotRef = part.workRefs.find((ref) => ref.kind === "plot");
  const plot = plotRef === undefined ? undefined : world.covertPlots.find((candidate) => candidate.id === plotRef.id);
  const payer = plot?.fundingAccountId == null ? null : world.material.accounts.find((account) => account.id === plot.fundingAccountId);
  const paid = plot === undefined || plot.spend <= 0 ? "" : ` (${plot.spend} paid${payer?.owner.kind === "character" && payer.owner.id === actorId ? " from your own purse" : payer?.owner.kind === "polity" ? " from the treasury" : ""})`;
  // What it was allowed, what was set aside and what went: three different
  // things, which the record used to say as one or not at all (E07).
  const reservation = part.spend?.reservationId == null ? undefined : world.material.reservations.find((candidate) => candidate.id === part.spend!.reservationId);
  const spent = spentForOrderPart(world, part);
  // What it was allowed, said as the player would: not "0 spent; nothing currently set aside".
  const coin = world.material.currency.name;
  const money = (amount: number): string => `${amount.toLocaleString("en-GB")} ${coin}`;
  const spentNow = Math.max(spent, reservation === undefined ? 0 : reservation.reservedAmount - reservation.remainingAmount);
  const envelope = part.spend === null ? ""
    : reservation === undefined || reservation.status !== "active"
      ? (() => {
        const why = whyNothingSetAside(world, part, refOfPart(world, part));
        const waiting = /until the vote is carried/.test(why) ? ", to be set aside once the vote carries" : /did not carry/.test(why) ? ": the vote did not carry" : "";
        return spent > 0 ? ` (${money(spent)} of ${money(part.spend.cap)} spent)` : ` (budget up to ${money(part.spend.cap)}, none spent yet${waiting})`;
      })()
      : ` (${money(spentNow)} spent, ${money(reservation.remainingAmount)} still set aside, budget ${money(part.spend.cap)})`;
  // "Done" is shown with what the world shows for it, on the day it was read (plan chronicle-and-order-truth, 1.5).
  const shown = status === "achieved" ? [...new Set(part.goals.map((goal) => goalEvidence(world, goal)).filter((text): text is string => text !== null))] : [];
  const raisedNote = appointed !== undefined && status === "achieved" ? `: ${appointed.name} holds the post` : raised !== undefined && status === "achieved" && reckoned !== "achieved" ? `: ${raised.name} stands at ${world.map.provinces.find((province) => province.id === raised.locationId)?.name ?? "its station"}` : "";
  const evidence = raisedNote !== "" ? raisedNote : shown.length === 0 ? "" : `: ${shown.slice(0, 3).join("; ")}${clock === undefined ? "" : `, ${formatWorldDate(world.instant, clock)}`}`;
  // The verifier's "Check:" is for the audit, not for the player.
  const shownNote = part.note === null || /^Check:/.test(part.note) ? null
    : part.note.replace(/(?:Not all of it: )?It could not be carried out as written\.?/, "Part of it could not be done as asked.").replace(/;\s*Part of it could not be done as asked\./, "; part of it could not be done as asked.");
  // Found by its words alone: said as a possibility, never as the part's work.
  const possible = mayAnswer === undefined ? "" : ` (a work begun since may answer it, not tied to this order: ${mayAnswer.label})`;
  const note = `${paid}${envelope}${shownNote === null ? "" : ` (${shownNote})`}${possible}`;
  return `"${part.said}" -- ${lapsed ? "lapsed" : orderPartLabel(status, part, world)}${evidence}${on}${how}${letters}${motionWords}${reason}${note}.`.replace(/\.\.$/, ".");
}

/** The model names the engine's records by id in its reasons ("under active project project-cdc6..."); the player has no use for them. */
export function withoutRecordIds(text: string): string {
  return text.replace(/\s+(?:(?:under|by|via|through)\s+)?(?:active\s+)?(?:project|force|message|agreement|plot|order|procedure)\s+(?:project|force|message|agreement|plot|order|procedure)-[\w-]{6,}/gi, "")
    .replace(/\s*\b(?:project|force|message|agreement|plot|order|procedure)-[0-9a-f]{8}-[\w-]+/gi, "");
}

const FILLER_WORDS = new Set(["the", "and", "from", "with", "for", "that", "this", "into", "once", "then", "have", "will", "make", "build", "raise", "send", "give", "hire", "ordered", "order", "authorized", "authorised", "treasury", "senate", "construct", "construction", "begin", "start", "begun", "train", "after", "when", "ready"]);
const wordsOf = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z]{4,}/g)?.filter((word) => !FILLER_WORDS.has(word)) ?? []);

/** An unfinished work whose label shares two or more of the words of a part ("Construct the road once authorized" / "Road from Rome to Capua"). */
export function projectForWords(world: WorldState, said: string): WorldState["projects"][number] | undefined {
  const wanted = wordsOf(said);
  if (wanted.size === 0) return undefined;
  return world.projects.find((project) => project.status !== "completed" && [...wordsOf(project.label)].filter((word) => wanted.has(word)).length >= Math.min(2, wanted.size));
}

/** The man an appointing part names ("Appoint Gnaeus Cornelius Blasio as its legate"), when he is in the world. */
function personNamedForAppointment(world: WorldState, said: string): WorldState["characters"][number] | undefined {
  if (!/^(?:and\s+|then\s+)?(?:appoint|name|make|install|put)\b/i.test(said.trim())) return undefined;
  // The verb in either case ("Appoint ..." opens most parts), the name by its capitals.
  const wanted = /\b(?:[Aa]ppoint|[Nn]ame|[Mm]ake|[Ii]nstall|[Pp]ut)\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,4})/.exec(said)?.[1]?.trim().toLowerCase();
  if (wanted === undefined) return undefined;
  return world.characters.find((character) => character.name.toLowerCase() === wanted || character.name.toLowerCase().startsWith(wanted));
}

/**
 * Whether the man an appointing part names holds any post or seat anywhere. Not evidence the
 * part was done (he may have held it before, or somewhere else): `toldOutcome` reads only the
 * armies the part itself made. Kept for callers that ask the plain question.
 */
export function appointmentMade(world: WorldState, said: string): { readonly name: string } | undefined {
  const person = personNamedForAppointment(world, said);
  if (person === undefined) return undefined;
  const holds = world.material.forces.some((force) => force.commanderCharacterId === person.id || (force.posts ?? []).some((post) => post.characterId === person.id))
    || world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === person.id);
  return holds ? { name: person.name } : undefined;
}

/** The army a part asked to be raised under a name ("called Legio II", "named the Second Field Army"), when one by that name exists. */
export function namedForceRaised(world: WorldState, said: string): { readonly name: string; readonly locationId: string } | undefined {
  // Said as an order to raise it ("Raise a second army called Legio II"), not a speech or a petition that happens to use the word.
  if (!/^(?:and\s+|then\s+|also\s+|please\s+)?(?:raise|levy|muster|form|create|recruit)\b/i.test(said.trim())) return undefined;
  const wanted = /\b(?:called|named|to be called|to be named)\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+[A-Z0-9][\w'’-]*){0,3})/.exec(said)?.[1]?.trim();
  if (wanted === undefined) return undefined;
  const key = wanted.toLowerCase();
  const force = world.material.forces.find((candidate) => candidate.name.toLowerCase() === key || candidate.name.toLowerCase().startsWith(key));
  return force === undefined ? undefined : { name: force.name, locationId: force.locationId };
}

/** Whole sentences up to a length, never a word cut in half. */
function sentencesWithin(text: string, max: number): string {
  if (text.length <= max) return text.replace(/[.\s]+$/, "");
  const sentences = text.split(/(?<=[.!?])\s+/);
  let kept = "";
  for (const sentence of sentences) {
    if ((kept + " " + sentence).trim().length > max) break;
    kept = `${kept} ${sentence}`.trim();
  }
  return (kept === "" ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : kept).replace(/[.\s]+$/, "");
}

const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);

/** The heading the outcome lines stand under, so the page can set them apart from the prose. */
export const ORDER_OUTCOME_HEADING = "What came of the order:";

/**
 * The entries with the outcome lines set under a passage of the day they were
 * read on -- `atInstantSortKey`, the end of the report -- the one of those
 * holding most of the order's facts, else the latest; or, when no passage
 * reaches that day, in an entry of their own dated then.
 *
 * The lines are read from the world as the report left it, and they were set
 * under the passage holding the order's facts, dated the day it was given:
 * "the Senate refused it" stood in an entry dated a fortnight before the vote
 * (E8).
 */
export function withOrderOutcomes(
  entries: readonly ChronicleEntry[],
  lines: readonly string[],
  orderFactIds: readonly string[],
  atInstantSortKey: number,
): readonly ChronicleEntry[] {
  if (lines.length === 0) return entries;
  const ofTheOrder = new Set(orderFactIds);
  const scored = entries.map((entry, index) => ({ index, held: entry.factIds.filter((id) => ofTheOrder.has(id)).length, current: entry.toInstantSortKey >= atInstantSortKey }));
  const best = scored.filter((entry) => entry.current).sort((a, b) => b.held - a.held || b.index - a.index)[0];
  const block = `${ORDER_OUTCOME_HEADING}\n${lines.map((line) => `- ${line}`).join("\n")}`;
  if (best !== undefined) {
    return entries.map((entry, index) => index !== best.index ? entry : { ...entry, body: `${entry.body.trimEnd()}\n\n${block}` });
  }
  return [...entries, {
    kind: "recorded",
    title: "What came of the order",
    body: block,
    factIds: [],
    subjects: [],
    tags: [],
    changes: [],
    quote: null,
    fromInstantSortKey: atInstantSortKey,
    toInstantSortKey: atInstantSortKey,
  }];
}

/**
 * Whether a passage says a part of an order was done when the world says it
 * was not. The historian was handed "no crossing is recorded" and wrote that
 * the legion would be carried over; the record then held both. Only the
 * words for a thing finished are looked for, and only against a part that is
 * not: a passage may say what was begun, allowed or asked for.
 */
export function claimsItDone(body: string, status: ReturnType<typeof orderPartStatus>): boolean {
  if (status === "achieved") return false;
  if (assertsWords(body, DONE_WORDS)) return true;
  // Said begun with nothing begun: a part under way, allowed or waiting may say it started (1.7).
  return NOTHING_BEGUN.has(status) && assertsWords(body, BEGUN_WORDS);
}

/**
 * Whether a passage says, without denying it, what the words name. "The
 * legion never arrived at Messana" says the opposite of arriving, and is
 * the passage telling the truth. A word list and a few words of negation
 * before it: a guard against the common overclaims, not a reading of
 * meaning. A sentence it cannot read is let through, not trusted.
 */
export function assertsWords(body: string, words: RegExp): boolean {
  const pattern = new RegExp(words.source, "gi");
  for (const sentence of body.split(/(?<=[.!?;])\s+/)) {
    for (const match of sentence.matchAll(pattern)) {
      // The clause it stands in, up to the word: "...but the legion never" before "arrived".
      const before = sentence.slice(0, match.index).split(/[,;:]|\b(?:but|and|while|although|though|whereas)\b/i).at(-1) ?? "";
      if (!NEGATED.test(before)) return true;
    }
  }
  return false;
}

/** Words that deny what follows in the same clause: "never arrived", "had not yet landed", "failed to reach". */
const NEGATED = /\b(?:never|not|no|nor|neither|without|nobody|none|cannot|failed to|unable to|yet to|no longer)\b|n't\b/i;

const DONE_WORDS = /\b(arrived|landed|made landfall|came ashore|put ashore|went ashore|disembarked|set foot (?:on|in)|crossed over|crossed the strait|made the crossing|reached|marched into|entered the city|was completed|were completed|was finished|were finished|was carried out|were carried out|accomplished|achieved|succeeded|was done|stands now in|now stood in|was killed|were killed|was slain|were slain|was destroyed|were destroyed|was annihilated|were annihilated|was wiped out|were wiped out|was put to the sword|were put to the sword|was found and killed|were found and killed|was taken|were taken|was captured|were captured|was seized|were seized|fell to|surrendered to|opened (?:its|their) gates|was appointed|were appointed|was installed|took up (?:his|the) post|was paid|were paid|was handed over|were handed over|was signed|was concluded|was ratified|was sealed|was delivered|were delivered)\b/i;
const BEGUN_WORDS = /\b(began|had begun|was begun|were begun|was started|were started|commenced|got under way|set out|set sail|put to sea|broke ground|was launched|were launched)\b/i;
/** Statuses with nothing yet set going in the world. */
const NOTHING_BEGUN: ReadonlySet<ReturnType<typeof orderPartStatus>> = new Set(["unanswered", "refused", "failed", "blocked", "pending", "acknowledged", "stalled"]);
