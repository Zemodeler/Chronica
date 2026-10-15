import {
  FactProposalSchema,
  WorldDeltaSchema,
  chargeHolders,
  coinagesOf,
  economyOf,
  fitStrengthOf,
  greedOf,
  holdersOfLever,
  isNavalForce,
  isOwnToDo,
  LUSTRUM_DAYS,
  lastCensus,
  liveProvinceIds,
  mayAct,
  monthlyTakings,
  readDepartments,
  spendingAllowance,
  stableHash,
  standardOf,
  warStanding,
  warsOf,
  type ActKind,
  type Character,
  type FactProposal,
  type OrderAttempt,
  type PoliticalProcedure,
  type StatecraftEntry,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { readBoard, type PowerReading } from "./board";
import { defianceOf } from "./insubordination";
import { readTheBooks, grainStress, motionsByPower, qualityOf, weigh, type Asked, type Books, type Matter } from "./fiscal-officers";
import { coinIsMoved, debaseStepFor, strainOf, taxTriedFirst, DEBASE_COOLDOWN_DAYS } from "./fiscal-strain";
import { grainPrice } from "./grain";
import { housesFor, monthlyBill, victuallerOf } from "./army-victualling";
import { suppliedByDelegation } from "./supply-plan";
import type { StatecraftDecision, StatecraftInput } from "./statecraft";
import { safeLocalId } from "./safe-local-id";

/**
 * The magistrates at their charges, by rule (docs/plans/government.md, "H2 as built").
 *
 * Each month, for every power nobody plays, the men who hold a charge do what such a man did, through the ordinary deltas, so that authority, the
 * audits and the money audit apply to a magistrate's act as to anybody's. There is a small registry: a charge, and the routine that reads its state and
 * acts inside the man's competence (`mayAct`). What is beyond it is laid before the chamber that holds the power (`weigh`, the same motion the
 * quaestor moves); nothing is counselled and no model is asked.
 *
 *  - **The aediles** (the grain and the markets): bread out of the chest in a dear season, within what they may give alone (a month of what the power takes in),
 *    the rest the Senate's; the games of the year within their allowance; the ambitious give games from their own purses.
 *  - **The consuls and the generals** (the levy and the host): the *dilectus* when a war is on and the host is thin, in the month the year's magistrates take
 *    office; the contingents the allies owe by their foedus when their leader is at war; bread bought for an army that is hungry, out of the chest.
 *  - **The praetor** (the courts): a case against a man whose hand in the chest an audit has found, laid before the court that judges (the Hundred and Four in
 *    Carthage, the Senate or the people elsewhere); never twice for the same man.
 *  - **The pontiffs** (the rites): the festival of the year, from the chest, to calm a city; the augurs' stop is `bodies.ts`'s.
 *  - **The censors** (the roll): the census every fifth year, and what it counts the tax roll counts truly (`material/taxation.ts`).
 *  - **The mint**: where the coin may not be touched by the man at the books (a quaestor), the man who may move it lays the lighter coin before the Senate in extremis.
 *  - **The foreign letters**: a power that is losing a war sends to ask for talks, in the hand of the man who keeps its letters.
 *
 * **The man.** His skill is that of his charge (`readDepartments`, with his temper); a poor one acts late, some months not at all. His greed skims what he
 * handles (`skimTheHand`, found by audits like any graft); one who thinks ill of the head of state or who is too proud may refuse or put it off
 * (`defianceOf`, the same reckoning as an order refused). Nobody's act here is the player's or a model-played ruler's: a power the player rules is left
 * to him, a man the model plays is left to the model, and the books of a played ruler follow the rule written for them (`played-ruler-books.ts`).
 *
 * Bounded: O(powers) a month plus one walk of the books, the hubs and the board; a power's routine looks for its man only when its own condition
 * holds. At most one fact a power a month, only for a power with something live in it (`liveProvinceIds`); the log keeps what each routine did
 * (`STATECRAFT_LOG_MAX`), and each routine's cooldown is read off it.
 */

/** The opening weeks are the player's. */
const QUIET_OPENING_DAYS = 45;
const MONTH = 30;
const YEAR = 360;

/** The charges, each with its own cooldown: the days a routine waits after it last did its work. */
export const REST_DAYS = { grain: 45, games: 330, dilectus: 300, muster: 240, supply: 20, justice: 60, festival: 330, census: 1_700, mint: 365, embassy: 150, scheme: 330 } as const;
/** Grain at a famine price in this share of a power's hubs calls for bread out of the chest. */
export const DEARTH_SHARE = 0.25;
/** The month of the year in which the year's magistrates of a republic that elects its heads take up the levy (the Kalends of March: the third month). */
export const DILECTUS_MONTH = 2;
/** The most men a dilectus or a contingent calls out, and the fewest worth the name. */
export const LEVY_CAP = 20_000;
export const LEVY_FLOOR = 800;
/** An ally sends what it can: a contingent is worth sending at this many men. */
export const MUSTER_FLOOR = 300;
/** A host's thinness: it is thin when it fields less than this share of what its levy could raise. */
export const THIN_HOST_SHARE = 0.35;
/** How many armies a power's supply feeds in a month. */
export const ARMIES_FED_A_MONTH = 2;
/** An army of this many men or more is fed by a house under contract where the power has one (six months: the term the contractors of the Republic took), the smaller by the chest's purchase. */
export const CONTRACT_FROM_MEN = 1_500;
export const CONTRACT_DAYS = 180;
/** Days past what an army has been provisioned for before its contractor's bread is called late and the chest buys. */
export const SUPPLY_LATE_DAYS = 21;
/** Every fifth year, the lustrum. */
/** The year in which a roll counted five years ago is still held truly. */
export const MAX_CASES_A_MONTH = 1;

const delta = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
const fact = (raw: Record<string, unknown>): FactProposal => FactProposalSchema.parse(raw);

/** What a man's own hand keeps of what he handles, carried out by the burst after the act (`skimTheHand`). */
export interface Skim {
  readonly manId: string;
  readonly polityId: string;
  readonly handled: number;
  readonly cause: string;
}

export type MagistrateInput = Pick<StatecraftInput, "world" | "gameId" | "excludedPolityIds" | "playedByModel" | "playerCharacterId" | "offices" | "warfare">;

/** What a routine decided: who did it, what, and why in the words that begin the log's entry (`kind: ...`, which is how the next month reads it). */
interface Doing {
  readonly man: Character;
  readonly kind: string;
  readonly key?: string;
  readonly text: string;
  readonly why: string;
  readonly deltas: readonly WorldDelta[];
  readonly asked?: readonly Asked[];
  readonly target?: string | null;
  readonly skim?: Skim;
  /** Said as a fact where the power is live, unless the act says it itself (a gift to the people tells its own). */
  readonly speaks: boolean;
  readonly significance?: number;
}

/** What a routine reads: the power, the month, the memory of what its magistrates did. */
interface Cx {
  readonly input: MagistrateInput;
  readonly world: WorldState;
  readonly polity: { readonly id: string; readonly name: string };
  readonly day: number;
  readonly month: string;
  readonly books: Books;
  readonly reader: ReturnType<typeof readDepartments>;
  readonly board: ReadonlyMap<string, PowerReading>;
  readonly motions: ReadonlyMap<string, readonly PoliticalProcedure[]>;
  readonly log: ReadonlyMap<string, number>;
  readonly offices: NonNullable<MagistrateInput["offices"]>;
  readonly roll: (...keys: string[]) => number;
  /** Where the power is the player's, the only armies the officers feed: those he has handed to one (`supply-plan.ts`, `suppliedByDelegation`). */
  readonly only?: ReadonlySet<string> | undefined;
}

type Routine = (cx: Cx) => Doing | null;
type LeverName = Parameters<ReturnType<typeof readDepartments>["skill"]>[1];

// ── The memory ──────────────────────────────────────────────────────────────

const memoryKey = (polityId: string, kind: string, key?: string): string => `${polityId}|${kind}|${key ?? ""}`;

/** The day each routine last did its work, for each power, read off the log of what the rules did: by the words their entries begin with. */
function whenLast(log: readonly StatecraftEntry[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const entry of log) {
    if (entry.act !== "magistrate") continue;
    const match = /^([a-z]+): (?:.*\[([^\]]{1,60})\])?/u.exec(entry.why);
    if (match === null) continue;
    const key = memoryKey(entry.polityId, match[1]!, match[2]);
    if (entry.day >= (last.get(key) ?? -Infinity)) last.set(key, entry.day);
    const bare = memoryKey(entry.polityId, match[1]!);
    if (entry.day >= (last.get(bare) ?? -Infinity)) last.set(bare, entry.day);
  }
  return last;
}

const since = (cx: Cx, kind: string, key?: string): number => {
  const day = cx.log.get(memoryKey(cx.polity.id, kind, key));
  return day === undefined ? Infinity : cx.day - day;
};

// ── The man ─────────────────────────────────────────────────────────────────

/** Whether a man's act belongs to the rules: he is nobody's the player or the model is playing, nor the player's own man. */
function isFree(input: MagistrateInput, man: Character): boolean {
  return man.alive && man.id !== input.playerCharacterId && !input.playedByModel.has(man.id);
}

/**
 * Whether the man will do it this month: a poor one is late (the better, the more months he acts), and one who thinks ill of the head of state or is too proud
 * to be told refuses or puts it off, as an order would be refused (`defianceOf`). Returns why not, or null for yes.
 */
function willing(cx: Cx, man: Character, kind: string, lever: LeverName, urgent = false): { readonly late: boolean; readonly why: string } | null {
  const quality = worth(cx, man, lever);
  const reach = 35 + quality * 0.65 + (urgent ? 25 : 0);
  if (cx.roll(kind, man.id, "late") % 100 >= reach) return { late: true, why: "he was slow to it" };
  const head = cx.reader.rulers(cx.polity.id).find((ruler) => ruler.id !== man.id);
  if (head !== undefined) {
    const defiance = defianceOf(cx.world, { standing: "binding", issuerRef: { kind: "character", id: head.id }, recipientRef: { kind: "character", id: man.id } } as unknown as OrderAttempt);
    if (defiance !== null && cx.roll(kind, man.id, "willful") % 10_000 < defiance.chanceBps) {
      return { late: false, why: defiance.answer === "refuse" ? `would not: ${defiance.why}` : `put it off: ${defiance.why}` };
    }
  }
  return null;
}

/** What the man is worth at a charge, 5 to 100: the skill of the men at the lever and his own temper. */
const worth = (cx: Cx, man: Character, lever: LeverName): number => qualityOf(cx.reader.skill({ kind: "polity", id: cx.polity.id }, lever), man);

/** The first free man who holds a lever of this power, and the first of those who are willing; a power that gave nobody the charge has the head of state do it if he may. */
function manAt(cx: Cx, lever: LeverName, kind: string, options: { readonly urgent?: boolean; readonly act?: ActKind } = {}): { man: Character; refusal: { late: boolean; why: string } | null } | null {
  const holders = holdersOfLever(cx.world, cx.polity.id, lever, cx.offices)
    .map((holder) => cx.world.characters.find((character) => character.id === holder.characterId))
    .filter((man): man is Character => man !== undefined && isFree(cx.input, man));
  for (const man of holders) {
    const refusal = willing(cx, man, kind, lever, options.urgent ?? false);
    if (refusal === null) return { man, refusal: null };
  }
  if (holders.length > 0) return { man: holders[0]!, refusal: willing(cx, holders[0]!, kind, lever, options.urgent ?? false) };
  // Nobody was given the charge: the head of state holds it, if his own power is not the player's and he is not the model's.
  const head = cx.reader.rulers(cx.polity.id).find((ruler) => isFree(cx.input, ruler));
  if (head === undefined) return null;
  if (options.act !== undefined) {
    const may = mayAct(cx.world, head.id, options.act, { offices: cx.offices });
    if (may !== null && !isOwnToDo(may.grade) && may.grade !== "by_the_body") return null;
  }
  return { man: head, refusal: willing(cx, head, kind, lever, options.urgent ?? false) };
}

const nameOf = (world: WorldState, polityId: string): string => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;

/** The province a power is governed from, else any it holds. */
function capitalOf(world: WorldState, polityId: string): string | undefined {
  const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  return (capital === null ? undefined : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id)
    ?? world.map.provinces.find((province) => province.controllerPolityId === polityId)?.id;
}

/** What the matter is put as to the chamber when it is not his to do, and who puts it. */
function ask(cx: Cx, man: Character, matter: Matter, carriedKey?: string): "own" | Asked | null {
  return weigh(cx.world, man, cx.polity, matter, { offices: cx.offices, mine: cx.motions.get(cx.polity.id) ?? [], day: cx.day, month: cx.month, carriedDay: carriedKey === undefined ? undefined : cx.log.get(memoryKey(cx.polity.id, carriedKey)), asked: [] });
}

// ── The aediles: the grain and the markets ─────────────────────────────────

/** Bread for the people in a dear season, then the games of the year, then an ambitious man's own. */
const theAediles: Routine = (cx) => {
  const { world, polity, books } = cx;
  const stress = grainStress(world).get(polity.id);
  const short = stress === undefined || stress.hubs === 0 ? 0 : stress.short / stress.hubs;
  const takings = monthlyTakings(world, polity.id);
  if (takings <= 0) return null;
  if (short < DEARTH_SHARE && Math.floor(cx.day / MONTH) % 12 !== stableHash([polity.id, "games"]) % 12) return null;

  // ── Bread ────────────────────────────────────────────────────────────────
  if (short >= DEARTH_SHARE && since(cx, "grain") >= REST_DAYS.grain && books.balance > books.owed * 2) {
    const found = manAt(cx, "grain", "grain", { urgent: short >= 0.5, act: "grain" });
    if (found !== null && found.refusal === null) {
      const { man } = found;
      const quality = worth(cx, man, "grain");
      const amount = Math.max(500, Math.round(takings * Math.min(1.2, 0.3 + short) * (0.7 + quality / 200)));
      const hungriest = world.map.provinces
        .filter((province) => province.controllerPolityId === polity.id)
        .map((province) => ({ id: province.id, food: world.material.provinceMaterial.find((row) => row.provinceId === province.id)?.foodSecurityBps ?? 10_000 }))
        .sort((a, b) => a.food - b.food || a.id.localeCompare(b.id))[0];
      const months = amount / takings;
      const matter: Matter = {
        kind: "grain", act: "grain", magnitude: months, concerns: ["grain", "spending"], label: `bread be given to the people of ${polity.name} out of the chest`,
        text: `gave bread to the people out of the chest, ${amount} in silver, for grain stood at a famine price in ${stress?.short ?? 0} of ${stress?.hubs ?? 0} of its markets`,
        why: `grain: ${amount} spent on bread (dear in ${stress?.short ?? 0} of ${stress?.hubs ?? 0} markets)`,
        deltas: [delta({
          op: "public_benefaction", payerAccountRef: books.treasuryId, amount, kind: "dole", provinceId: hungriest?.id ?? null,
          reason: `${man.name}, who keeps the grain, gives bread out of the chest: it is dear in ${stress?.short ?? 0} of ${stress?.hubs ?? 0} markets.`.slice(0, 240),
        })],
      };
      const weighed = ask(cx, man, matter, "grain");
      if (weighed === "own") {
        const skim = greedOf(man) >= 25 ? { manId: man.id, polityId: polity.id, handled: amount, cause: `the bread of ${polity.name}` } : undefined;
        return { man, kind: "grain", text: matter.text, why: matter.why, deltas: matter.deltas, speaks: false, ...(skim === undefined ? {} : { skim }) };
      }
      if (weighed !== null) return { man, kind: "grain", text: weighed.text, why: weighed.why, deltas: [], asked: [weighed], speaks: true, significance: 40 };
    }
  }

  // ── Games ────────────────────────────────────────────────────────────────
  // Once a year the aediles give the games out of the chest, on their allowance; the ambitious add a gift of their own to be talked of.
  const feastMonth = stableHash([polity.id, "games"]) % 12;
  if (Math.floor(cx.day / MONTH) % 12 === feastMonth && books.balance > books.owed * 3) {
    const aediles = holdersOfLever(world, polity.id, "grain", cx.offices).filter((holder) => /aedile/i.test(holder.officeId));
    for (const holder of aediles) {
      const man = world.characters.find((character) => character.id === holder.characterId);
      if (man === undefined || !isFree(cx.input, man) || since(cx, "games", man.id) < REST_DAYS.games) continue;
      if (willing(cx, man, "games", "grain") !== null) continue;
      const purse = world.material.accounts.find((account) => account.id === man.personalAccountId)?.balance ?? 0;
      const ambitious = man.mind.drives.status >= 70 && greedOf(man) < 60 && purse >= 1_500;
      // The games out of the chest are the office's (`gamesAllowanceLeft`); a man's own are his to give as he likes.
      const deltas = ambitious
        ? [delta({ op: "public_benefaction", payerAccountRef: null, amount: Math.round(purse * 0.2), kind: "games", provinceId: null, reason: `${man.name} gives games at his own cost: he means to rise.`.slice(0, 240) })]
        : [delta({ op: "public_benefaction", payerAccountRef: books.treasuryId, amount: Math.max(300, Math.round(takings * 0.5)), kind: "games", provinceId: null, reason: `${man.name} gives the games of his year out of the chest.`.slice(0, 240) })];
      return {
        man, kind: "games", key: man.id, speaks: false, deltas,
        text: ambitious ? "gave games at his own cost, to be talked of" : "gave the games of the year out of the chest",
        why: `games: ${man.name}'s games of the year ${ambitious ? "at his own cost [" : "out of the chest ["}${man.id}]`,
      };
    }
  }
  return null;
};

// ── The consuls, the generals and the allies: the levy and the host ─────────

/** The man who has the levy: he who holds it by his charge, else the first of the head of state's colleagues who may, in the order a letter would reach them. */
function levyMan(cx: Cx): { man: Character; refusal: { late: boolean; why: string } | null } | null {
  const holders = holdersOfLever(cx.world, cx.polity.id, "levy", cx.offices).map((holder) => cx.world.characters.find((character) => character.id === holder.characterId))
    .filter((man): man is Character => man !== undefined && isFree(cx.input, man));
  const byCharge = chargeHolders(cx.world, cx.polity.id, "levy", cx.offices).filter((holder) => isOwnToDo(holder.grade))
    .map((holder) => cx.world.characters.find((character) => character.id === holder.characterId))
    .filter((man): man is Character => man !== undefined && isFree(cx.input, man));
  for (const man of [...holders, ...byCharge]) {
    if (!isOwnToDo(mayAct(cx.world, man.id, "levy", { offices: cx.offices })?.grade ?? "alone")) continue;
    const refusal = willing(cx, man, "levy", "levy", true);
    if (refusal === null) return { man, refusal: null };
  }
  const first = [...holders, ...byCharge][0] ?? cx.reader.rulers(cx.polity.id).find((ruler) => isFree(cx.input, ruler));
  return first === undefined ? null : { man: first, refusal: willing(cx, first, "levy", "levy", true) };
}

const theLevy: Routine = (cx) => {
  const { world, polity, board } = cx;
  const reading = board.get(polity.id);
  if (reading === undefined) return null;
  const capital = capitalOf(world, polity.id);
  if (capital === undefined) return null;
  const quality = (man: Character): number => worth(cx, man, "levy");

  // ── The contingents the allies owe: their leader is at war and they field next to nothing ──
  if (reading.leaderId !== null) {
    const leader = board.get(reading.leaderId);
    if (leader !== undefined && leader.wars.length > 0 && reading.fielded < LEVY_FLOOR && since(cx, "muster") >= REST_DAYS.muster) {
      const found = levyMan(cx);
      if (found !== null && found.refusal === null) {
        const men = Math.min(LEVY_CAP, Math.round(reading.levy * 0.3 * (0.6 + quality(found.man) / 150)));
        if (men >= MUSTER_FLOOR) {
          return {
            man: found.man, kind: "muster", speaks: true, significance: 40, target: reading.leaderId,
            text: `sent its contingent to ${leader.name}, ${men} men, as the foedus asks, for ${leader.name} is at war`,
            why: `muster: a contingent of ${men} for ${leader.name}'s war (the foedus)`,
            deltas: [delta({
              op: "force_create", localId: safeLocalId(`contingent_${polity.id}`).slice(0, 60), name: `Contingent of ${reading.name}`.slice(0, 120), polityId: polity.id,
              commanderCharacterRef: found.man.id, controllerCharacterRef: found.man.id, locationId: capital, authorizedStrength: men, payObligationRef: null,
              reason: `${found.man.name} sends the men ${reading.name} owes ${leader.name} by the foedus.`.slice(0, 240),
            })],
          };
        }
      }
    }
  }

  // ── The dilectus: at war, the host thin, in the month the year's magistrates take it up (or any month, where nobody's year turns) ──
  if (reading.wars.length > 0 && reading.leaderId === null && reading.fielded < reading.levy * THIN_HOST_SHARE && since(cx, "dilectus") >= REST_DAYS.dilectus) {
    const found = levyMan(cx);
    if (found !== null && found.refusal === null) {
      const collegial = (mayAct(world, found.man.id, "levy", { offices: cx.offices })?.grade ?? "alone") === "with_colleague";
      const month = Math.floor(cx.day / MONTH) % 12;
      if (!collegial || month === DILECTUS_MONTH || month === (DILECTUS_MONTH + 1) % 12) {
        const men = Math.min(LEVY_CAP, Math.round((reading.levy - reading.fielded) * 0.25 * (0.6 + quality(found.man) / 150)));
        if (men >= LEVY_FLOOR) {
          const matter: Matter = {
            kind: "dilectus", act: "levy", concerns: ["levy"], label: `a levy be held in ${polity.name}`,
            text: `held the levy, ${men} men, for the war with ${reading.wars.map((id) => nameOf(world, id)).join(" and ")}`,
            why: `dilectus: a levy of ${men} for the war (the host fields ${reading.fielded} of ${reading.levy})`,
            deltas: [delta({
              op: "force_create", localId: safeLocalId(`dilectus_${polity.id}_${cx.month}`).slice(0, 60), name: `Levy of ${reading.name}`.slice(0, 120), polityId: polity.id,
              commanderCharacterRef: found.man.id, controllerCharacterRef: found.man.id, locationId: capital, authorizedStrength: men, payObligationRef: null,
              reason: `${found.man.name} holds the levy of ${reading.name}: the host is thin and the war goes on.`.slice(0, 240),
            })],
          };
          const weighed = ask(cx, found.man, matter, "dilectus");
          if (weighed === "own") return { man: found.man, kind: "dilectus", text: matter.text, why: matter.why, deltas: matter.deltas, speaks: true, significance: 50 };
          if (weighed !== null) return { man: found.man, kind: "dilectus", text: weighed.text, why: weighed.why, deltas: [], asked: [weighed], speaks: true, significance: 40 };
        }
      }
    }
  }
  return null;
};

/** Bread bought for the armies in the field that are going hungry, out of the chest, by the man who feeds them: within what he may give, the rest the chamber's. */
const theSupply: Routine = (cx) => {
  const { world, polity, books } = cx;
  const reading = cx.board.get(polity.id);
  if (reading === undefined || (cx.only === undefined && reading.wars.length === 0) || books.balance <= books.owed) return null;
  const hungry = world.material.forces
    .filter((force) => (cx.only === undefined || cx.only.has(force.id)) && force.polityId === polity.id && force.outlaw !== true && fitStrengthOf(force) > 0 && !isNavalForce(force, undefined)
      && force.provisionStatus !== "provisioned" && since(cx, "supply", force.id) >= REST_DAYS.supply
      // An army a house is feeding is left to it, unless the bread has been three weeks late.
      && (victuallerOf(world, force.id) === undefined || force.provisionedThroughStep + SUPPLY_LATE_DAYS < cx.day))
    .sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a) || a.id.localeCompare(b.id))
    .slice(0, ARMIES_FED_A_MONTH);
  if (hungry.length === 0) return null;
  const found = manAt(cx, "supply", "supply", { urgent: true, act: "spending" });
  if (found === null || found.refusal !== null) return null;
  const { man } = found;
  const takings = monthlyTakings(world, polity.id);
  const fed = hungry[0]!;
  // A power with a house that has the means lets the army's feeding to it for half a year, the price and the margin its bread; else the chest buys the month's.
  const letting = victuallerOf(world, fed.id) === undefined && fitStrengthOf(fed) >= CONTRACT_FROM_MEN && housesFor(world, polity.id).length > 0;
  const days = letting ? CONTRACT_DAYS : 30;
  const price = grainPrice(world, polity.id, fed.locationId);
  const cost = letting ? monthlyBill(world, fed) * (CONTRACT_DAYS / 30) : Math.max(1, Math.round((fitStrengthOf(fed) * days / 1_000) * price));
  const allowance = mayAct(world, man.id, "spending", { offices: cx.offices });
  const spent = allowance === null ? 0 : spendingAllowance(world, allowance.officeId, cx.offices)?.spent ?? 0;
  const matter: Matter = {
    kind: "supply", act: "spending", magnitude: takings <= 0 ? Number.POSITIVE_INFINITY : (spent + cost) / takings, concerns: ["spending", "levy"],
    label: letting ? `the feeding of ${fed.name} be let to a firm of ${polity.name}, ${cost} over ${CONTRACT_DAYS / 30} months out of the chest` : `the bread of ${fed.name} be paid for out of the chest of ${polity.name}`,
    text: letting
      ? `let the feeding of ${fed.name} to a firm of ${polity.name} for ${CONTRACT_DAYS / 30} months, some ${cost} out of the chest at the market's price and a margin, for the men were going hungry`
      : `bought ${days} days' bread for ${fed.name}, ${cost} out of the chest, for the men were going hungry`,
    why: `supply: bread for ${fed.name} [${fed.id}], ${cost} from the chest${letting ? ", by contract" : ""}`,
    deltas: [delta({ op: "force_provision", forceRef: fed.id, how: letting ? "contract" : "buy", days, fromProvinceId: null, payAccountRef: books.treasuryId, reason: `${man.name} feeds ${fed.name}: it has eaten what it carried.`.slice(0, 240) })],
  };
  const weighed = ask(cx, man, matter, "supply");
  if (weighed === "own") return { man, kind: "supply", key: fed.id, text: matter.text, why: matter.why, deltas: matter.deltas, speaks: true, significance: 35 };
  if (weighed !== null) return { man, kind: "supply", key: fed.id, text: weighed.text, why: weighed.why, deltas: [], asked: [weighed], speaks: true, significance: 35 };
  return null;
};

// ── The praetor: the cases ──────────────────────────────────────────────────

/** The chamber that judges the men of a power: the court its departments name (the Hundred and Four), else a chamber that holds the judging and binds. */
export function courtOf(world: WorldState, polityId: string): { readonly id: string; readonly name: string } | null {
  const department = world.departments.find((candidate) => candidate.abolishedAtStep === null && candidate.scope.kind === "polity" && candidate.scope.id === polityId
    && candidate.gates.some((gate) => gate.act === "judge_commander"));
  const named = department?.gates.find((gate) => gate.act === "judge_commander")?.institutionId;
  const chambers = world.material.institutions.filter((institution) => institution.polityId === polityId);
  const found = chambers.find((institution) => institution.id === named)
    ?? chambers.find((institution) => institution.advisory !== true && institution.powers?.includes("judgment") === true);
  return found === undefined ? null : { id: found.id, name: found.name };
}

/** The chamber that tries a man for what he took from the chest: Carthage's Hundred and Four, else (for a people that holds assemblies) the people, which judged fines; else the chamber that judges. */
export function courtForTheft(world: WorldState, polityId: string): { readonly id: string; readonly name: string } | null {
  const named = courtOf(world, polityId);
  const examines = world.departments.some((department) => department.abolishedAtStep === null && department.scope.kind === "polity" && department.scope.id === polityId
    && department.gates.some((gate) => gate.act === "judge_commander"));
  if (examines && named !== null) return named;
  const people = world.material.institutions.filter((institution) => institution.polityId === polityId && institution.advisory !== true && institution.franchise === "citizens"
    && institution.powers?.includes("judgment") === true);
  const chosen = people.find((institution) => /tribal|tribut/iu.test(`${institution.id} ${institution.name}`)) ?? people[0];
  if (chosen !== undefined && named !== null && named.id !== chosen.id && /senate|council/iu.test(named.name)) return { id: chosen.id, name: chosen.name };
  return named;
}

/** The case a man's graft makes: one a month at most, for a man an audit found with his hand in the chest, a year after at the latest, and not before. */
const thePraetor: Routine = (cx) => {
  const { world, polity } = cx;
  if (since(cx, "justice") < REST_DAYS.justice) return null;
  const evidence = world.diversions.filter((row) => row.foundAtStep !== null && cx.day - row.foundAtStep <= YEAR && cx.day - row.foundAtStep >= 0 && row.scope.kind === "polity" && row.scope.id === polity.id)
    .sort((a, b) => (a.foundAtStep ?? 0) - (b.foundAtStep ?? 0) || a.id.localeCompare(b.id));
  if (evidence.length === 0) return null;
  const tried = new Set(world.material.politicalProcedures.filter((procedure) => procedure.type === "denunciation" && procedure.subjectKind === "character").map((procedure) => procedure.subjectId));
  const row = evidence.find((candidate) => !tried.has(candidate.byCharacterId) && world.characters.some((character) => character.id === candidate.byCharacterId && character.alive && character.polityId === polity.id));
  if (row === undefined) return null;
  const court = courtForTheft(world, polity.id);
  if (court === null) return null;
  const found = manAt(cx, "courts", "justice");
  if (found === null || found.refusal !== null) return null;
  const { man } = found;
  const accused = world.characters.find((character) => character.id === row.byCharacterId)!;
  if (accused.id === man.id) return null;
  const department = world.departments.find((candidate) => candidate.id === row.departmentId);
  const what = department === undefined ? "the chest" : department.name;
  return {
    man, kind: "justice", key: accused.id, speaks: true, significance: 55, target: null,
    text: `set a day for the case of ${accused.name}, who took ${row.amount} from ${what}, before the ${court.name.replace(/^the\s+/iu, "")}`,
    why: `justice: the case of ${accused.name} for what he took from ${what} [${accused.id}]`.slice(0, 400),
    deltas: [delta({
      op: "political_procedure_open", localId: safeLocalId(`case_${accused.id}_${row.id}`).toLowerCase().replace(/[^a-z0-9_-]/gu, "_").slice(0, 60), type: "denunciation", institutionRef: court.id, sponsorCharacterRef: man.id,
      subjectKind: "character", subjectRef: accused.id, label: `The case of ${accused.name} for what he took from ${what}`.slice(0, 200), resolutionMechanism: "vote", deadlineInDays: 30,
      visibility: "public", enacts: null, concerns: ["punishment"], reason: `An audit found ${row.amount} in ${accused.name}'s hands; ${man.name} brings the case.`.slice(0, 240),
    })],
  };
};

// ── The pontiffs: the rites ─────────────────────────────────────────────────

const thePontiffs: Routine = (cx) => {
  const { world, polity, books } = cx;
  const takings = monthlyTakings(world, polity.id);
  if (takings <= 0 || books.balance < books.owed * 3) return null;
  if (Math.floor(cx.day / MONTH) % 12 !== (stableHash([polity.id, "festival"]) % 12) || since(cx, "festival") < REST_DAYS.festival) return null;
  const found = manAt(cx, "public_rites", "festival");
  if (found === null || found.refusal !== null) return null;
  const { man } = found;
  const amount = Math.max(200, Math.round(takings * 0.15));
  return {
    man, kind: "festival", speaks: false, deltas: [delta({
      op: "public_benefaction", payerAccountRef: books.treasuryId, amount, kind: "feast", provinceId: capitalOf(world, polity.id) ?? null,
      reason: `${man.name} keeps the festival of the year for the gods, out of the chest.`.slice(0, 240),
    })],
    text: "kept the festival of the year", why: "festival: the festival of the year, out of the chest",
  };
};

// ── The censors: the roll ───────────────────────────────────────────────────

const theCensors: Routine = (cx) => {
  const { world, polity } = cx;
  const last = lastCensus(world, polity.id);
  const due = last === null ? Math.floor(cx.day / MONTH) >= stableHash([polity.id, "census"]) % 60 : cx.day - last >= LUSTRUM_DAYS;
  if (!due || since(cx, "census") < REST_DAYS.census) return null;
  const found = manAt(cx, "census", "census");
  if (found === null || found.refusal !== null) return null;
  const { man } = found;
  let counted = 0;
  for (const province of world.map.provinces) {
    if (province.controllerPolityId !== polity.id) continue;
    counted += world.material.provinceMaterial.find((row) => row.provinceId === province.id)?.population ?? 0;
  }
  if (counted <= 0) return null;
  const rounded = Math.round(counted / 100) * 100;
  return {
    man, kind: "census", speaks: true, significance: 45,
    text: `closed the lustrum: the census counted ${rounded} people`,
    why: `census: the roll of ${polity.name} taken, ${rounded} counted`,
    deltas: [delta({
      op: "generic_entity_create", localId: safeLocalId(`census_${polity.id}_${Math.floor(cx.day / YEAR)}`).slice(0, 60), kind: "census", label: `The census of ${polity.name}`.slice(0, 120),
      ownerRef: { kind: "polity", id: polity.id }, attributes: { atStep: cx.day, counted: rounded, by: man.id }, reason: `${man.name} takes the roll.`.slice(0, 240),
    })],
  };
};

// ── The mint ────────────────────────────────────────────────────────────────

/**
 * The coin, where the man at the books has no hand in it: in extremis (war, pay behind, the chest a month from empty, the tribute at its ceiling) the man who
 * may move the coin lays the lighter coin before the chamber (Rome did, in the Second Punic War); a king, or whoever holds it alone, the fiscal officer's own pass has.
 */
const theMint: Routine = (cx) => {
  const { world, polity, books } = cx;
  const reading = cx.board.get(polity.id);
  if (reading === undefined || books.owed <= 0 || since(cx, "mint") < REST_DAYS.mint) return null;
  const strain = strainOf(world, books, polity.id);
  if (!coinIsMoved(strain, books.arrears > 0)) return null;
  const coinage = coinagesOf(world).find((candidate) => candidate.issuerPolityId === polity.id);
  if (coinage === undefined || coinage.silverBps < standardOf(coinage) * 0.6) return null;
  // However the last change was made (the fiscal officer's pass or this one), the mint changes the coin no oftener than a year.
  const struckLast = coinage.history.at(-1);
  if (struckLast !== undefined && cx.day - struckLast.atStep < DEBASE_COOLDOWN_DAYS) return null;
  const rate = economyOf(world).taxPolicies.find((policy) => policy.polityId === polity.id)?.rateBps ?? 0;
  if (!taxTriedFirst(strain, rate >= 1_800)) return null;
  const step = debaseStepFor(strain);
  const mine = chargeHolders(world, polity.id, "coinage", cx.offices).filter((holder) => holder.grade === "by_the_body" && holder.basis !== "other");
  const holder = mine[0];
  if (holder === undefined) return null;
  const man = world.characters.find((character) => character.id === holder.characterId);
  if (man === undefined || !isFree(cx.input, man) || willing(cx, man, "mint", "mint", true) !== null) return null;
  const matter: Matter = {
    kind: "mint", act: "coinage", magnitude: -step, concerns: ["coinage"], label: `${coinage.name} be struck with less silver`,
    text: `the war has emptied the chest and the pay is behind`, why: `mint: ${coinage.name} struck lighter`,
    deltas: [delta({ op: "coinage_debase", coinageId: coinage.id, targetSilverBps: null, stepBps: step, reason: `${man.name} has the mint strike lighter coin: the war has emptied the chest.`.slice(0, 240) })],
  };
  const weighed = ask(cx, man, matter, "mint");
  if (weighed === "own") return { man, kind: "mint", text: `had the mint strike ${coinage.name} lighter, for the war has emptied the chest`, why: matter.why, deltas: matter.deltas, speaks: true, significance: 55 };
  if (weighed !== null) return { man, kind: "mint", text: weighed.text, why: weighed.why, deltas: [], asked: [weighed], speaks: true, significance: 45 };
  return null;
};

// ── The foreign letters: an embassy sent to ask for talks ───────────────────

const theEmbassies: Routine = (cx) => {
  const { world, polity } = cx;
  const reading = cx.board.get(polity.id);
  if (reading === undefined || reading.wars.length === 0 || reading.leaderId !== null || since(cx, "embassy") < REST_DAYS.embassy) return null;
  const losing = reading.wars
    .map((enemy) => ({ enemy, standing: warStanding(world, polity.id, enemy) }))
    .filter(({ enemy, standing }) => standing.score <= -20 && !standing.dictates && warsOf(world.polityAgreements, polity.id).includes(enemy))
    .sort((a, b) => a.standing.score - b.standing.score || a.enemy.localeCompare(b.enemy))[0];
  if (losing === undefined) return null;
  const war = world.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "war"
    && ((agreement.polityId === polity.id && agreement.otherPolityId === losing.enemy) || (agreement.polityId === losing.enemy && agreement.otherPolityId === polity.id)));
  if (war === undefined || cx.day - war.sinceStep < 90) return null;
  const sentLately = world.diplomacy.some((message) => message.fromPolityId === polity.id && message.toPolityId === losing.enemy && message.kind === "peace_talks" && cx.day - message.sentAtStep < REST_DAYS.embassy);
  if (sentLately) return null;
  // The player's own power is written to by the model's voice, and a letter to him is not the rules' to send in another's name.
  const found = manAt(cx, "foreign_letters", "embassy");
  if (found === null || found.refusal !== null) return null;
  const { man } = found;
  const them = nameOf(world, losing.enemy);
  return {
    man, kind: "embassy", speaks: true, significance: 45, target: losing.enemy,
    text: `sent an embassy to ${them} to ask for talks, for the war goes ill`,
    why: `embassy: envoys sent to ${them} to ask for talks (the war stands at ${losing.standing.score}) [${losing.enemy}]`.slice(0, 400),
    deltas: [delta({
      op: "diplomatic_message_send", localId: safeLocalId(`embassy_${polity.id}_${losing.enemy}`).slice(0, 60), kind: "peace_talks", fromPolityId: polity.id, fromCharacterRef: man.id, toPolityId: losing.enemy,
      toCharacterRef: null, subject: `${polity.name} asks to talk of peace`.slice(0, 120), terms: `${polity.name} sends envoys to ${them} to ask on what terms this war may be ended.`.slice(0, 600),
      replyWithinDays: 40, inReplyToRef: null, visibility: "polity", reason: `${man.name} sends the envoys.`.slice(0, 240),
    })],
  };
};

// ── The registry ────────────────────────────────────────────────────────────

/** The charges, and the routine of each. The fiscal officers (`fiscal-officers.ts`), the upkeep and the works (`keeping-the-state.ts`) and the houses (`merchant-houses.ts`) keep theirs where they stand. */
export const ROUTINES: readonly { readonly charge: string; /** Whether the work is done out of a chest the power has. */ readonly chest: boolean; readonly run: Routine }[] = [
  { charge: "the grain and the markets", chest: true, run: theAediles },
  { charge: "the levy", chest: false, run: theLevy },
  { charge: "the supply of the host", chest: true, run: theSupply },
  { charge: "the courts", chest: false, run: thePraetor },
  { charge: "the rites", chest: true, run: thePontiffs },
  { charge: "the census", chest: false, run: theCensors },
  { charge: "the mint", chest: true, run: theMint },
  { charge: "the foreign letters", chest: false, run: theEmbassies },
];

/**
 * The magistrates' decisions for the month, in power order; nothing is applied. `already` are the decisions this month's other passes have made (the fiscal
 * officers'), so that the same matter is not done twice in a pass.
 */
export function decideMagistrates(input: MagistrateInput, already: readonly StatecraftDecision[] = []): StatecraftDecision[] {
  const { world } = input;
  const day = world.instant.day;
  if (day < QUIET_OPENING_DAYS) return [];
  const books = readTheBooks(world);
  const reader = readDepartments(world);
  const board = readBoard(world);
  const motions = motionsByPower(world);
  const log = whenLast(world.statecraft.log);
  const offices = input.offices ?? [];
  const month = String(Math.floor(day / MONTH));
  let live: Set<string> | undefined;
  const isLive = (polityId: string): boolean => {
    if (live === undefined) {
      const provinces = liveProvinceIds(world);
      live = new Set(world.map.provinces.filter((province) => province.controllerPolityId !== null && provinces.has(province.id)).map((province) => province.controllerPolityId!));
    }
    return live.has(polityId);
  };
  const decisions: StatecraftDecision[] = [];
  // The fiscal officer's own act, or his motion to the chamber that holds the mint: the same matter is not put twice in a month.
  const fiscalCoin = new Set(already.filter((decision) => decision.deltas.some((entry) => entry.op === "coinage_debase" || (entry.op === "political_procedure_open" && /struck with less silver/.test(entry.label)))).map((decision) => decision.polityId));

  const served = suppliedByDelegation(world, input.playerCharacterId, day);
  for (const polity of [...world.map.polities].sort((a, b) => a.id.localeCompare(b.id))) {
    // A power the player rules is not the officers' to move: but the army he has handed to one to feed is kept fed, month by month, by him.
    const only = input.excludedPolityIds.has(polity.id) ? new Set([...served].filter((id) => world.material.forces.some((force) => force.id === id && force.polityId === polity.id))) : undefined;
    if (only !== undefined && only.size === 0) continue;
    const kept = books.get(polity.id);
    const book: Books = kept ?? { treasuryId: "", balance: 0, owed: 0, arrears: 0, income: 0, debt: 0 };
    const cx: Cx = {
      input, world, polity: { id: polity.id, name: polity.name }, day, month, books: book, reader, board, motions, log, offices,
      roll: (...keys) => stableHash([input.gameId, "magistrate", polity.id, month, ...keys]),
      ...(only === undefined ? {} : { only }),
    };
    let spoke = false;
    for (const { run, chest } of ROUTINES) {
      if (chest && kept === undefined) continue;
      if (only !== undefined && run !== theSupply) continue;
      const doing = run(cx);
      if (doing === null) continue;
      if (doing.kind === "mint" && fiscalCoin.has(polity.id)) continue;
      const asked = doing.asked ?? [];
      if (doing.deltas.length === 0 && asked.length === 0) continue;
      const news = doing.speaks && !spoke && isLive(polity.id);
      if (news) spoke = true;
      const summary = `${doing.man.name} of ${polity.name} ${doing.text}.`.slice(0, 400);
      decisions.push({
        polityId: polity.id,
        actorCharacterId: doing.man.id,
        act: "magistrate",
        targetPolityId: doing.target ?? null,
        why: doing.why.slice(0, 400),
        deltas: [...doing.deltas, ...asked.map((entry) => entry.delta)],
        facts: news
          ? [fact({
            localId: safeLocalId(`magistrate_${doing.kind}_${polity.id}_${month}`).slice(0, 60), kind: "magistrate", summary,
            affectedRefs: [{ kind: "polity", id: polity.id }, { kind: "character", id: doing.man.id }, ...(doing.target == null ? [] : [{ kind: "polity" as const, id: doing.target }])],
            visibility: "public", discoveryState: "public", knowableInDays: 0, significance: doing.significance ?? 35,
          })]
          : [],
        ...(doing.skim === undefined ? {} : { skim: doing.skim }),
      });
    }
  }
  return decisions;
}
