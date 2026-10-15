/**
 * The merchant's sanity run (docs/economy.md, "What land and trade pay"): what a man of the age makes of a first fortune, five years on, three ways.
 *
 *   npx tsx scripts/merchant-sanity.mts [years=5]
 *
 * Each way starts a Roman private man with 40,000 drachmae (a merchant's honest start) in the Punic opening, with a model that never acts:
 *   - an estate: the largest he can afford, held for the years;
 *   - a venture: a regular trade (the "marked" band) from Rome to Syracuse, its profit left to run;
 *   - a firm: founded with his whole purse, run by the rules (`merchant-houses.ts`).
 * It reports his worth (purse, plus what his estate cost, plus the cost of the cargoes he has out) at each year's end and the yearly rate, against a legionary's
 * 120 drachmae a year. No provider is called.
 */
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, estateTerms, ventureTerms, type WorldState } from "@chronica/shared";
import { applyDeltas, createIdFactory } from "@chronica/sim";
import { runDeterministicTick } from "../packages/sim/src/tick";

const years = Number(process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) ?? "5");
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const MAN = "manius-curius";
const START = 40_000;
const base = (): WorldState => {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  return { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: START } : account)) } };
};
const context = (seed: string) => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character" as const, id: MAN }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory(seed), gameId: "merchant-sanity", playerCharacterId: MAN, creditAccepted: true,
});
const purseOf = (world: WorldState): number => world.material.accounts.find((account) => account.id === "curius-purse")!.balance;

/** What he is worth: his purse, the cargoes he has out at cost, and the land at what it cost him. */
function worth(world: WorldState, landCost: number, house: boolean): number {
  const out = world.material.ventures.filter((venture) => venture.ownerCharacterId === MAN && venture.status === "running").reduce((sum, venture) => sum + (venture.cargo?.cost ?? 0), 0);
  void house;
  // What he owes the seller on a cargo bought on credit (`payOrBorrow`) is no part of what he is worth: a venture of 76,650 bought with 36,000 down is 40,650 of debt.
  const owed = world.material.loans.filter((loan) => loan.status === "active" && loan.borrowerAccountId === "curius-purse").reduce((sum, loan) => sum + loan.outstanding, 0);
  return purseOf(world) + out + landCost - owed;
}

/** His worth at each year's end, as a list. */
function worthByYear(label: string, start: { world: WorldState; landCost: number; house: boolean }, offset = 0): number[] {
  let world = start.world;
  const out: number[] = [];
  for (let year = 1; year <= years; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const toDay = offset + (year - 1) * 360 + month * 30;
      world = runDeterministicTick({ world, toDay, ids: createIdFactory(`${label}-${toDay}`), warfare: definition.warfare }).world;
    }
    out.push(Math.round(worth(world, start.landCost, start.house)));
  }
  return out;
}

// What he has anyway: the scenario gives Curius an estate and a salary of his own, so what an investment makes is what it adds to his worth over the same years without it.
const control = worthByYear("control", { world: base(), landCost: 0, house: false });
console.log(`control  (does nothing)  ${control.map((value, index) => `y${index + 1} ${value.toLocaleString("en")}`).join("  ")}`);

const SEEDS = 8;
function run(label: string, open: (world: WorldState, seed: string) => { world: WorldState; landCost: number; house: boolean }): void {
  const rates: number[] = [];
  let shown = "";
  for (let n = 0; n < SEEDS; n += 1) {
    const seed = `${label}-s${n}`;
    const result = runOnce(seed, open);
    rates.push(result.rate);
    if (n === 0) shown = result.line;
  }
  rates.sort((a, b) => a - b);
  const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  console.log(`${label.padEnd(16)} first seed: ${shown}
${"".padEnd(16)} over ${SEEDS} seeds: mean ${(mean * 100).toFixed(1)}% a year, median ${(rates[Math.floor(rates.length / 2)]! * 100).toFixed(1)}%, worst ${(rates[0]! * 100).toFixed(1)}%, best ${(rates[rates.length - 1]! * 100).toFixed(1)}%`);
}

function runOnce(label: string, open: (world: WorldState, seed: string) => { world: WorldState; landCost: number; house: boolean }): { rate: number; line: string } {
  // A different start day for each seed: what a cargo's fate is rolled on is the day it sailed.
  const offset = (Number(label.slice(label.lastIndexOf("-s") + 2)) || 0) * 11;
  const started = base();
  const opened = open({ ...started, elapsedStep: offset, instant: { ...started.instant, day: offset } }, label);
  const series = worthByYear(label, opened, offset);
  const invested = label.startsWith("firm") ? START : START - purseOf(opened.world);
  const added = series.map((value, index) => value - control[index]!);
  const last = added[added.length - 1]!;
  const rate = invested > 0 ? Math.pow(Math.max(0.01, (invested + last) / invested), 1 / years) - 1 : 0;
  return { rate, line: `put in ${Math.round(invested).toLocaleString("en")}; adds ${added.map((value, index) => `y${index + 1} ${value.toLocaleString("en")}`).join("  ")}  => ${(rate * 100).toFixed(1)}% a year` };
}

run("estate", (world, seed) => {
  const terms = estateTerms(world, PUNIC_IDS.rome, "slight")!;
  const result = applyDeltas(world, [WorldDeltaSchema.parse({ op: "holding_create", localId: "farm", title: "A farm on the Anio", provinceId: PUNIC_IDS.rome, holderCharacterRef: MAN, band: "slight", priceFromAccountRef: "curius-purse", reason: "He buys land." })], context(seed));
  return { world: result.world, landCost: terms.price, house: false };
});
for (const [name, to] of [["capua", PUNIC_IDS.capua], ["syracuse", PUNIC_IDS.syracuse], ["carthage", PUNIC_IDS.carthage]] as const) {
  run(`trade-${name}`, (world, seed) => {
    const result = applyDeltas(world, [WorldDeltaSchema.parse({ op: "trade_venture_open", localId: "run", title: `Grain to ${name}`, ownerCharacterRef: MAN, fromProvinceId: PUNIC_IDS.rome, toProvinceId: to, band: "marked", paidFromAccountRef: "curius-purse", reason: "A cargo." })], context(seed));
    // A land venture has no cargo to count: what he paid for it is an asset that returns a share a month, as an estate's price is (a cargo's cost is counted while it is out).
    const bought = result.world.material.ventures.at(-1);
    return { world: result.world, landCost: bought?.cargo === undefined ? ventureTerms(world, bought!.fromProvinceId, bought!.toProvinceId, "marked")!.price : 0, house: false };
  });
}
run("firm", (world, seed) => {
  const result = applyDeltas(world, [WorldDeltaSchema.parse({ op: "house_found", name: "The negotiatores of Curius", kind: "grain", headRef: null, capital: START, reason: "To trade." })], context(seed));
  return { world: result.world, landCost: 0, house: true };
});
