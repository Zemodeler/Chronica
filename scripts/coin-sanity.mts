/**
 * The coin's sanity run (docs/economy.md, "Strain, debasement and arrears"): a forced Rome-Carthage war
 * (opened at month 6), advanced month by month by the rules alone (a model that never acts), and a line per
 * power per year: strain, silver content against the standard, debasements so far, arrears on pay, hired
 * companies that walked out, the premium and the price level. Closes with the money audit (unexplained 0).
 *
 *   npx tsx scripts/coin-sanity.mts [years=7] [--fleet-loss] [--lost-war] [--long-war] [--lean] [--peace]
 *
 * `--fleet-loss` sinks the Carthaginian fleet at month 18 (the First War's last year), `--lost-war` (with `--fleet-loss`) empties Carthage's chest and stops its dues after, `--long-war` empties Rome's at month 24, `--lean` starts Carthage's
 * chest at a tenth of what the scenario gives (a war already long fought), `--peace` opens no war (control).
 */
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WorldStateSchema, WorldDeltaSchema, ensureProvinceMaterial, formatWorldDate, coinageOfPolity, priceLevelBpsOf, standardOf, type WorldState,
} from "@chronica/shared";
import { DEFAULT_BUDGET, applyDeltas, auditMoney, combineAudits, emptyAudit, auditInWords, createIdFactory, runSimulationBurst, type SimModelPort } from "@chronica/sim";
import { readTheBooks, decideFiscal } from "../packages/sim/src/fiscal-officers";
import { strainOf } from "../packages/sim/src/fiscal-strain";

// A broken rule of the world stops the run where it was broken (packages/sim/src/invariants.ts); CHRONICA_STRICT=0 runs on and only reports.
process.env["CHRONICA_STRICT"] ??= "1";

const args = process.argv.slice(2);
const years = Number(args.find((a) => /^\d+$/.test(a)) ?? "7");
const peace = args.includes("--peace");
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The consul waits.", deltas: [], facts: [], outcome: "continue" }));
    return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
  },
};
const idFor = createIdFactory("coin-sanity");
let world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
if (args.includes("--lean")) {
  world = { ...world, material: { ...world.material, accounts: world.material.accounts.map((a) => (a.id === "carthage-treasury" ? { ...a, balance: Math.round(a.balance / 10) } : a)) } };
}
const context = () => ({ now: world.instant, actorRef: { kind: "character" as const, id: "ptolemaic-egypt-ruler-5mbdla" }, actsForTheWorld: true, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.terrains ?? definition.map.terrains, ids: idFor, gameId: "coin-sanity" });
const POWERS = ["rome", "carthage"];

const walkOuts = (w: WorldState, polityId: string): number => w.material.contracts.filter((c) => c.role === "mercenary" && c.status === "lapsed" && w.material.accounts.find((a) => a.id === c.employerAccountId)?.owner.id === polityId).length;
const outlaws = (w: WorldState, polityId: string): number => w.material.forces.filter((f) => f.outlaw === true && f.polityId === polityId).length;
const deserted = (w: WorldState, polityId: string): number => w.material.forces.filter((f) => f.polityId === polityId).reduce((n, f) => n + f.history.filter((h) => h.kind === "desertion").reduce((m, h) => m + h.count, 0), 0);

let total = emptyAudit();
let lastFacts = 0;
const events: string[] = [];
console.log("year  power      strain(cover/arrM/warM/debtM)  silver%  debased  arrears  walkouts outlaw-bands deserters  prem  level%  chest");
let started = false;
for (let month = 0; month < years * 12; month += 1) {
  if (month === 6 && !peace) {
    world = applyDeltas(world, [WorldDeltaSchema.parse({ op: "agreement_open", localId: "sanity-war", kind: "war", polityId: "carthage", otherPolityId: "rome", terms: "The war for Sicily.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." })], context() as never).world;
  }
  if (month === 18 && args.includes("--fleet-loss")) {
    const sunk = new Set(["carthaginian-fleet"]);
    world = { ...world, material: { ...world.material, forces: world.material.forces.filter((f) => !sunk.has(f.id)), accounts: world.material.accounts.filter((a) => !(a.owner.kind === "force" && sunk.has(a.owner.id))) } };
    events.push("month 18: the Carthaginian fleet is lost");
  }
  if (month === 19 && args.includes("--lost-war")) {
    // What the lost war leaves: the chest spent on the indemnity (a tenth of it left), the harbour dues and the African tribute stopped (the blockade, the Libyans' rising).
    world = { ...world, material: {
      ...world.material,
      accounts: world.material.accounts.map((a) => (a.id === "carthage-treasury" ? { ...a, balance: Math.round(a.balance / 40) } : a)),
      incomeSources: world.material.incomeSources.map((s) => (s.id === "carthage-harbour-dues" || s.id === "carthage-african-tribute" ? { ...s, active: false } : s)),
    } };
    events.push("month 19: the indemnity has emptied Carthage's chest, and its harbour dues and African tribute stop");
  }
  if (month === 24 && args.includes("--long-war")) {
    world = { ...world, material: { ...world.material,
      accounts: world.material.accounts.map((a) => (a.id === "rome-treasury" ? { ...a, balance: Math.round(a.balance / 40) } : a)),
      incomeSources: world.material.incomeSources.map((s) => (s.beneficiaryAccountId === "rome-treasury" ? { ...s, amount: Math.round(s.amount * 0.15) } : s)),
    } };
    events.push("month 24: years of war have emptied Rome's chest and what comes in is a seventh of what did");
  }
  if (args.includes("--trace") && month >= 34) {
    const t = decideFiscal({ world, gameId: "coin-sanity", excludedPolityIds: new Set(["ptolemaic-egypt"]), playedByModel: new Set<string>(), playerCharacterId: null, offices: definition.government.offices }).filter((d) => d.polityId === "carthage");
    const st = strainOf(world, readTheBooks(world).get("carthage")!, "carthage");
    console.log(`  trace month ${month + 1} day ${world.instant.day}: strain ${st.score} atWar ${st.atWar} revolt ${st.revolt} arrM ${st.arrearsMonths.toFixed(1)} decisions: ${t.map((d) => d.why.slice(0, 90) + " [" + d.deltas.map((x) => x.op).join(",") + "]").join(" | ") || "none"}; last coin log: ${world.statecraft.log.filter((e) => e.polityId === "carthage" && /coinage/.test(e.why)).map((e) => e.day).join(",")}`);
  }
  const before = world;
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: `coin-sanity-${month}`, gameId: "coin-sanity", actorRef: { kind: "character", id: "ptolemaic-egypt-ruler-5mbdla" }, actorPolityId: "ptolemaic-egypt",
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
  });
  world = result.world;
  started = true;
  total = combineAudits(total, auditMoney(before, world));
  for (const fact of result.newFacts) if (/^(coinage_|contract_lapsed|force_desertion|obligation_unpaid)/.test(fact.kind) && lastFacts >= 0) events.push(`month ${month + 1}: [${fact.kind}] ${fact.summary.slice(0, 150)}`);
  if ((month + 1) % 12 === 0) {
    const books = readTheBooks(world);
    for (const id of POWERS) {
      const book = books.get(id)!;
      const s = strainOf(world, book, id);
      const coin = coinageOfPolity(world, id);
      console.log(`${formatWorldDate(world.instant, definition.clock).slice(-8).padEnd(8)} ${id.padEnd(9)} ${String(s.score).padStart(4)} (${s.cover.toFixed(1)}/${s.arrearsMonths.toFixed(1)}/${s.warMonths.toFixed(0)}/${s.debtMonths.toFixed(1)})`.padEnd(66)
        + ` ${String(Math.round((100 * coin.silverBps) / standardOf(coin))).padStart(5)}  ${String(coin.history.length).padStart(7)}  ${String(Math.round(book.arrears)).padStart(7)}  ${String(walkOuts(world, id)).padStart(8)} ${String(outlaws(world, id)).padStart(12)} ${String(deserted(world, id)).padStart(9)} ${String(coin.premiumBps).padStart(5)} ${String(Math.round(priceLevelBpsOf(world, id) / 100)).padStart(6)} ${String(Math.round(book.balance)).padStart(10)}`);
    }
  }
}
void started;
for (const line of events.slice(0, 40)) console.log(`  ${line}`);
for (const procedure of world.material.politicalProcedures.filter((q) => /less silver|more silver/.test(q.label))) console.log(`  motion: ${procedure.label.slice(0, 110)} => ${procedure.outcome ?? procedure.stage} (day ${procedure.resolvedAtStep ?? "open"})`);
for (const power of POWERS) { const coin = coinageOfPolity(world, power); for (const h of coin.history) console.log(`  ${power}: coin struck ${h.fromSilverBps} -> ${h.toSilverBps} on day ${h.atStep}`); }
console.log(`unexplained money entries: ${total.unexplained.length}`);
if (total.unexplained.length > 0) process.exitCode = 1;
if (args.includes("--audit")) console.log(auditInWords(total));
