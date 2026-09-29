import { z } from "zod";
import { MechanicDraftSchema, abortsTheTurn, isTimeout, type GenericEntity, type MechanicDraft, type WorldDelta, type WorldState } from "@chronica/shared";
import { extractJson } from "../json";
import type { SimModelPort } from "../ports";
import { renderReadableRefs, type ReadableRefs } from "./refs";

/**
 * The one model call a mechanic costs: asked once, when an arrangement is set
 * going, to write the rule behind it. Its own small prompt and schema; the
 * orchestrator's prompt does not grow by a character.
 */

export const WriteMechanicOutputSchema = z.object({ mechanic: MechanicDraftSchema.nullable() }).strict();
const OUTPUT_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(WriteMechanicOutputSchema, { io: "input" }));

export const WRITE_MECHANIC_SYSTEM_PROMPT = `You write one standing rule for a thing somebody has just set going in a historical simulation. The engine will run the rule by itself, every month for years, with no model involved, so it must be exact and small.

The thing already exists, and what it earns for its owner from the world at large -- a stall's takings, a school's fees, an estate's yield -- is already settled by its standing effects and is not yours to write. Write what else it does, to whom, and when: a named purse or treasury that pays or is paid, what it does to the province or to somebody's standing, and what stops it. A rule need not move money at all.

A rule has:
- a trigger: "monthly"; "on_fact" (a kind of fact, touching a named party or anybody); or "when" (the first time a condition becomes true, and each time it becomes true again);
- up to three conditions that must all hold when it fires;
- one to four effects, from exactly these: money_transfer (from an account to an account, or to null for money leaving the world), province_material_shift (stability, food_security, productive_capacity, war_damage, available_manpower or population, raised or lowered a slight, marked or great step), force_shift (an army the owner commands: morale or cohesion up or down, or men lowered), legitimacy_shift, polity_stance_shift (one power's trust of another), relation_shift (one person's trust, affection, fear, respect, obligation or reputation for another);
- an end: "never", a "term" in days (at least 30), "when" a condition becomes true, or "owner_death".

Every sum is written as a band (slight, marked, great) of the thing's own scale, or as a share in basis points of a readable value (an account's balance, a province's tax capacity), or as a fixed amount; the engine sets what a band is worth and caps everything. A rule may take money from somebody else's purse or a treasury only with their consent or its owner's authority; the engine checks, and drops what it may not do. Name a one-off setup cost and a monthly upkeep in money; the engine will clamp them.

Use only the ids listed under READABLE VALUES. A rule must have a reason to fire and a reason to stop: one that fires every month whatever happens should say why in "why", and one that never ends should be one that genuinely has none. If this thing is not a rule at all -- a season spent reading, a journey, a mood -- answer {"mechanic": null}.

Answer with a single JSON object and nothing else, matching this schema:

${OUTPUT_JSON_SCHEMA}`;

export interface WriteMechanicInput {
  readonly port: SimModelPort;
  readonly world: WorldState;
  readonly entity: GenericEntity;
  /** The act that set it going, as written, and the order or answer it came from. */
  readonly act: WorldDelta | null;
  readonly actText: string;
  /** The owner as the model was shown them: the burst's slice for the order's actor, a portrait for anybody else. */
  readonly ownerText: string;
  readonly refs: ReadableRefs;
}

export interface WriteMechanicResult {
  readonly draft: MechanicDraft | null;
  readonly calls: number;
  /** Why no draft came back, when it was a fault and not a decision. */
  readonly failure: string | null;
}

export async function writeMechanic(input: WriteMechanicInput): Promise<WriteMechanicResult> {
  const { entity, world } = input;
  const standing = entity.effects ?? [];
  const effects = standing.length === 0 ? "none" : standing.map((effect) => `${effect.quantity} ${effect.direction} (${effect.band}, ${effect.scope})`).join(", ");
  const message = [
    "THE ACT",
    `${entity.label} [${entity.id}], an arrangement of kind "${entity.kind}"${entity.provinceId === null || entity.provinceId === undefined ? "" : ` in ${world.map.provinces.find((province) => province.id === entity.provinceId)?.name ?? entity.provinceId}`}, owned by ${entity.ownerRef === null ? "nobody" : entity.ownerRef.id}.`,
    `Standing effects already in force: ${effects}.`,
    input.act === null ? "" : `As written: ${JSON.stringify(input.act).slice(0, 800)}`,
    `What was said: ${input.actText.slice(0, 600)}`,
    "",
    "WHO SET IT GOING",
    input.ownerText,
    "",
    renderReadableRefs(input.refs),
    "",
    "Write the rule.",
  ].filter((line) => line !== "").join("\n");

  let calls = 0;
  const attempt = async (user: string) => {
    calls += 1;
    const raw = await input.port.complete("write_mechanic", WRITE_MECHANIC_SYSTEM_PROMPT, user);
    return WriteMechanicOutputSchema.safeParse(extractJson(raw));
  };
  try {
    const first = await attempt(message);
    if (first.success) return { draft: first.data.mechanic, calls, failure: null };
    const complaints = first.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    const second = await attempt(`${message}\n\nYour previous answer was refused: ${complaints}. Write it again, corrected.`);
    if (second.success) return { draft: second.data.mechanic, calls, failure: null };
    return { draft: null, calls, failure: second.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  } catch (error) {
    if (abortsTheTurn(error)) throw error;
    const failure = error instanceof Error ? error.message : String(error);
    return { draft: null, calls, failure: isTimeout(error) ? `the rule did not come back in time: ${failure}` : failure };
  }
}
