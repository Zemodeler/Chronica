import type { Office } from "../characters/character";
import { promisesOf } from "../characters/promises";
import { readTheBooks } from "../material/books";
import { musterTheForces } from "../material/forces";
import type { WorldState } from "../world/world-state";
import type { ScenarioClock } from "../world/clock";
import type { ScenarioWarfareRules } from "../warfare/battle";
import { whatComesNext } from "./calendar";
import { lettersAwaitingYou } from "./letters-awaiting";
import { ordersUnderWay } from "./under-way";

/**
 * What each object in the Office says about itself right now.
 *
 * The plaque under an object used to say what it was for ("Count your
 * money"), which a player learns once. It now says the current fact ("Short
 * 58 a month"), and an object whose fact wants the player's word carries the
 * seal mark. A quiet room means nothing needs you.
 *
 * Built only from readers that are already station-filtered -- the books,
 * the muster, the calendar, orders under way, letters awaiting an answer,
 * promises -- so it can say nothing the panels behind the objects would not.
 * One line per object at most, in words, with at most one number.
 */

export type RoomObjectId = "council" | "books" | "purse" | "forces" | "standing" | "people" | "self";

export interface RoomObjectState {
  readonly says: string;
  readonly marked: boolean;
}

export type RoomStates = Partial<Record<RoomObjectId, RoomObjectState>>;

const money = (amount: number): string => Math.round(amount).toLocaleString("en-GB");

export function roomStates(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
  warfare?: ScenarioWarfareRules,
): RoomStates {
  if (characterId === null) return {};
  const states: RoomStates = {};

  const underWay = ordersUnderWay(world, characterId, offices, clock);
  if (underWay.length > 0) {
    const stalled = underWay.filter((item) => item.stalled).length;
    states.council = stalled > 0
      ? { says: stalled === 1 ? "An order has stalled" : `${stalled} orders have stalled`, marked: true }
      : { says: underWay.length === 1 ? "One order under way" : `${underWay.length} orders under way`, marked: false };
  }

  // The ledger stand and the strongbox read different books (books.ts): what
  // the player keeps for somebody else, and what is his own.
  const ledgerOf = (books: ReturnType<typeof readTheBooks>): RoomObjectState | undefined => {
    if (books.income.length === 0 && books.expenditure.length === 0) {
      if (books.accounts.length === 0) return undefined;
      const held = books.accounts.reduce((sum, account) => sum + account.balance, 0);
      return { says: `${money(held)} in hand`, marked: false };
    }
    return books.arrears > 0
      ? { says: `Behind on payments: ${money(books.arrears)} owed`, marked: true }
      : books.surplus < 0
        ? { says: `Short ${money(-books.surplus)} a month`, marked: true }
        : books.pressure?.hard === true
          ? { says: "The taxes press hard on the land", marked: true }
          : { says: `${money(books.surplus)} a month to spare`, marked: false };
  };
  const kept = ledgerOf(readTheBooks(world, characterId, offices, "kept"));
  if (kept !== undefined) states.books = kept;
  const own = ledgerOf(readTheBooks(world, characterId, offices, "own"));
  if (own !== undefined) states.purse = own;

  const muster = musterTheForces(world, characterId, offices, clock, warfare);
  if (muster.forces.length > 0) {
    const troubled = muster.forces.find((force) =>
      force.payStatus !== "Paid" && force.payStatus !== "Paid out of what they take"
      || force.provisionLabel === "starving" || force.provisionLabel === "short of supply"
      || (force.authorizedStrength > 0 && force.fitStrength / force.authorizedStrength < 0.6));
    // Ships are counted as ships: a squadron's hulls are not men.
    const armies = muster.forces.filter((force) => !force.naval);
    const fleets = muster.forces.filter((force) => force.naval);
    const men = armies.reduce((sum, force) => sum + force.fitStrength, 0);
    const ships = fleets.reduce((sum, force) => sum + force.fitStrength, 0);
    const counted = [
      ...(armies.length > 0 ? [`${money(men)} men`] : []),
      ...(fleets.length > 0 ? [`${money(ships)} ${ships === 1 ? "ship" : "ships"}`] : []),
    ].join(" and ");
    states.forces = troubled !== undefined
      ? { says: `The ${troubled.name.replace(/^the\s+/i, "")}: ${troubleOf(troubled)}`, marked: true }
      : muster.forces.length === 1
        ? { says: `${counted} at ${muster.forces[0]!.locationLabel}`, marked: false }
        : { says: `${counted} in ${muster.forces.length} forces`, marked: false };
  }

  // The seal case: what is coming for the office itself.
  const coming = whatComesNext(world, characterId, offices, clock, 12);
  const term = coming.find((item) => item.key.startsWith("seat:"));
  const vote = coming.find((item) => item.key.startsWith("procedure:") && item.needsYou);
  if (vote !== undefined) states.standing = { says: `${vote.label} ${vote.whenLabel}`, marked: true };
  else if (term !== undefined) states.standing = { says: `${term.label} ${term.whenLabel}`, marked: term.inDays <= 30 };

  const letters = lettersAwaitingYou(world, characterId, offices, clock);
  if (letters.length > 0) {
    states.people = {
      says: letters.length === 1 ? `${letters[0]!.kindLabel} waits on your answer` : `${letters.length} letters wait on your answer`,
      marked: true,
    };
  }

  const promises = promisesOf(world, characterId, clock).filter((promise) => promise.yours);
  const pressing = promises.filter((promise) => promise.pressing);
  if (pressing.length > 0) states.self = { says: pressing.length === 1 ? "A promise of yours falls due" : `${pressing.length} promises of yours fall due`, marked: true };
  else if (promises.length > 0) states.self = { says: promises.length === 1 ? "You have a promise to keep" : `You have ${promises.length} promises to keep`, marked: false };

  return states;
}

function troubleOf(force: { readonly payStatus: string; readonly provisionLabel: string; readonly fitStrength: number; readonly authorizedStrength: number }): string {
  if (force.provisionLabel === "starving") return "starving";
  if (force.payStatus !== "Paid" && force.payStatus !== "Paid out of what they take") return force.payStatus.toLowerCase();
  if (force.provisionLabel === "short of supply") return "short of supply";
  return "badly under strength";
}
