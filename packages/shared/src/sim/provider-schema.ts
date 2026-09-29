import { z } from "zod";

/**
 * The delta union as a provider's response schema, rather than as text in the
 * prompt.
 *
 * Both providers can hold the model to a schema handed to them outside the
 * prompt (Anthropic `output_config.format`, OpenAI strict `json_schema`), which
 * would take fifty thousand characters out of the orchestrator's system prompt
 * and most of the repair calls out of the turn. Their dialect is narrower than
 * Zod's: every object must forbid unknown keys and require every key, so an
 * optional field is written as "this or null"; no defaults, no bounds, no
 * `oneOf`, no open records. This module produces that dialect from the Zod
 * schema, and `restoreDefaults` turns an answer written in it back into what
 * Zod expects -- the nulls that stand for "absent" removed, the records that
 * had to travel as key/value lists rebuilt -- so the engine's own validation
 * and defaults still apply unchanged.
 *
 * Whether the providers accept a union of fifty-four operations at all is the
 * question `scripts/structured-output-trial.mts` exists to answer.
 */

type Json = Record<string, unknown>;

const BOUNDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "format"] as const;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const allowsNull = (schema: unknown): boolean => {
  if (!isObject(schema)) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  const branches = schema.anyOf ?? schema.oneOf;
  return Array.isArray(branches) && branches.some(allowsNull);
};

/** A record `{ [key: string]: T }`, which strict mode cannot express, as a list of pairs it can. */
const pairsOf = (valueSchema: unknown): Json => ({
  type: "array",
  items: {
    type: "object",
    properties: { key: { type: "string" }, value: valueSchema },
    required: ["key", "value"],
    additionalProperties: false,
  },
});

function tighten(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tighten);
  if (!isObject(node)) return node;
  const out: Json = {};
  // A bound the dialect cannot hold is said in words instead: the model is
  // told "at least 1" where the grammar can no longer refuse a zero, and Zod
  // still refuses it on the way in.
  const said: string[] = [];
  const bound = (label: string, value: unknown): void => { if (typeof value === "number" || typeof value === "string") said.push(`${label} ${value}`); };
  bound("at least", node.minimum);
  bound("more than", node.exclusiveMinimum);
  bound("at most", node.maximum);
  bound("less than", node.exclusiveMaximum);
  if (typeof node.minLength === "number" && node.minLength > 0) said.push(`at least ${node.minLength} character${node.minLength === 1 ? "" : "s"}`);
  if (typeof node.maxLength === "number") said.push(`at most ${node.maxLength} characters`);
  if (typeof node.minItems === "number" && node.minItems > 0) said.push(`at least ${node.minItems} item${node.minItems === 1 ? "" : "s"}`);
  if (typeof node.maxItems === "number") said.push(`at most ${node.maxItems} items`);
  if (said.length > 0) out.description = [typeof node.description === "string" ? node.description : "", said.join(", ")].filter((part) => part.length > 0).join(" — ");
  for (const [key, value] of Object.entries(node)) {
    if (key === "default" || (key === "description" && said.length > 0)) continue;
    if ((BOUNDS as readonly string[]).includes(key)) continue;
    if (key === "oneOf") { out.anyOf = tighten(value); continue; }
    out[key] = key === "properties" || key === "$defs" || key === "definitions"
      ? Object.fromEntries(Object.entries(value as Json).map(([name, child]) => [name, tighten(child)]))
      : tighten(value);
  }
  if (out.type === "object") {
    const properties = isObject(out.properties) ? out.properties : undefined;
    if (properties === undefined && isObject(out.additionalProperties)) {
      // An open record: nothing but a value schema. Strict mode has no such
      // thing, so it travels as a list of pairs (see `restoreDefaults`).
      return pairsOf(out.additionalProperties);
    }
    const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
    if (properties !== undefined) {
      for (const [name, child] of Object.entries(properties)) {
        if (!required.has(name) && !allowsNull(child)) properties[name] = { anyOf: [child, { type: "null" }] };
      }
      out.required = Object.keys(properties);
    }
    out.additionalProperties = false;
  }
  return out;
}

/**
 * The JSON schema a provider can hold the model to. `$defs` are kept: both
 * dialects allow references, and a union of fifty ops without them is several
 * times the size.
 */
export function toProviderSchema(schema: z.ZodType): Json {
  const generated = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12", reused: "ref", unrepresentable: "any" }) as Json;
  const tightened = tighten(generated) as Json;
  delete tightened.$schema;
  return tightened;
}

/** Roughly how much of the schema there is: what the providers' complexity limits are counted against. */
export function measureSchema(schema: Json): { readonly chars: number; readonly objects: number; readonly properties: number; readonly depth: number; readonly enumValues: number } {
  let objects = 0;
  let properties = 0;
  let enumValues = 0;
  let depth = 0;
  const walk = (node: unknown, at: number): void => {
    depth = Math.max(depth, at);
    if (Array.isArray(node)) { for (const child of node) walk(child, at + 1); return; }
    if (!isObject(node)) return;
    if (node.type === "object") {
      objects += 1;
      if (isObject(node.properties)) properties += Object.keys(node.properties).length;
    }
    if (Array.isArray(node.enum)) enumValues += node.enum.length;
    for (const [key, child] of Object.entries(node)) if (key !== "enum") walk(child, at + 1);
  };
  walk(schema, 0);
  return { chars: JSON.stringify(schema).length, objects, properties, enumValues, depth };
}

/**
 * An answer written in the provider dialect, as Zod expects it.
 *
 * Nulls that stand for "absent" are removed and key/value lists become
 * records again -- decided by what Zod complains about, not by a second map
 * of the schema: a null where a value was expected and the field does not
 * accept null is an absent field; an array where a record was expected is a
 * list of pairs. Bounded, so an answer that will not settle is handed back as
 * it is for the ordinary path to refuse.
 */
export function restoreDefaults<T extends z.ZodType>(schema: T, value: unknown, rounds = 40): unknown {
  const current: unknown = structuredClone(value);
  for (let round = 0; round < rounds; round += 1) {
    const parsed = schema.safeParse(current);
    if (parsed.success) return current;
    let changed = false;
    for (const issue of parsed.error.issues) {
      const at = issue.path.map(String);
      const node = at.reduce<unknown>((step, key) => (isObject(step) || Array.isArray(step) ? (step as Json)[key] : undefined), current);
      if (issue.code === "unrecognized_keys" && isObject(node)) {
        // A key the schema does not know, holding null: nothing was meant by it.
        for (const unknown of (issue as { keys?: readonly string[] }).keys ?? []) {
          if (node[unknown] === null) { delete node[unknown]; changed = true; }
        }
        continue;
      }
      if (at.length === 0) continue;
      const parent = at.slice(0, -1).reduce<unknown>((step, key) => (isObject(step) || Array.isArray(step) ? (step as Json)[key] : undefined), current);
      const key = at[at.length - 1]!;
      if (!isObject(parent) && !Array.isArray(parent)) continue;
      const here = (parent as Json)[key];
      // A complaint about a null, whatever its code -- the wrong type, not one
      // of the options -- is a null the schema does not accept there, which in
      // the dialect can only mean the field was absent.
      if (here === null && isObject(parent)) {
        delete parent[key];
        changed = true;
      } else if (issue.code === "invalid_type" && Array.isArray(here) && /record|object/i.test(issue.message) && here.every((pair) => isObject(pair) && typeof pair.key === "string")) {
        (parent as Json)[key] = Object.fromEntries(here.map((pair) => [(pair as Json).key as string, (pair as Json).value]));
        changed = true;
      }
    }
    if (!changed) return current;
  }
  return current;
}
