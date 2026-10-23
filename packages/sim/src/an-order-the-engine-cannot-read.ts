import { kmFrom, readOffice, type Office, type OrchestratorOutput, type ScenarioClock, type ScenarioWarfareRules, type SuccessionRule, type WorldState } from "@chronica/shared";
import { forcesUnder } from "./order-templates";

/**
 * An order the engine cannot read gets an honest reply, not a promise (the user's rule, 2026-10-08).
 *
 * The orchestrator is still asked, as it was, for every order that is not one of the templates (`order-templates.ts`, `march-template.ts`): a political, long or conditional
 * order is its work. But where it too wrote nothing that could be done -- no act, no delegation, no goal, no reason -- the order came to a promise, and the ledger said
 * "ordered; no sign of it yet" for ever. Now the order is answered the day it is given, in the words of the age: "I do not know how to carry that out: what is open to you is
 * ...", with two or three things that are open to this man, drawn from the charge he holds (`readOffice`) and from the orders the engine does read.
 */

/** The opening words of an order given as an order: a command, not a man telling what he is doing, nor a question. */
const COMMAND = /^(?:please\s+)?(?:build|raise|levy|muster|march|send|find|hold|set|make|give|take|appoint|name|order|have|get|bring|buy|sell|hire|pay|put|lay|declare|attack|seize|capture|fortify|arm|train|equip|repair|increase|lower|reduce|ban|forbid|punish|reward|grant|free|release|banish|arrest|summon|convene|strengthen|improve|rebuild|conquer|subdue|win|crush|destroy|punish|prepare|organi[sz]e|arrange|enforce|impose|abolish|open|close|withdraw|advance|winter|feed|provision|supply|secure|guard|defend|protect|spy|bribe|persuade|convince|win\s+over)\b/i;

/** What a man's own words say of what he does is not an order for the engine; nor is a question. */
export function isGivenAsAnOrder(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !/\?\s*$/.test(trimmed) && COMMAND.test(trimmed);
}

/** The words of the reply, before the list. */
export const NO_WAY = "I do not know how to carry that out";

export interface Hints {
  readonly world: WorldState;
  readonly playerId: string;
  readonly offices: readonly Office[];
  readonly clock?: ScenarioClock | undefined;
  readonly successionRules?: readonly SuccessionRule[] | undefined;
  readonly warfare?: ScenarioWarfareRules | undefined;
}

const lower = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);

/** Two or three things open to this man, said as orders he might give: his own army first, then what his charge lets him do alone, then what he may lay before a body. */
export function whatIsOpenTo(hints: Hints): string[] {
  const { world, playerId } = hints;
  const player = world.characters.find((character) => character.id === playerId);
  if (player === undefined) return [];
  const found: string[] = [];
  const army = forcesUnder(world, playerId, hints.warfare)[0];
  if (army !== undefined) {
    found.push(`"find supply for ${army.name}"`);
    const near = [...kmFrom(world, army.locationId, { budgetKm: 260 }).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .map(([id]) => world.map.provinces.find((province) => province.id === id)).find((province) => province !== undefined && province.id !== army.locationId && province.name.length >= 4);
    if (near !== undefined) found.push(`"march ${army.name} to ${near.name}"`);
  }
  const view = readOffice(world, playerId, hints.offices, hints.clock, hints.successionRules ?? []);
  for (const charge of view.charges) {
    for (const line of charge.alone) {
      if (found.length >= 3) break;
      found.push(`${lower(line.deed)}${line.withinWords === null ? "" : ` (${line.withinWords.replace(/^, /, "")})`}, which is yours alone as ${charge.label}`);
    }
    for (const line of charge.byTheBody) {
      if (found.length >= 3) break;
      found.push(`to lay before ${line.body ?? "the chamber"} a motion ${lower(line.deed.replace(/^(?:lay|set|make|declare|raise)\s+/i, "on "))}`);
    }
  }
  if (found.length < 3 && player.polityId !== null) {
    const here = world.map.provinces.find((province) => province.id === player.locationProvinceId);
    if (view.charges.length > 0 && here !== undefined && here.controllerPolityId === player.polityId) found.push(`"build a depot at ${here.name}"`);
    else if (view.charges.length === 0) found.push(`to write to a man who can do it, or to ask him for it`);
  }
  if (found.length < 2) found.push(`to put it as a letter, or to say plainly what you wish done and by whom`);
  return found.slice(0, 3);
}

/** The reply, in one line of at most three hundred characters (a part's reason is no longer). */
export function replyFor(hints: Hints): string {
  const list = whatIsOpenTo(hints);
  const opening = `${NO_WAY}: what is open to you is `;
  let reply = `${opening}${list.join("; ")}.`;
  while (reply.length > 300 && list.length > 1) { list.pop(); reply = `${opening}${list.join("; ")}.`; }
  return reply.length > 300 ? `${reply.slice(0, 297).replace(/\s+\S*$/, "")}...` : reply;
}

/** Whether the orchestrator's answer to this order is only a promise: nothing to be done, nobody told to do it, and no reason given. */
export function cameToAPromise(output: OrchestratorOutput): boolean {
  if (output.facts.length > 0 || output.deltas.length > 0 || output.delegations.length > 0 || output.schedule.length > 0 || output.playerDecision !== null || (output.watch ?? null) !== null) return false;
  return output.intent.parts.every((part) => part.acts.length === 0 && (part.deferredActs ?? []).length === 0 && part.goals.length === 0 && part.factLocalIds.length === 0 && (part.whyNot ?? "").trim() === "" && part.spend === null && part.afterParts === undefined);
}

/**
 * The answer with its promise made an honest reply. Unchanged where the order was no command, where anything at all was written for it, or where there is nobody to give it to.
 */
export function withTheHonestReply<T extends { readonly output: OrchestratorOutput }>(orchestration: T, orderText: string | null, hints: Hints): T {
  if (orderText === null || !isGivenAsAnOrder(orderText) || !cameToAPromise(orchestration.output)) return orchestration;
  const reply = replyFor(hints);
  const said = orderText.trim().slice(0, 200);
  const { output } = orchestration;
  const parts = output.intent.parts.length === 0
    ? [{ said, acts: [], goals: [], spend: null, factLocalIds: [], whyNot: reply }]
    : output.intent.parts.map((part) => ({ ...part, whyNot: reply }));
  return { ...orchestration, output: { ...output, narrativeSummary: reply, intent: { ...output.intent, parts } } };
}
