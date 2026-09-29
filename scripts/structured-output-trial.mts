// Section 3 of docs/plans/what-the-engine-cannot-do-yet.md, in one day: can the
// providers hold the model to the delta union as a response schema handed to
// them outside the prompt? If they can, the orchestrator's prompt loses the
// fifty thousand characters of schema it carries and most repair calls with
// it. If the union is past their complexity limits, the answer is no and the
// code paths go.
//
// Usage: npx tsx --env-file=.env.local scripts/structured-output-trial.mts --yes [--provider openai|anthropic|both] [--calls 3]
//
// Real calls, at the orchestrator's own size, on the eval corpus's opening.
// The report goes to eval-out/structured-output-trial.md.
import Anthropic from "@anthropic-ai/sdk";
import { OrchestratorOutputSchema, measureSchema, restoreDefaults, toProviderSchema } from "@chronica/shared";
import { ORCHESTRATOR_SYSTEM_PROMPT, buildWorldSlice, renderWorldSlice } from "@chronica/sim";
import { mkdirSync, writeFileSync } from "node:fs";
// The OpenAI client is a dependency of packages/ai and not hoisted; this is a
// one-day trial script, not a package, so it reaches in.
import OpenAI from "../packages/ai/node_modules/openai/index.mjs";
import { CORPUS } from "./eval-orders/corpus";
import { definition, opening } from "./eval-orders/opening";

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const provider = flag("--provider") ?? "both";
const calls = Math.max(1, Number(flag("--calls") ?? 3));
if (!args.includes("--yes")) {
  console.log(`This makes up to ${calls} real orchestrator-sized call(s) per provider. Re-run with --yes to spend them.`);
  process.exit(0);
}

const schema = toProviderSchema(OrchestratorOutputSchema);
const size = measureSchema(schema);
const lines: string[] = [];
const say = (line: string) => { console.log(line); lines.push(line); };
say(`# Structured output trial — ${new Date().toISOString()}`);
say("");
say(`Schema: ${size.chars} chars, ${size.objects} objects, ${size.properties} properties, ${size.enumValues} enum values, depth ${size.depth}. The prompt's own copy is ${JSON.stringify(schema).length > 0 ? ORCHESTRATOR_SYSTEM_PROMPT.length : 0} chars with the schema in it.`);

// The system prompt without the schema: everything up to the closing
// instruction, then a line saying the shape is the response format.
const cut = ORCHESTRATOR_SYSTEM_PROMPT.indexOf("Answer with a single JSON object");
const system = `${ORCHESTRATOR_SYSTEM_PROMPT.slice(0, cut)}Answer with a single JSON object and nothing else, in the response format you have been given (its "deltas" array is the closed set of changes you may make to the world).`;
say(`System prompt without the schema: ${system.length} chars.`);
say("");

// A different chain's first order each time, on the corpus opening.
const firsts = [...new Map(CORPUS.map((order) => [order.chain, order])).values()].slice(0, calls);
const world = opening();
const messages = firsts.map((order) => {
  const polity = world.characters.find((character) => character.id === order.actor)?.polityId ?? null;
  const slice = buildWorldSlice({
    world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
    actorRef: { kind: "character", id: order.actor }, actorPolityId: polity, orderText: order.text, facts: [], dueEvents: [], pendingEvents: [],
  });
  return { order, user: renderWorldSlice(slice) };
});

interface Outcome { readonly provider: string; readonly order: string; readonly accepted: boolean; readonly seconds: number; readonly error: string | null; readonly parsed: boolean; readonly deltas: number; readonly facts: number; readonly outputTokens: number | null }
const outcomes: Outcome[] = [];

function judge(providerName: string, order: string, seconds: number, raw: string, outputTokens: number | null): Outcome {
  mkdirSync("eval-out", { recursive: true });
  writeFileSync(`eval-out/trial-${providerName.replace(/[^a-z0-9]/gi, "_")}-${order}.json`, raw);
  let json: unknown;
  // Structured output promises JSON and nothing else; a parse failure is a finding, not something to salvage.
  try { json = JSON.parse(raw); } catch (error) {
    return { provider: providerName, order, accepted: true, seconds, error: `unparseable: ${error instanceof Error ? error.message : String(error)}`, parsed: false, deltas: 0, facts: 0, outputTokens };
  }
  const restored = restoreDefaults(OrchestratorOutputSchema, json);
  const parsed = OrchestratorOutputSchema.safeParse(restored);
  if (!parsed.success) {
    return { provider: providerName, order, accepted: true, seconds, error: `schema: ${parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, parsed: false, deltas: 0, facts: 0, outputTokens };
  }
  return { provider: providerName, order, accepted: true, seconds, error: null, parsed: true, deltas: parsed.data.deltas.length + (parsed.data.worldDeltas?.length ?? 0), facts: parsed.data.facts.length, outputTokens };
}

async function anthropic(): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = "claude-haiku-4-5";
  for (const { order, user } of messages) {
    const started = performance.now();
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 8_192,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema } },
      });
      const seconds = (performance.now() - started) / 1000;
      const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      outcomes.push(judge(`anthropic:${model}`, order.id, seconds, text, response.usage.output_tokens));
    } catch (error) {
      const seconds = (performance.now() - started) / 1000;
      outcomes.push({ provider: `anthropic:${model}`, order: order.id, accepted: false, seconds, error: error instanceof Error ? error.message.slice(0, 400) : String(error), parsed: false, deltas: 0, facts: 0, outputTokens: null });
    }
    console.log(`anthropic ${order.id}: ${outcomes[outcomes.length - 1]!.error ?? "ok"} (${outcomes[outcomes.length - 1]!.seconds.toFixed(1)}s)`);
  }
}

async function openai(): Promise<void> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = (process.env.CHRONICA_LOCAL_OPENAI_MODELS ?? "gpt-6-luna").split(",")[0]!.trim();
  for (const { order, user } of messages) {
    const started = performance.now();
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: "orchestrator_output", schema, strict: true } },
        reasoning_effort: "low",
        max_completion_tokens: 8_000,
      });
      const seconds = (performance.now() - started) / 1000;
      const text = response.choices[0]?.message.content ?? "";
      outcomes.push(judge(`openai:${model}`, order.id, seconds, text, response.usage?.completion_tokens ?? null));
    } catch (error) {
      const seconds = (performance.now() - started) / 1000;
      outcomes.push({ provider: `openai:${model}`, order: order.id, accepted: false, seconds, error: error instanceof Error ? error.message.slice(0, 400) : String(error), parsed: false, deltas: 0, facts: 0, outputTokens: null });
    }
    console.log(`openai ${order.id}: ${outcomes[outcomes.length - 1]!.error ?? "ok"} (${outcomes[outcomes.length - 1]!.seconds.toFixed(1)}s)`);
  }
}

if (provider === "openai" || provider === "both") await openai();
if (provider === "anthropic" || provider === "both") await anthropic();

say("| provider | order | accepted | parsed clean | seconds | output tokens | deltas | facts | error |");
say("|---|---|---|---|---:|---:|---:|---:|---|");
for (const outcome of outcomes) {
  say(`| ${outcome.provider} | ${outcome.order} | ${outcome.accepted ? "yes" : "NO"} | ${outcome.parsed ? "yes" : "no"} | ${outcome.seconds.toFixed(1)} | ${outcome.outputTokens ?? "—"} | ${outcome.deltas} | ${outcome.facts} | ${outcome.error ?? ""} |`);
}
mkdirSync("eval-out", { recursive: true });
writeFileSync("eval-out/structured-output-trial.md", `${lines.join("\n")}\n`);
console.log("\nreport: eval-out/structured-output-trial.md");
