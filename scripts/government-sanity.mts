/**
 * The government's sanity run (docs/plans/government.md, "H6 as built"): the Punic opening advanced a number of game years, month by month, with a model that
 * never acts and nobody played (the cast is empty, the actor a private man), so that every power is governed by its rules alone. For each power, each year:
 *
 *   acts      what its magistrates did, by charge (the log's `grain:`, `dilectus:`, `justice:` ... and the fiscal officers' `fiscal`)
 *   asked     matters laid before a chamber ("asked ..."), and the most that stood open at once
 *   votes     questions settled: carried / failed / forbidden (blocked by a tribune or the like) / lapsed
 *   named     seats that changed hands (elections, appointments, deaths filled)
 *   cases     cases opened and their verdicts (convicted / acquitted), audits opened, accounts rendered and found short, men struck from the roll
 *   empty     charges (magistracies and offices of the departments) with no man seated at the year's end
 *   rates     changes of the tax rate in the year, and the reversals among them (flip-flops: a rise followed by a fall within the year)
 *   coin      the silver in the coin at the year's end against its standard
 *   chest     the treasury at the year's end, and the months it stood below nothing
 *
 * Closes with the world's flags (flip-flopping rates, referrals piling up, vacant charges, runaway debasement) and the money audit over the whole run
 * (unexplained must be 0). No provider is called and no network is touched.
 *
 *   npx tsx scripts/government-sanity.mts [years=5] [--powers=rome,carthage,...] [--quiet]
 */
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, formatWorldDate, allOffices, coinagesOf, economyOf, standardOf, treasuryOf,
  type WorldState,
} from "@chronica/shared";
import { DEFAULT_BUDGET, auditInWords, auditMoney, combineAudits, emptyAudit, runSimulationBurst, type SimModelPort, type MoneyAudit } from "@chronica/sim";

const args = process.argv.slice(2);
const years = Number(args.find((arg) => /^\d+$/.test(arg)) ?? "5");
const quiet = args.includes("--quiet");
const chosen = (args.find((arg) => arg.startsWith("--powers=")) ?? "").split("=")[1]?.split(",").filter(Boolean)
  ?? ["rome", "carthage", "syracuse", "ptolemaic-egypt", "seleucid-empire", "macedon", "mamertines", "samnites", "boii", "etruscan-cities"];
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "The days pass.", deltas: [], facts: [], outcome: "continue" }));
    return Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : "{}");
  },
};

interface Year {
  acts: Map<string, number>;
  asked: number;
  openMost: number;
  carried: number;
  failed: number;
  forbidden: number;
  lapsed: number;
  named: number;
  opened: number;
  convicted: number;
  acquitted: number;
  audits: number;
  accounts: number;
  found: number;
  struck: number;
  rates: number[];
  flips: number;
  belowNothing: number;
}
const blank = (): Year => ({ acts: new Map(), asked: 0, openMost: 0, carried: 0, failed: 0, forbidden: 0, lapsed: 0, named: 0, opened: 0, convicted: 0, acquitted: 0, audits: 0, accounts: 0, found: 0, struck: 0, rates: [], flips: 0, belowNothing: 0 });

const rateOf = (world: WorldState, polityId: string): number | undefined => economyOf(world).taxPolicies.find((policy) => policy.polityId === polityId && (policy as { scope?: string }).scope !== "customs")?.rateBps;
const chestOf = (world: WorldState, polityId: string): number => world.material.accounts.find((account) => account.id === treasuryOf(world, polityId))?.balance ?? 0;
/** A charge that is meant to stand always: not a college elected whole (its places are the implied colleagues'), not the censorship (every fifth year), the dictatorship (a crisis), nor an office made by need (it lapses of itself after three years, `society.ts`). */
const standing = (office: { id: string; kind?: string; seatCount?: number; termDays?: number | null; successionRuleId: string }): boolean =>
  office.kind === "magistracy" && !(office.seatCount !== undefined && office.seatCount > 1 && office.termDays != null) && !/dictator|censor/u.test(office.id) && !office.successionRuleId.includes("by-need");
const polityOfBody = (world: WorldState, bodyId: string | null): string | null => (bodyId === null ? null : world.material.institutions.find((body) => body.id === bodyId)?.polityId ?? null);

let world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
// The actor is a private man of Rome who rules nothing, so that Rome too is governed by its rules (a man the player is leaves his own armies and letters to himself).
const actorId = "manius-curius";
let total: MoneyAudit = emptyAudit();
const perYear = new Map<string, Year[]>(chosen.map((id) => [id, Array.from({ length: years }, blank)]));
const seen = new Set<string>();
const settledSeen = new Set<string>();
const openedSeen = new Set<string>();
const holders = new Map<string, string>();
for (const seat of world.material.officeSeats) if (seat.holderCharacterId !== null) holders.set(seat.id, seat.holderCharacterId);
const lastRate = new Map<string, number>();
const lastDirection = new Map<string, { sign: number; month: number }>();
const started = Date.now();
const ofPower = (id: string): Year[] | undefined => perYear.get(id);
const yearOf = (month: number): number => Math.min(years - 1, Math.floor(month / 12));

for (let month = 0; month < years * 12; month += 1) {
  const before = world;
  const result = await runSimulationBurst({
    world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
    terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
    burstId: `govsan-${month}`, gameId: "govsan", actorRef: { kind: "character", id: actorId }, actorPolityId: "rome",
    orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: { ...DEFAULT_BUDGET, castSize: 0 },
  });
  world = result.world;
  total = combineAudits(total, auditMoney(before, world));
  const y = yearOf(month);

  // What the rules did, read off the log.
  for (const entry of world.statecraft.log) {
    const key = `${entry.day}|${entry.polityId}|${entry.act}|${entry.why}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rows = ofPower(entry.polityId);
    if (rows === undefined) continue;
    const row = rows[y]!;
    const kind = entry.act === "magistrate" ? /^([a-z-]+):/u.exec(entry.why)?.[1] ?? "magistrate" : entry.act === "fiscal" ? "fiscal" : null;
    if (kind === null) continue;
    row.acts.set(kind, (row.acts.get(kind) ?? 0) + 1);
    if (/^asked/u.test(entry.why)) row.asked += 1;
    if (kind === "audit") row.audits += 1;
    if (kind === "accounts") { row.accounts += 1; if (/did not|more than|unexplained/u.test(entry.why)) row.found += 1; }
    if (kind === "lectio") row.struck += Number(/(\d+) struck/u.exec(entry.why)?.[1] ?? 0);
  }
  // Questions: opened, open at once, settled how.
  const openNow = new Map<string, number>();
  for (const procedure of world.material.politicalProcedures) {
    const polityId = polityOfBody(world, procedure.institutionId);
    const rows = polityId === null ? undefined : ofPower(polityId);
    if (rows === undefined) continue;
    const row = rows[y]!;
    if (!openedSeen.has(procedure.id)) {
      openedSeen.add(procedure.id);
      if (procedure.type === "denunciation") row.opened += 1;
    }
    if (["proposed", "gathering_support", "deliberating", "voting_or_deciding"].includes(procedure.stage)) openNow.set(polityId!, (openNow.get(polityId!) ?? 0) + 1);
    if (procedure.outcome !== null && !settledSeen.has(procedure.id)) {
      settledSeen.add(procedure.id);
      if (procedure.type === "denunciation") { if (procedure.outcome === "passed") row.convicted += 1; else if (procedure.outcome === "failed") row.acquitted += 1; }
      if (procedure.outcome === "passed") row.carried += 1;
      else if (procedure.outcome === "failed") row.failed += 1;
      else if (procedure.stage === "blocked" || /forbid|forbad|intercess/iu.test(procedure.outcomeReason ?? "")) row.forbidden += 1;
      else row.lapsed += 1;
    }
  }
  for (const [polityId, count] of openNow) { const row = ofPower(polityId)?.[y]; if (row !== undefined) row.openMost = Math.max(row.openMost, count); }
  // Seats that changed hands.
  const every = allOffices(world, definition.government.offices);
  for (const seat of world.material.officeSeats) {
    const now = seat.holderCharacterId;
    const was = holders.get(seat.id);
    if (now !== null && now !== was) {
      const polityId = every.find((office) => office.id === seat.officeId)?.polityId;
      const row = polityId === undefined ? undefined : ofPower(polityId)?.[y];
      if (row !== undefined) row.named += 1;
    }
    if (now === null) holders.delete(seat.id); else holders.set(seat.id, now);
  }
  // Rates and the chest, month by month.
  for (const id of chosen) {
    const row = ofPower(id)![y]!;
    const rate = rateOf(world, id);
    if (rate !== undefined) {
      const last = lastRate.get(id);
      if (last !== undefined && rate !== last) {
        row.rates.push(rate - last);
        const sign = Math.sign(rate - last);
        const prior = lastDirection.get(id);
        if (prior !== undefined && prior.sign !== sign && month - prior.month <= 12) row.flips += 1;
        lastDirection.set(id, { sign, month });
      }
      lastRate.set(id, rate);
    }
    if (chestOf(world, id) < 0) row.belowNothing += 1;
  }

  if ((month + 1) % 12 === 0 && !quiet) {
    const year = Math.floor(month / 12);
    console.log(`\n== Year ${year + 1}, ${formatWorldDate(world.instant, definition.clock)} (${((Date.now() - started) / 1000).toFixed(0)}s) ==`);
    for (const id of chosen) {
      const row = ofPower(id)![year]!;
      const offices = every.filter((office) => office.polityId === id && office.successionRuleId !== "abolished" && standing(office));
      const empty = offices.filter((office) => !world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.status === "held") && !world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.designateCharacterId != null)).map((office) => office.id);
      const coin = coinagesOf(world).find((candidate) => candidate.issuerPolityId === id);
      const acts = [...row.acts].sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind} ${n}`).join(", ") || "-";
      console.log(`${id.padEnd(16)} acts: ${acts}`);
      console.log(`${"".padEnd(16)} asked ${row.asked} (most open ${row.openMost}); votes ${row.carried} carried / ${row.failed} failed / ${row.forbidden} forbidden / ${row.lapsed} lapsed; named ${row.named}; cases ${row.opened} (${row.convicted} convicted, ${row.acquitted} acquitted); audits ${row.audits}; accounts ${row.accounts} (${row.found} short); struck ${row.struck}`);
      console.log(`${"".padEnd(16)} rates ${row.rates.length === 0 ? "kept" : row.rates.map((d) => (d > 0 ? "+" : "") + d).join(" ")} (${row.flips} reversed); coin ${coin === undefined ? "-" : `${coin.silverBps} of ${standardOf(coin)}`}; chest ${Math.round(chestOf(world, id))} (${row.belowNothing} months below nothing); empty ${empty.length === 0 ? "none" : empty.join(", ")}`);
    }
  }
}

// The flags.
console.log("\nFLAGS");
const flags: string[] = [];
for (const id of chosen) {
  const rows = ofPower(id)!;
  const flips = rows.reduce((sum, row) => sum + row.flips, 0);
  const changes = rows.reduce((sum, row) => sum + row.rates.length, 0);
  if (flips >= 3 || changes > years * 4) flags.push(`${id}: the rate was changed ${changes} times in ${years} years, ${flips} of them reversed (flip-flopping)`);
  const open = Math.max(...rows.map((row) => row.openMost));
  if (open >= 8) flags.push(`${id}: ${open} questions stood open before its chambers at once (referrals piling up)`);
  const coin = coinagesOf(world).find((candidate) => candidate.issuerPolityId === id);
  if (coin !== undefined && coin.silverBps < standardOf(coin) * 0.6) flags.push(`${id}: the coin is down to ${coin.silverBps} of ${standardOf(coin)} (runaway debasement)`);
  const below = rows.reduce((sum, row) => sum + row.belowNothing, 0);
  if (below >= years * 4) flags.push(`${id}: the chest stood below nothing ${below} months of ${years * 12} (budget overruns)`);
  const offices = allOffices(world, definition.government.offices).filter((office) => office.polityId === id && office.successionRuleId !== "abolished" && standing(office));
  const empty = offices.filter((office) => !world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.status === "held") && !world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.designateCharacterId != null));
  if (empty.length > 0) flags.push(`${id}: ${empty.length} magistracies with no man in them at the end (${empty.map((office) => office.id).slice(0, 4).join(", ")})`);
}
console.log(flags.length === 0 ? "none" : flags.join("\n"));
console.log("\nMONEY AUDIT over the run");
console.log(auditInWords(total));
console.log(`unexplained entries: ${total.unexplained.length}; elapsed ${((Date.now() - started) / 1000).toFixed(0)}s`);
