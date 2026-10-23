import { formatWorldDate, letterTally, letterTallyInWords, spentForOrderPart, type ScenarioClock } from "@chronica/shared";
import { goalEvidence, orderPartLabel, orderPartStatus, procedureReasonOf, type OrderPart, type WorldState } from "@chronica/shared";
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

/** One part's line: what it came to, in the engine's words. */
export function lineOf(world: WorldState, part: OrderPart, actorId: string, clock?: ScenarioClock): string {
  const reckoned = orderPartStatus(world, part);
  // "Raise a second army called Legio II": when an army of that name stands in the world, the part is done,
  // whatever work the engine did or did not match to it.
  const raised = namedForceRaised(world, part.said);
  // A work begun for the words of this part ("construct the road") that the engine never tied to it is still its work.
  const unmatched = reckoned === "unanswered" || reckoned === "carried_unverified";
  const begun = unmatched && raised === undefined ? projectForWords(world, part.said) : undefined;
  const appointed = unmatched ? appointmentMade(world, part.said) : undefined;
  const status = (raised !== undefined || appointed !== undefined) && (unmatched || reckoned === "failed") ? "achieved" : begun !== undefined ? "under_way" : reckoned;
  const project = part.workRefs.find((ref) => ref.kind === "project");
  const work = project === undefined ? begun : world.projects.find((candidate) => candidate.id === project.id) ?? begun;
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
  // A siege laid and lifted is failed with nothing else said (a playtest: `"Lay siege to Syracuse..." -- failed.` beside the facts
  // that it was laid and then raised). Say what happened to it, as far as the record shows.
  const raisedSiege = status === "failed" ? part.workRefs.filter((ref) => ref.kind === "siege").map((ref) => world.sieges.find((candidate) => candidate.id === ref.id)).find((siege) => siege?.status === "lifted") : undefined;
  const siegeWhy = raisedSiege === undefined ? null : "the siege was raised before the city fell: the besiegers are no longer before its walls";
  const why = refusalInPeriodWords(world, part, actorId, (status === "refused" ? procedureReasonOf(world, part) : null) ?? part.refusal ?? part.whyNot ?? procedureReasonOf(world, part) ?? siegeWhy);
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
  const note = `${paid}${envelope}${shownNote === null ? "" : ` (${shownNote})`}`;
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

/** "Appoint Gnaeus Cornelius Blasio as its legate": done when that man commands a force, holds a post in one, or holds a seat. */
export function appointmentMade(world: WorldState, said: string): { readonly name: string } | undefined {
  if (!/^(?:and\s+|then\s+)?(?:appoint|name|make|install|put)\b/i.test(said.trim())) return undefined;
  const wanted = /\b(?:appoint|name|make|install|put)\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,4})/.exec(said)?.[1]?.trim().toLowerCase();
  if (wanted === undefined) return undefined;
  const person = world.characters.find((character) => character.name.toLowerCase() === wanted || character.name.toLowerCase().startsWith(wanted));
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
  if (DONE_WORDS.test(body)) return true;
  // Said begun with nothing begun: a part under way, allowed or waiting may say it started (1.7).
  return NOTHING_BEGUN.has(status) && BEGUN_WORDS.test(body);
}

const DONE_WORDS = /\b(arrived|landed|crossed over|made the crossing|reached|was completed|were completed|was carried out|were carried out|accomplished|achieved|succeeded|was done|stands now in|now stood in|was killed|were killed|was slain|were slain|was destroyed|were destroyed|was annihilated|were annihilated|was found and killed|were found and killed|was taken|were taken|was captured|was seized|fell to|was appointed|were appointed|was installed|was paid|were paid|was signed|was concluded|was ratified|was delivered|were delivered)\b/i;
const BEGUN_WORDS = /\b(began|had begun|was begun|were begun|was started|were started|commenced|got under way|set out)\b/i;
/** Statuses with nothing yet set going in the world. */
const NOTHING_BEGUN: ReadonlySet<ReturnType<typeof orderPartStatus>> = new Set(["unanswered", "refused", "failed", "blocked", "pending", "acknowledged", "stalled"]);
