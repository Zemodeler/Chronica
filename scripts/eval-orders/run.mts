// Puts real players' orders to a real model and scores what the engine did.
//
// Scripted tests prove the engine *can* carry out, refuse, ignore and record
// an order; only a live model shows what it *does*. This runs each order as a
// whole turn -- orchestrator, repair, NPC reactions, the Chronicle -- against
// the built-in Punic Wars opening, in memory, with no database, and writes a
// report of what became of each.
//
// By default the model is answered by hand, from files in eval-out/hand-eval
// (see scripts/lib/model-mode.mts): nothing is spent, and the run waits for
// each answer. With --live it spends real model calls, and asks for --yes.
// Usage:
//   npx tsx scripts/eval-orders/run.mts [--only <id,chain,...>] [--failed <report.md>] [--parallel <n>] [--out <dir>]
//   npx tsx scripts/eval-orders/run.mts --live --yes [...]
//
// --failed re-runs only the chains that had an engine failure in an earlier
// report: a chain is re-run whole, because each order in it is given the world
// the one before it left. Chains are independent of each other and run
// --parallel at a time (default 4).
// Provider and keys come from the same environment the web app uses
// (CHRONICA_AI_MODE, the local provider keys).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAiAdapter } from "@chronica/ai";
import type { Fact } from "@chronica/shared";
import { definition, opening } from "./opening";
import { DEFAULT_BUDGET, createWindowWriter, outcomeOfOrder, runSimulationBurst, type AuditEntry, type OrderOutcome, type SimModelPort } from "@chronica/sim";
import { CORPUS, type CorpusOrder } from "./corpus";
import { chooseModel } from "../lib/model-mode.mts";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const only = flag("--only")?.split(",").map((part) => part.trim()).filter(Boolean);
const failedReport = flag("--failed");
const parallel = Math.max(1, Number(flag("--parallel") ?? 4));
const outDir = flag("--out") ?? "eval-out";
/** `--mechanics off` counts the arrangements a rule could be written for and asks the writer nothing (plan §2, step 0). */
const mechanicCalls = flag("--mechanics") === "off" ? 0 : DEFAULT_BUDGET.maxMechanicCalls;

/** The chains an earlier report found an engine failure in. */
function chainsThatFailed(path: string): Set<string> {
  const failing = new Set<string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const row = /^\| ([a-z0-9-]+) \| (.*) \| \d+ \|$/.exec(line);
    if (row === null || !/MALFORMED|UNREADABLE|CRASH|MISSING/.test(row[2]!)) continue;
    const order = CORPUS.find((candidate) => candidate.id === row[1]);
    if (order !== undefined) failing.add(order.chain);
  }
  return failing;
}
const failingChains = failedReport === undefined ? null : chainsThatFailed(failedReport);
const orders = CORPUS.filter((order) =>
  (only === undefined || only.includes(order.id) || only.includes(order.chain))
  && (failingChains === null || failingChains.has(order.chain)));
if (orders.length === 0) {
  console.log("Nothing to run: no order matches.");
  process.exit(0);
}
const mode = chooseModel(args, "eval-out/hand-eval");
if (mode === "live" && !args.includes("--yes")) {
  console.log(`This puts ${orders.length} order(s) to a real model: roughly ${orders.length * 6}-${orders.length * 12} calls. Re-run with --yes to spend them.`);
  process.exit(0);
}

const adapter = createAiAdapter();
let calls = 0;
const port: SimModelPort = {
  async complete(operation, system, user) {
    calls += 1;
    return (await adapter.call(operation, system, user)).content;
  },
};

interface Scored { readonly order: CorpusOrder; readonly outcome: OrderOutcome | null; readonly oracle?: string | null; readonly entries: readonly { title: string; body: string }[]; readonly error: string | null; readonly seconds: number; readonly audit: readonly AuditEntry[]; readonly skipped: readonly { stage: string; reason: string }[] }
const scored = new Map<string, Scored>();

/** One chain, in order: each order is given the world the one before it left. */
async function runChain(chain: readonly CorpusOrder[]): Promise<void> {
  let state = { world: opening(), facts: [] as Fact[] };
  for (const order of chain) {
    const started = performance.now();
    const polity = state.world.characters.find((character) => character.id === order.actor)?.polityId ?? null;
    let row: Scored;
    try {
      // The record as a player gets it: written window by window as the burst
      // walks, in time order, not composed once over the whole span.
      const writer = createWindowWriter({
        port, clock: definition.clock, observer: { kind: "character", id: order.actor }, observerPolityId: polity,
        offices: definition.government.offices, recentSubjects: [], recentTitles: [],
      });
      const result = await runSimulationBurst({
        world: state.world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
        terrains: definition.map.terrains, burstId: `eval-${order.id}`, gameId: `eval-${order.chain}`,
        actorRef: { kind: "character", id: order.actor }, actorPolityId: polity, orderText: order.text,
        knownFacts: state.facts, queue: [], port, onWindowClosed: writer.closed,
        budget: { ...DEFAULT_BUDGET, maxMechanicCalls: mechanicCalls },
      });
      const chronicle = await writer.finish();
      const stateBefore = state;
      state = { world: result.world, facts: [...state.facts, ...result.newFacts] };
      // The world each chain leaves, for `let-time-pass.mts` to run on.
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `world-${order.chain}.json`), JSON.stringify(result.world));
      const before = stateBefore.world;
      row = { order, outcome: outcomeOfOrder(result, chronicle.entries), oracle: order.expect === undefined ? null : order.expect(before, result.world, order.actor), entries: chronicle.entries.map(({ title, body }) => ({ title, body })), error: null, seconds: (performance.now() - started) / 1000, audit: result.audit, skipped: result.skipped };
    } catch (error) {
      row = { order, outcome: null, entries: [], error: error instanceof Error ? error.message : String(error), seconds: (performance.now() - started) / 1000, audit: [], skipped: [] };
    }
    scored.set(order.id, row);
    console.log(`${order.id}: ${row.error ?? verdict(row.outcome!)}${row.oracle == null ? "" : ` -- WORLD: ${row.oracle}`} (${row.seconds.toFixed(0)}s)`);
    // A turn that could not run leaves nothing for the next one to stand on.
    if (row.error !== null) break;
  }
}

const chains = [...new Set(orders.map((order) => order.chain))].map((chain) => orders.filter((order) => order.chain === chain));
let nextChain = 0;
await Promise.all(Array.from({ length: Math.min(parallel, chains.length) }, async () => {
  while (nextChain < chains.length) {
    const chain = chains[nextChain]!;
    nextChain += 1;
    await runChain(chain);
  }
}));
const rows = orders.flatMap((order) => { const row = scored.get(order.id); return row === undefined ? [] : [row]; });

function verdict(outcome: OrderOutcome): string {
  const tags = [
    outcome.carriedOut ? "carried out" : null,
    outcome.refusedByWorld.length > 0 ? `refused by the world ×${outcome.refusedByWorld.length}` : null,
    outcome.ignored.length > 0 ? `ignored ×${outcome.ignored.length}` : null,
    outcome.malformed.length > 0 ? `MALFORMED ×${outcome.malformed.length}` : null,
    outcome.answeredOnly ? "nothing came of it" : null,
    outcome.unreadable.length > 0 ? `UNREADABLE ×${outcome.unreadable.length}` : null,
    outcome.inChronicle ? "in the Chronicle" : "MISSING FROM THE CHRONICLE",
  ].filter((tag): tag is string => tag !== null);
  return tags.join(", ");
}

const failures = rows.filter((row) => row.error !== null || !row.outcome!.inChronicle || row.outcome!.malformed.length > 0 || row.outcome!.unreadable.length > 0);
const report = [
  `# Order evaluation — ${new Date().toISOString()}`,
  "",
  `${rows.length} orders, ${calls} model calls, ${failures.length} with a failure of the engine (crash, malformed, unreadable, or missing from the Chronicle).`,
  "",
  "| Order | Outcome | Seconds |",
  "|---|---|---|",
  ...rows.map((row) => `| ${row.order.id} | ${row.error === null ? verdict(row.outcome!) : `CRASH: ${row.error}`} | ${row.seconds.toFixed(0)} |`),
  "",
  ...rows.flatMap((row) => [
    `## ${row.order.id}`,
    "",
    `> ${row.order.text}`,
    "",
    ...(row.outcome === null ? [] : [
      ...row.outcome.refusedByWorld.map((line) => `- Refused: ${line}`),
      ...row.outcome.ignored.map((line) => `- Ignored: ${line}`),
      ...row.outcome.malformed.map((line) => `- **Malformed:** ${line}`),
      ...row.outcome.unreadable.map((line) => `- **Unreadable:** ${line}`),
      ...row.outcome.salvaged.map((line) => `- Salvaged: ${line}`),
    ]),
    // What the engine did not carry out as written, the order's own acts first.
    ...(row.audit.length === 0 ? [] : [
      "",
      `Audit: ${[...new Set(row.audit.map((entry) => entry.kind))].map((kind) => `${row.audit.filter((entry) => entry.kind === kind).length} ${kind}`).join(", ")}`,
      `Skipped calls: ${row.skipped.length === 0 ? "none" : row.skipped.map((skip) => `${skip.stage} (${skip.reason.slice(0, 120)})`).join("; ")}`,
      "",
      ...[...row.audit].sort((a, b) => Number(b.ofTheOrder) - Number(a.ofTheOrder)).map((entry) =>
        `- ${entry.ofTheOrder ? "order" : `${entry.actorRef.id}`} · ${entry.kind}/${entry.attempt} · ${entry.op}: ${entry.reason.replace(/\s+/g, " ").slice(0, 300)}`),
    ]),
    "",
    ...row.entries.flatMap((entry) => [`### ${entry.title}`, "", entry.body, ""]),
  ]),
].join("\n");

mkdirSync(outDir, { recursive: true });
const path = join(outDir, `orders-${Date.now()}.md`);
writeFileSync(path, report);
console.log(`\n${failures.length === 0 ? "No engine failures." : `${failures.length} engine failure(s).`} Report: ${path}`);
process.exit(failures.length === 0 ? 0 : 1);
