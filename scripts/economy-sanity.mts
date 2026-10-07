/**
 * The economy's sanity run (docs/economy.md): the Punic opening advanced a
 * number of game years, month by month, with a model that never acts, and a
 * table per polity every few months: people, treasury, what came in, grain's
 * price, development, hubs short of grain, customs, price level, premium.
 * Closes with the money audit over the whole run (unexplained must be 0).
 * No provider is called and no network is touched.
 *
 *   npx tsx scripts/economy-sanity.mts [years=10] [--war] [--every=12] [--polities=rome,carthage,...]
 *
 * `--war` opens a Rome-Carthage war at month 6 and has Carthage sack a Sicilian
 * province, to show scars and trade effects against the peaceful run.
 */
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WorldStateSchema, WorldDeltaSchema, ensureProvinceMaterial, formatWorldDate, priceLevelBpsOf, coinageOfPolity,
  sackTheProvince, treasuryOf, marketGeography, marketPriceBps, GOODS,
  type WorldState,
} from "@chronica/shared";
import { DEFAULT_BUDGET, applyDeltas, auditMoney, combineAudits, emptyAudit, auditInWords, createIdFactory, runSimulationBurst, type SimModelPort, type MoneyAudit } from "@chronica/sim";
import { polityMarkets } from "../packages/sim/src/market-summary";

import { Session } from "node:inspector/promises";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const years = Number(args.find((a) => /^\d+$/.test(a)) ?? "10");
const war = args.includes("--war");
const every = Number((args.find((a) => a.startsWith("--every=")) ?? "--every=12").split("=")[1]);
const chosen = (args.find((a) => a.startsWith("--polities=")) ?? "").split("=")[1]?.split(",") ?? ["rome", "carthage", "syracuse", "samnites", "etruscan-cities", "mamertines"];
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
  },
};

interface Reading { people: number; treasury: number; income: number; grainBps: number; devMean: number; devSpread: number; short: number; hubs: number; customs: number; level: number; premium: number; provinces: number }

function read(world: WorldState, polityId: string, income: number, customs: number): Reading {
  const owned = world.map.provinces.filter((p) => p.controllerPolityId === polityId).map((p) => p.id);
  const mine = new Set(owned);
  const rows = world.material.provinceMaterial.filter((row) => mine.has(row.provinceId));
  const people = rows.reduce((s, r) => s + r.population, 0);
  const devs = rows.map((r) => r.developmentBps ?? 0);
  const mean = devs.length === 0 ? 0 : devs.reduce((s, d) => s + d, 0) / devs.length;
  const sd = devs.length === 0 ? 0 : Math.sqrt(devs.reduce((s, d) => s + (d - mean) ** 2, 0) / devs.length);
  const market = polityMarkets(world).get(polityId);
  const treasuryId = treasuryOf(world, polityId);
  const coin = coinageOfPolity(world, polityId);
  return {
    people, treasury: world.material.accounts.find((a) => a.id === treasuryId)?.balance ?? 0, income,
    grainBps: market?.grainBps ?? 0, devMean: mean, devSpread: sd, short: market?.shortHubs ?? 0, hubs: market?.hubs ?? 0, customs,
    level: priceLevelBpsOf(world, polityId), premium: coin.premiumBps, provinces: owned.length,
  };
}

/** How far apart the provinces of the whole map are in development (v55): p10 / median / p90, the gap between the tenth and the ninetieth, the sd, and any province at the floor or the top of the scale. */
function spreadLine(label: string, state: WorldState): void {
  const values = state.material.provinceMaterial.map((row) => row.developmentBps ?? 0).sort((a, b) => a - b);
  const at = (share: number): number => values[Math.min(values.length - 1, Math.floor(share * values.length))]!;
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length));
  console.log(`  development of all ${values.length} provinces, ${label}: p10 ${at(0.1)} / median ${at(0.5)} / p90 ${at(0.9)}, p90-p10 ${at(0.9) - at(0.1)}, sd ${Math.round(sd)}, mean ${Math.round(mean)}, at the floor ${values.filter((value) => value <= 500).length}, at 10,000 ${values.filter((value) => value >= 10_000).length}`);
}

const idFor = createIdFactory("sanity");
let world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
// `--v50`: the opening as scenario v50 had it (no authored regimes beyond Syracuse's tithe), for a before and after.
if (args.includes("--v50")) {
  world = {
    ...world,
    economy: { ...world.economy!, taxPolicies: world.economy!.taxPolicies.filter((policy) => policy.polityId === "syracuse"), provinceTaxPolicies: [] },
    material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map(({ taxRegime: _a, taxRateBps: _b, ...row }) => row) },
  };
}
let total: MoneyAudit = emptyAudit();
const income = new Map<string, number>();
const customs = new Map<string, number>();
const line = (label: string, readings: Map<string, Reading>): void => {
  console.log(`\n${label}`);
  console.log("polity           provs     people   treasury  income/yr  grain%  devMean  devSd  short/hubs  customs/yr  level%  prem");
  for (const [id, r] of readings) {
    console.log(`${id.padEnd(16)} ${String(r.provinces).padStart(5)} ${String(Math.round(r.people)).padStart(10)} ${String(Math.round(r.treasury)).padStart(10)} ${String(Math.round(r.income)).padStart(10)} ${String(Math.round(r.grainBps / 100)).padStart(7)} ${String(Math.round(r.devMean)).padStart(8)} ${String(Math.round(r.devSpread)).padStart(6)} ${`${r.short}/${r.hubs}`.padStart(10)} ${String(Math.round(r.customs)).padStart(11)} ${String(Math.round(r.level / 100)).padStart(7)} ${String(r.premium).padStart(5)}`);
  }
};
const snapshot = (): Map<string, Reading> => new Map(chosen.map((id) => [id, read(world, id, income.get(id) ?? 0, customs.get(id) ?? 0)]));

const started = Date.now();
line(`START ${formatWorldDate(world.instant, definition.clock)}${war ? " (war variant)" : ""}`, snapshot());
spreadLine("start", world);
const context = () => ({ now: world.instant, actorRef: { kind: "character" as const, id: "gaius-genucius" }, actsForTheWorld: true, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.terrains ?? definition.map.terrains, ids: idFor, gameId: "sanity" });
let target: { id: string; name: string } | null = null;
let profiler: Session | null = null;
const monthsToRun = Number((args.find((a) => a.startsWith("--months=")) ?? `--months=${years * 12}`).split("=")[1]);
for (let month = 0; month < monthsToRun; month += 1) {
  if (war && month === 6) {
    const open = WorldDeltaSchema.parse({ op: "agreement_open", localId: "sanity-war", kind: "war", polityId: "carthage", otherPolityId: "rome", terms: "The war for Sicily.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." });
    world = applyDeltas(world, [open], context() as never).world;
    // The biggest Sicilian province Carthage holds, sacked by Rome's army: its scar, its market and its tithe are what is watched.
    target = world.map.provinces.filter((p) => p.controllerPolityId === "carthage" && p.id.startsWith("sic-"))
      .sort((a, b) => b.settlements.reduce((s, x) => s + x.size, 0) - a.settlements.reduce((s, x) => s + x.size, 0))[0] ?? world.map.provinces.find((p) => p.id.startsWith("sic-"))!;
    const sacked = sackTheProvince(world, { provinceId: target.id, takerPolityId: "rome", takingForceId: null, atStep: world.instant.day, cause: { kind: "action", id: "the-sack", explanation: "Carthage sacks a Sicilian town" }, transactionId: "sanity-sack" });
    world = sacked.world;
    console.log(`\n[month 6] war opened; ${target.id} sacked (${sacked.taken} taken)`);
  }
  // `--profile-from=N`: a cpu profile (sanity.cpuprofile) of the months from N on, when the slow part of a long run is what is wanted.
  const profileFrom = Number((args.find((a) => a.startsWith("--profile-from=")) ?? "--profile-from=-1").split("=")[1]);
  if (month === profileFrom) { profiler = new Session(); profiler.connect(); await profiler.post("Profiler.enable"); await profiler.post("Profiler.start"); }
  const before = world;
  const monthStarted = Date.now();
  const cpuStarted = process.cpuUsage();
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: `sanity-${month}`, gameId: "sanity", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  world = result.world;
  if (args.includes("--timing")) {
    // Wall time swings with whatever else the machine is doing; the process's own cpu time and heap say what the month cost.
    const cpu = process.cpuUsage(cpuStarted);
    console.log(`  month ${month + 1}: ${((Date.now() - monthStarted) / 1000).toFixed(1)}s wall, ${((cpu.user + cpu.system) / 1e6).toFixed(1)}s cpu, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)}M, ${result.newFacts.length} facts, ${world.material.transactions.length} txns`);
  }
  total = combineAudits(total, auditMoney(before, world));
  const known = new Set(before.material.transactions.map((t) => t.id));
  for (const id of chosen) { income.set(id, income.get(id) ?? 0); customs.set(id, customs.get(id) ?? 0); }
  for (const t of world.material.transactions) {
    if (known.has(t.id) || t.destinationAccountId === undefined) continue;
    for (const id of chosen) {
      if (t.destinationAccountId !== treasuryOf(world, id)) continue;
      income.set(id, income.get(id)! + t.amount);
      if (t.cause.id.startsWith("customs_")) customs.set(id, customs.get(id)! + t.amount);
    }
  }
  if ((month + 1) % every === 0) {
    const perYear = 12 / every;
    for (const id of chosen) { income.set(id, income.get(id)! * perYear); customs.set(id, customs.get(id)! * perYear); }
    line(`${formatWorldDate(world.instant, definition.clock)} (month ${month + 1}, ${((Date.now() - started) / 1000).toFixed(0)}s)`, snapshot());
    spreadLine(`year ${(month + 1) / 12}`, world);
    if (target !== null) {
      const row = world.material.provinceMaterial.find((r) => r.provinceId === target!.id)!;
      const hub = marketGeography(world).hubOf.get(target.id)!;
      console.log(`  sacked ${target.name}: development ${row.developmentBps}, scar ${row.scarBps}, war damage ${row.warDamageBps}, people ${row.population}, held by ${world.map.provinces.find((p) => p.id === target!.id)!.controllerPolityId}; its market: grain at ${Math.round(marketPriceBps(world, hub, "grain") / 100)}%, ${GOODS.length} goods`);
    }
    for (const id of chosen) { income.set(id, 0); customs.set(id, 0); }
    if (args.includes("--sizes")) {
      // Where the world is growing: the biggest parts of it by serialised size, to find what a slow month is carrying.
      const parts = Object.entries(world as unknown as Record<string, unknown>).map(([key, value]) => [key, JSON.stringify(value)?.length ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, 14);
      const material = Object.entries(world.material as unknown as Record<string, unknown>).map(([key, value]) => [`material.${key}`, JSON.stringify(value)?.length ?? 0] as const).sort((a, b) => b[1] - a[1]).slice(0, 10);
      console.log(`  sizes: ${[...parts, ...material].map(([key, size]) => `${key} ${(size / 1_000).toFixed(0)}k`).join(", ")}`);
    }
  }
}
if (profiler !== null) {
  const { profile } = await (profiler as Session).post("Profiler.stop");
  writeFileSync("sanity.cpuprofile", JSON.stringify(profile));
  console.log("cpu profile written to sanity.cpuprofile");
}
console.log("\nMONEY AUDIT over the run");
console.log(auditInWords(total));
console.log(`unexplained entries: ${total.unexplained.length}; elapsed ${((Date.now() - started) / 1000).toFixed(0)}s`);
