import { z } from "zod";
import { WorldDeltaSchema, abortsTheTurn, isTimeout, type WorldDelta, type WorldState } from "@chronica/shared";
import { extractJson } from "./json";
import type { SimModelPort } from "./ports";
import type { RejectedDelta } from "./apply/context";
import { placeIndex, provincesNamedIn } from "./place-index";

/**
 * A second chance at the deltas the engine could not carry out.
 *
 * `orchestrate` already repairs an answer whose *shape* the schema refused,
 * and carries the exact complaints back to do it. Nothing did the same for a
 * delta that parsed perfectly and then failed on contact with the world:
 * those were dropped where they stood, and the model was never told. A player
 * who ordered a legion raised and paid got the legion, silence about the pay,
 * and no second attempt at either -- and the same misunderstanding came back
 * on the next order, because nothing had corrected it.
 *
 * Only engine rejections are worth repairing. A "world" rejection is the world
 * saying no -- the treasury was short, the province was already held -- and
 * asking the model to try again is asking it to argue with the rules. A
 * "reference" rejection is a mistake in the writing, which is exactly the kind
 * of thing a second look fixes.
 *
 * One attempt, as with the parse repair and for the same reason: a model that
 * cannot name the right account twice will not name it on the third try, and
 * each attempt is a call the player waits for.
 */

export const DELTA_REPAIR_SYSTEM_PROMPT = `You are correcting changes to a historical simulation's world state.

Some of the changes you proposed were refused because of how they were written:
they named something that does not exist, named one thing twice, or left out a
field they needed. The intent behind each was fine. Your job is to write them
again, correctly.

Rules:
- Answer with ONLY a JSON object of the corrected changes, {"deltas": [...]}, in the same
  vocabulary and the same shape as before.
- Fix the problem that was named. Do not restate the change unaltered, and do
  not argue with the refusal.
- Where a change cannot be made correct -- it needed something that genuinely
  does not exist, and nothing in the world would serve -- leave it out. An
  honest empty list is better than a second wrong answer.
- Ids are the world's, never yours. Use an id exactly as the world gave it, or
  a "local:" handle created earlier in this same answer.
- Do not add changes nobody asked for. Only the refused ones.`;

/** Read loosely: each correction is checked on its own below, so one bad one costs only itself. */
const RepairEnvelopeSchema = z.object({ deltas: z.array(z.record(z.string(), z.unknown())).max(24) }).passthrough();

/**
 * A correction read against the change it corrects.
 *
 * Asked to write a refused change again, a model very often writes only the
 * part it fixed -- `{"op": "character_create", "provinceId": "..."}` -- as a
 * patch, and a live run lost four repairs that way, each refused for a dozen
 * missing fields it had never meant to change. The correction is laid over the
 * original of the same kind: the repaired fields win, and everything it left
 * out is what was written the first time.
 */
function overOriginal(correction: Record<string, unknown>, index: number, refused: readonly RejectedDelta[]): unknown {
  const sameKind = refused.filter((rejection) => rejection.delta.op === correction["op"]);
  const localId = correction["localId"];
  const byHandle = typeof localId === "string" ? sameKind.find((rejection) => "localId" in rejection.delta && rejection.delta.localId === localId) : undefined;
  const byPlace = refused[index]?.delta.op === correction["op"] ? refused[index] : undefined;
  const original = (byHandle ?? byPlace ?? sameKind[0])?.delta;
  return original === undefined ? correction : { ...original, ...correction };
}

export interface DeltaRepairResult {
  readonly deltas: readonly WorldDelta[];
  readonly calls: number;
  /** Why the repair itself failed, when it did. Kept so a recurring complaint is visible. */
  readonly failure: string | null;
}

const nothing = (failure: string | null, calls: number): DeltaRepairResult => ({ deltas: [], calls, failure });

/** What the world was told, so a correction can be made against the same facts. */
export interface DeltaRepairInput {
  readonly port: SimModelPort;
  /** The rendered slice the original answer was written against. */
  readonly worldText: string;
  readonly rejected: readonly RejectedDelta[];
  /** The world, so a refusal naming a cut-off id can be answered with what it could have meant. */
  readonly world?: WorldState;
}

/**
 * What a refused id could have meant.
 *
 * Province ids are short and opaque, so a wrong one says nothing about which
 * was meant; the act's own words do. Where a refusal names an id the world
 * does not hold, the repair is shown the provinces the act's fields name --
 * by province or by town -- and, for people and accounts, those whose id
 * begins with what was written. Without this the same wrong id came back in
 * the correction, because nothing in the refusal said what else to write.
 */
function candidatesFor(rejection: RejectedDelta, world: WorldState | undefined): string {
  if (world === undefined) return "";
  const named = [...rejection.reason.matchAll(/"([^"]{5,})"/g)].map((match) => match[1]!).filter((id) => !id.startsWith("local:"));
  if (named.length === 0) return "";
  const index = placeIndex(world);
  const words = Object.values(rejection.delta as Record<string, unknown>).filter((value): value is string => typeof value === "string").join(" ");
  const provinces = [...provincesNamedIn(index, words)].filter((id) => !named.includes(id)).sort().slice(0, 4)
    .map((id) => `${id} (${index.byId.get(id)?.name ?? id})`);
  const people = [
    ...world.map.provinces.map((province) => ({ id: province.id, name: province.name })),
    ...world.characters.map((character) => ({ id: character.id, name: character.name })),
    ...world.material.accounts.map((account) => ({ id: account.id, name: `account of ${account.owner.id}` })),
  ];
  const others = named.filter((id) => id.length >= 8).flatMap((id) => people.filter((place) => place.id !== id && place.id.startsWith(id)).slice(0, 4))
    .map((place) => `${place.id} (${place.name})`);
  const found = [...new Set([...provinces, ...others])];
  return found.length === 0 ? "" : `\n   COULD HAVE MEANT: ${found.join("; ")}`;
}

export async function repairDeltas(input: DeltaRepairInput): Promise<DeltaRepairResult> {
  const repairable = input.rejected.filter((rejection) => rejection.kind === "reference");
  if (repairable.length === 0) return nothing(null, 0);

  const complaints = repairable
    .slice(0, 8)
    .map((rejection, index) => `${index + 1}. ${JSON.stringify(rejection.delta)}\n   REFUSED: ${rejection.reason}${candidatesFor(rejection, input.world)}`)
    .join("\n\n");

  // The world goes in the system message, not the user's. The provider reuses
  // only a system message it has already seen (measured: seven thousand tokens
  // of identical text in the user message were never read back from cache, and
  // the same text in the system message was, all but the last few tokens), and
  // every repair in a burst is written against the same slice. Five repairs
  // paid full price for it each before this.
  const system = `${DELTA_REPAIR_SYSTEM_PROMPT}\n\nThe world as it stood when the changes were written:\n\n${input.worldText}`;
  const message = `These changes were refused:\n\n${complaints}\n\nWrite them again, corrected.`;

  try {
    const raw = await input.port.complete("repair_deltas", system, message);
    const envelope = RepairEnvelopeSchema.safeParse(extractJson(raw));
    if (!envelope.success) {
      return nothing(envelope.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), 1);
    }
    // Each correction on its own: the good ones are kept whatever the rest
    // look like. Only a repair that fixed nothing at all is a failure.
    const deltas: WorldDelta[] = [];
    const problems: string[] = [];
    envelope.data.deltas.forEach((correction, index) => {
      const parsed = WorldDeltaSchema.safeParse(overOriginal(correction, index, repairable));
      if (parsed.success) deltas.push(parsed.data);
      else problems.push(parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    });
    return { deltas, calls: 1, failure: deltas.length === 0 && problems.length > 0 ? problems.join(" | ") : null };
  } catch (error) {
    if (abortsTheTurn(error)) throw error;
    // A repair that times out costs the player another wait and buys nothing.
    // Treated exactly as `orchestrate` treats it: give up, keep the original
    // rejections, and say why.
    const failure = error instanceof Error ? error.message : String(error);
    return nothing(isTimeout(error) ? `The correction did not come back in time: ${failure}` : failure, 1);
  }
}

/**
 * Refusals a corrected answer cannot cure, so no call is spent on them. Grown
 * only from `audit:deltas` evidence: a reason shape that shows up refused
 * first and refused again after every repair is one the repair never fixes.
 * The first entry is a rule of the world dressed as a reference error.
 */
const BEYOND_REPAIR = [
  /is the player's own purse, and the world does not spend it for him/,
  // The repair is shown the player's world, not the ruler's who wrote these, and
  // each refusal names something that world does not hold. An audit that names
  // no department (thirteen refused, from the rulers of Messenia, Rhodes and
  // western Crete); a letter between powers that do not exist; a force or a
  // question that refers to a handle nothing in the answer created. Live, four
  // of five repairs in one turn were these, at seven thousand tokens each.
  /An audit goes through a department's books or a household's; name one\./,
  /A letter must be between two powers that exist\./,
  /which nothing in this batch created\./,
  // A payment of nothing: a correction can only invent a sum nobody ordered.
  /^Nothing to pay: /,
];

export function worthRepairing(rejection: { readonly reason: string }): boolean {
  return !BEYOND_REPAIR.some((pattern) => pattern.test(rejection.reason));
}
