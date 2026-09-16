import { z } from "zod";
import { OrchestratorOutputSchema, type OrchestratorOutput } from "@chronica/shared";
import type { SimModelPort } from "./ports";
import { renderWorldSlice, type WorldSlice } from "./slice";

/**
 * The orchestrator call (VISION §27).
 *
 * One model call reads the world slice and the player's order and answers with
 * a `WorldTransaction` proposal: what the order means, what the world does
 * about it, who was told to do what, what becomes true, and what is scheduled.
 *
 * It is not asked to roleplay every NPC -- that is the cognition pass, and
 * mixing the two is how you get one omniscient voice pretending to be
 * everybody (VISION §28).
 */

const OUTPUT_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(OrchestratorOutputSchema, { io: "input" }));

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the world of a historical grand-strategy simulation.

You decide what actually happens. You have genuine authority over causality: you
interpret what the ruler meant, decide how their government carries it out, invent
the people and institutions the situation requires, and create plausible
consequences. You are not a narrator decorating a rules engine.

What you do NOT own: arithmetic, dates, identity, and persistence. The engine owns
those. So:

- Never invent an id. To create something, give it a "localId" (lowercase letters,
  digits, underscores). To refer to it later in this same answer, write
  "local:<localId>". To refer to something that already exists, use the id shown in
  the world slice, exactly as written.
- Never state an absolute date. Express time as a whole number of days from now.
- Never compute running totals or balances. State the change; the engine applies it.

How to answer well:

1. Read intent, not syntax. "Raise two legions" is an instruction to a government,
   not a function call. Decide where recruitment happens, who pays for it, who is
   put in charge, and how long it takes.
2. The shorter the order, the more discretion the ruler has delegated. A bare order
   leaves financing and method to officials; a specific one does not.
3. An order that cannot be met in full is not refused. It is attempted, and it
   produces friction: partial fulfilment, delay, cost, or political damage. Put that
   in "frictions" and reflect it in what you actually change.
4. Generate the people the situation needs. If financing this requires a quaestor
   and none exists, create one, with a reason they exist. They will persist and may
   matter later.
5. Anything that takes time becomes a project with milestones and scheduled events,
   not an instant result.
6. Record what becomes true as facts. Set each fact's visibility honestly: a secret
   arrangement is "private", a public mobilization is "public". Use "delayed" or
   "rumoured" discovery with "knowableInDays" for news that has to travel.
7. Score each fact's "significance" from 0 to 100 by how much it would matter to a
   historian of this reign: a routine payment is near 0, a mobilization perhaps 50,
   a battle or a death 90+.
8. Orders given to a person who could refuse them are "delegations", not deltas. That
   person decides separately whether to obey.

Answer with a single JSON object and nothing else, matching this schema (the
"deltas" array inside it is the closed set of changes you may make to the world):

${OUTPUT_JSON_SCHEMA}`;

export interface OrchestrateResult {
  readonly output: OrchestratorOutput;
  readonly calls: number;
  /** Set when the model could not produce a valid proposal even after a repair attempt. */
  readonly parseFailure: string | null;
}

/**
 * A proposal that changes nothing, used when the model's answer cannot be
 * salvaged. The burst continues and the player is told the machinery of state
 * produced nothing this time -- far better than a stack trace, and honest about
 * what happened.
 */
function inertOutput(reason: string): OrchestratorOutput {
  return OrchestratorOutputSchema.parse({
    intent: { summary: "The order could not be interpreted.", domains: [] },
    narrativeSummary: "The order was received, but nothing came of it.",
    frictions: [reason],
    deltas: [],
    facts: [],
    delegations: [],
    schedule: [],
    cognitionCandidates: [],
    outcome: "continue",
    playerDecision: null,
  });
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // A model that wrapped its answer in prose or a code fence still gave a
    // usable object; take the outermost braces rather than failing the burst.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in the response");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export async function orchestrate(port: SimModelPort, slice: WorldSlice): Promise<OrchestrateResult> {
  const userMessage = renderWorldSlice(slice);
  let calls = 0;

  const attempt = async (message: string) => {
    calls += 1;
    const raw = await port.complete("simulate_orchestrate", ORCHESTRATOR_SYSTEM_PROMPT, message);
    return OrchestratorOutputSchema.safeParse(extractJson(raw));
  };

  let failure: string;
  try {
    const first = await attempt(userMessage);
    if (first.success) return { output: first.data, calls, parseFailure: null };
    failure = first.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  // One repair attempt, carrying the exact complaints back. Two is not worth the
  // latency: a model that cannot produce the shape twice will not produce it on
  // the third try either.
  try {
    const repaired = await attempt(`${userMessage}\n\nYour previous answer was rejected. Fix exactly these problems and answer again with the whole object:\n${failure}`);
    if (repaired.success) return { output: repaired.data, calls, parseFailure: null };
    failure = repaired.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  return { output: inertOutput("The order reached the palace, but no workable instruction came back out of it."), calls, parseFailure: failure };
}
