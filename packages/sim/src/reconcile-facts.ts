import { abortsTheTurn, ReconcileOutputSchema } from "@chronica/shared";
import { extractJson } from "./json";
import type { SimModelPort } from "./ports";
import type { RejectedDelta } from "./apply/context";

/**
 * Taking back what an answer said happened, where it did not.
 *
 * A model writes its facts beside its changes, in one breath, before the engine
 * has said which changes it will carry out. So a refused act could leave its
 * own announcement standing: "a sum left the consul's chest for the shipyards"
 * beside the refusal that kept the chest shut, "thousands flocked to his
 * banner" beside an army nobody joined. No rule over names can catch this --
 * the first fact names Rome, not the chest -- because whether a sentence
 * describes a refused act is a question about meaning.
 *
 * So it is asked of whoever wrote the sentences, once, and only when something
 * was refused. The answer is bounded: a fact can be withdrawn or rewritten,
 * never added, so a correction cannot smuggle in history the engine never saw.
 */

export const FACT_RECONCILE_SYSTEM_PROMPT = `You are correcting the record of a historical simulation.

You proposed some facts together with some changes to the world. Some of the
changes were refused, for the reasons given. A fact that describes something
refused did not happen.

For each fact, decide:
- it stands as written, because it does not depend on anything refused;
- it is withdrawn, because it says a refused thing happened;
- it is rewritten, because part of it still happened -- write only what did.

Be strict. If a refused change is the act a fact describes -- a raid, a march,
a payment, an army raised, a city taken -- the fact did not happen, however it
is phrased, and it is withdrawn. A fact that describes the consequences of a
refused act (loot sent home from a raid that never began) did not happen
either. When in doubt, withdraw: a record missing a sentence is better than a
record that contradicts itself.

Never add a fact. Never describe the refusal itself; the record already has it.
Answer with ONLY a JSON object: {"withdraw": [localIds], "rewrite": [{"localId": ..., "summary": ...}]}.`;

export interface FactReconcileResult<F> {
  readonly facts: readonly F[];
  readonly calls: number;
  readonly failure: string | null;
  /**
   * The facts whose fate nobody settled: the answer could not be read, the
   * call failed, or it judged them without seeing every refusal. They come
   * back as written, for callers that cannot tell them apart, but must never
   * stand as the event: the caller keeps them as somebody's report
   * (`asClaim`) or drops them.
   */
  readonly unresolved: readonly string[];
}

/** How many refusals are shown in full; the next ones are listed a line each, so a fact naming one of them is still judged against it. */
const REFUSALS_IN_FULL = 20;
const REFUSALS_LISTED = 60;

export async function reconcileFacts<F extends { readonly localId: string; readonly summary: string }>(input: {
  readonly port: SimModelPort;
  readonly facts: readonly F[];
  readonly refused: readonly RejectedDelta[];
}): Promise<FactReconcileResult<F>> {
  if (input.facts.length === 0 || input.refused.length === 0) return { facts: input.facts, calls: 0, failure: null, unresolved: [] };
  const everyFact = input.facts.map((fact) => fact.localId);

  // Twenty in full, not twelve: a round's people are reconciled in one call. The next forty
  // are still listed, briefly: past twenty, a fact naming a refusal was judged without it.
  const full = input.refused.slice(0, REFUSALS_IN_FULL)
    .map((rejection, index) => `${index + 1}. ${JSON.stringify(rejection.delta)}\n   REFUSED: ${rejection.reason}`);
  const brief = input.refused.slice(REFUSALS_IN_FULL, REFUSALS_LISTED)
    .map((rejection, index) => `${REFUSALS_IN_FULL + index + 1}. ${rejection.delta.op}: REFUSED: ${rejection.reason.slice(0, 160)}`);
  const beyond = Math.max(0, input.refused.length - REFUSALS_LISTED);
  const refusals = [...full, ...brief, ...(beyond > 0 ? [`(and ${beyond} more refused changes)`] : [])].join("\n");
  const facts = input.facts.map((fact) => `- ${fact.localId}: ${fact.summary}`).join("\n");
  const message = `Refused changes:\n${refusals}\n\nYour facts:\n${facts}`;

  try {
    const parsed = ReconcileOutputSchema.safeParse(extractJson(await input.port.complete("reconcile_facts", FACT_RECONCILE_SYSTEM_PROMPT, message)));
    if (!parsed.success) return { facts: input.facts, calls: 1, failure: parsed.error.issues[0]?.message ?? "unreadable", unresolved: everyFact };
    const withdrawn = new Set(parsed.data.withdraw);
    const rewritten = new Map(parsed.data.rewrite.map((entry) => [entry.localId, entry.summary]));
    return {
      facts: input.facts
        .filter((fact) => !withdrawn.has(fact.localId))
        .map((fact) => {
          const summary = rewritten.get(fact.localId);
          return summary === undefined ? fact : { ...fact, summary };
        }),
      calls: 1,
      failure: null,
      // Refusals it was never shown leave what it kept unsettled.
      unresolved: beyond > 0 ? input.facts.filter((fact) => !withdrawn.has(fact.localId) && !rewritten.has(fact.localId)).map((fact) => fact.localId) : [],
    };
  } catch (error) {
    if (abortsTheTurn(error)) throw error;
    // Never worth failing a turn over. The facts come back as written and
    // marked unresolved: the caller keeps them as reports, never as the event.
    return { facts: input.facts, calls: 1, failure: error instanceof Error ? error.message : String(error), unresolved: everyFact };
  }
}

/**
 * The facts that describe a refused act, and so are worth asking about.
 *
 * Reconciliation used to run on any refusal beside any fact: a letter refused
 * as already answered sent every fact of the round to be reconsidered, at a
 * call apiece. A fact is about a refusal when it names something the refused
 * delta names -- a handle, an id, a local handle it minted -- or repeats a
 * name the delta carries. Anything else stands without asking.
 */
export function factsNamingRefusals<F extends { readonly affectedRefs: readonly { readonly id: string }[]; readonly summary: string; readonly storylineRef?: string | null }>(
  facts: readonly F[],
  refused: readonly { readonly delta: unknown }[],
  /** Ids that count as named beside the deltas' own: the owners of accounts they name, and for the order's own refusals the actor and their power. */
  also: Iterable<string> = [],
): F[] {
  const handles = new Set<string>(also);
  const names: string[] = [];
  const strip = (id: string): string => id.replace(/^local:/, "");
  const walk = (value: unknown, key: string): void => {
    if (typeof value === "string") {
      if (/(Ref|Refs|Id|Ids)$/.test(key) || key === "localId") handles.add(strip(value));
      if ((key === "label" || key === "name" || key === "title") && value.trim().length >= 4) names.push(value.trim().toLowerCase());
      return;
    }
    if (Array.isArray(value)) { for (const item of value) walk(item, key); return; }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.kind === "string" && typeof record.id === "string") handles.add(strip(record.id));
      for (const [childKey, child] of Object.entries(record)) walk(child, childKey);
    }
  };
  for (const rejection of refused) walk(rejection.delta, "");
  return facts.filter((fact) =>
    fact.affectedRefs.some((ref) => handles.has(strip(ref.id)))
    || (fact.storylineRef !== null && fact.storylineRef !== undefined && handles.has(strip(fact.storylineRef)))
    || names.some((name) => fact.summary.toLowerCase().includes(name)));
}
