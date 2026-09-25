import { z } from "zod";
import { WorldDeltaSchema, abortsTheTurn, isTimeout, type WorldDelta, type WorldState } from "@chronica/shared";
import { extractJson } from "./json";
import type { SimModelPort } from "./ports";
import type { RejectedDelta } from "./apply/context";

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
 * The map's ids are long, and a model copies the start of one; where that
 * start fits two provinces the engine rightly will not guess -- but it can
 * show both, and the repair can choose. Without this the same half-id came
 * back in the correction, because nothing in the refusal said what else to
 * write.
 */
function candidatesFor(reason: string, world: WorldState | undefined): string {
  if (world === undefined) return "";
  const named = [...reason.matchAll(/"([^"]{8,})"/g)].map((match) => match[1]!).filter((id) => !id.startsWith("local:"));
  const places: { id: string; name: string }[] = [
    ...world.map.provinces.map((province) => ({ id: province.id, name: province.name })),
    ...world.characters.map((character) => ({ id: character.id, name: character.name })),
    ...world.material.accounts.map((account) => ({ id: account.id, name: `account of ${account.owner.id}` })),
  ];
  const found = named.flatMap((id) => places.filter((place) => place.id !== id && place.id.startsWith(id)).slice(0, 4));
  return found.length === 0 ? "" : `\n   COULD HAVE MEANT: ${found.map((place) => `${place.id} (${place.name})`).join("; ")}`;
}

export async function repairDeltas(input: DeltaRepairInput): Promise<DeltaRepairResult> {
  const repairable = input.rejected.filter((rejection) => rejection.kind === "reference");
  if (repairable.length === 0) return nothing(null, 0);

  const complaints = repairable
    .slice(0, 8)
    .map((rejection, index) => `${index + 1}. ${JSON.stringify(rejection.delta)}\n   REFUSED: ${rejection.reason}${candidatesFor(rejection.reason, input.world)}`)
    .join("\n\n");

  const message = `${input.worldText}\n\nThese changes were refused:\n\n${complaints}\n\nWrite them again, corrected.`;

  try {
    const raw = await input.port.complete("simulate_orchestrate", DELTA_REPAIR_SYSTEM_PROMPT, message);
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
