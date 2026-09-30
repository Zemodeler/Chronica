import { ORDER_PART_STATUS_LABEL, orderPartStatus, type OrderPart, type WorldState } from "@chronica/shared";
import type { ChronicleEntry } from "./chronicle";

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
export function orderOutcomeLines(world: WorldState, orderRecordId: string): readonly string[] {
  const order = world.orders.find((candidate) => candidate.id === orderRecordId);
  if (order === undefined) return [];
  const told = order.parts.map((part) => lineOf(world, part, order.actorCharacterId));
  // A one-part order carried out is answered by its passage, and a line
  // saying "done" under it says nothing the passage did not.
  if (order.parts.length === 1 && orderPartStatus(world, order.parts[0]!) === "done" && order.parts[0]!.note === null) return [];
  return told;
}

function lineOf(world: WorldState, part: OrderPart, actorId: string): string {
  const status = orderPartStatus(world, part);
  const project = part.workRefs.find((ref) => ref.kind === "project");
  const work = project === undefined ? undefined : world.projects.find((candidate) => candidate.id === project.id);
  const next = work?.milestones.find((milestone) => milestone.status === "pending");
  const how = status === "started" && work !== undefined
    ? `: ${work.label}${next === undefined ? "" : `, next ${lowerFirst(next.label)}`}`
    : "";
  const why = part.refusal ?? part.whyNot;
  const reason = why === null || status === "done" || status === "started" ? "" : `: ${sentencesWithin(why.replace(/\s+/g, " "), 320)}`;
  // Secret work says what it cost and whose money it was, to the man who paid.
  const plotRef = part.workRefs.find((ref) => ref.kind === "plot");
  const plot = plotRef === undefined ? undefined : world.covertPlots.find((candidate) => candidate.id === plotRef.id);
  const payer = plot?.fundingAccountId == null ? null : world.material.accounts.find((account) => account.id === plot.fundingAccountId);
  const paid = plot === undefined || plot.spend <= 0 ? "" : ` (${plot.spend} paid${payer?.owner.kind === "character" && payer.owner.id === actorId ? " from your own purse" : payer?.owner.kind === "polity" ? " from the treasury" : ""})`;
  const note = `${paid}${part.note === null ? "" : ` (${part.note})`}`;
  return `"${part.said}" -- ${ORDER_PART_STATUS_LABEL[status]}${how}${reason}${note}.`.replace(/\.\.$/, ".");
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
 * The entries with the outcome lines set under the one that answers the order
 * -- the entry holding most of its facts -- or, when none does, in an entry of
 * their own at the end.
 */
export function withOrderOutcomes(
  entries: readonly ChronicleEntry[],
  lines: readonly string[],
  orderFactIds: readonly string[],
  atInstantSortKey: number,
): readonly ChronicleEntry[] {
  if (lines.length === 0) return entries;
  const ofTheOrder = new Set(orderFactIds);
  const scored = entries.map((entry, index) => ({ index, held: entry.factIds.filter((id) => ofTheOrder.has(id)).length }));
  const best = scored.filter((entry) => entry.held > 0).sort((a, b) => b.held - a.held || a.index - b.index)[0];
  const block = `${ORDER_OUTCOME_HEADING}\n${lines.map((line) => `- ${line}`).join("\n")}`;
  if (best !== undefined) {
    return entries.map((entry, index) => index !== best.index ? entry : { ...entry, body: `${entry.body.trimEnd()}\n\n${block}` });
  }
  const last = entries.at(-1);
  return [...entries, {
    kind: "recorded",
    title: "What came of the order",
    body: block,
    factIds: [],
    subjects: [],
    tags: [],
    changes: [],
    quote: null,
    fromInstantSortKey: last?.toInstantSortKey ?? atInstantSortKey,
    toInstantSortKey: last?.toInstantSortKey ?? atInstantSortKey,
  }];
}
