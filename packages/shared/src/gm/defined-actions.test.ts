import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { DEFINE_ACTION_TOOL, INVOKE_DEFINED_ACTION_TOOL, buildGameMasterTools } from "./tools";
import { createGameMasterSession } from "./session";

// Defining an action the engine does not have.
//
// The regression this whole path answers: a player did something nobody had
// anticipated -- wrote a letter, swore an oath, founded a colony -- and the
// only thing the engine could do was file it as unsupported and tell him so.
//
// The regression these tests guard against is the opposite danger: that an
// escape hatch wide enough to be useful is also wide enough to write anything
// it likes into the world. Every use is re-validated against the whole
// document, exactly as a built-in action is.
//
// docs/27: the escape hatch is off by default. Every test below exercises it
// with `allowInventedActions: true` on purpose; the "off by default" describe
// block covers the normal-play behaviour instead.

const PLAYER = "marcus-atilius";

const world = (): WorldState => structuredClone(firstPunicWarScenario.initialWorld);

const session = (definedActions: Parameters<typeof createGameMasterSession>[0]["definedActions"] = []) =>
  createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: PLAYER, directiveIds: [], definedActions, allowInventedActions: true });

const call = (name: string, args: Record<string, unknown>) => ({ id: `call-${name}`, name, arguments: args });

/** A plausible unanticipated act: a character's standing rises for a public gift. */
const HONOUR_DEFINITION = {
  actionId: "confer_public_honour",
  intent: "A public honour is conferred, raising the recipient's standing.",
  description: "Raise a character's prestige to record a public honour conferred on them.",
  parameters: [
    { name: "characterId", type: "entity_id" as const, required: true },
    { name: "prestigeBps", type: "number" as const, required: true },
  ],
  operations: [{ op: "replace" as const, path: "/characters[id={{characterId}}]/prestigeBps", value: "{{prestigeBps}}" }],
  invokerAuthority: ["player" as const, "world_director" as const],
};

describe("defining an action the engine lacks", () => {
  it("becomes usable in the same turn it was defined", () => {
    const gm = session();
    const defined = gm.invoke(call(DEFINE_ACTION_TOOL, HONOUR_DEFINITION));
    expect(defined.ok).toBe(true);

    const used = gm.invoke(call(INVOKE_DEFINED_ACTION_TOOL, {
      actionId: "confer_public_honour",
      actorId: PLAYER,
      parameters: { characterId: PLAYER, prestigeBps: 8_000 },
    }));

    expect(used.ok).toBe(true);
    expect(gm.stagedWorld.characters.find((character) => character.id === PLAYER)?.prestigeBps).toBe(8_000);
    // It is a fact like any other, so the Chronicle can be built from it.
    expect(gm.result().events.some((event) => event.actionId === "confer_public_honour")).toBe(true);
  });

  it("is handed back to the campaign so it never has to be invented twice", () => {
    const gm = session();
    gm.invoke(call(DEFINE_ACTION_TOOL, HONOUR_DEFINITION));
    expect(gm.result().definedActions.map((definition) => definition.actionId)).toEqual(["confer_public_honour"]);

    // A later turn is given it and can use it straight away.
    const later = session([HONOUR_DEFINITION]);
    const used = later.invoke(call(INVOKE_DEFINED_ACTION_TOOL, {
      actionId: "confer_public_honour",
      actorId: PLAYER,
      parameters: { characterId: PLAYER, prestigeBps: 6_500 },
    }));
    expect(used.ok).toBe(true);
    expect(later.result().definedActions).toEqual([]);
  });

  it("cannot define over a built-in action", () => {
    const outcome = session().invoke(call(DEFINE_ACTION_TOOL, { ...HONOUR_DEFINITION, actionId: "create_force" }));
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(/already a built-in/i);
  });

  it("refuses to be used before it exists, and says what does exist", () => {
    const outcome = session().invoke(call(INVOKE_DEFINED_ACTION_TOOL, { actionId: "swear_oath", actorId: PLAYER, parameters: {} }));
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(new RegExp(DEFINE_ACTION_TOOL));
  });
});

describe("the limits on what a defined action may do", () => {
  const define = (definition: Record<string, unknown>) => {
    const gm = session();
    const defined = gm.invoke(call(DEFINE_ACTION_TOOL, definition));
    return { gm, defined };
  };

  it("cannot touch the clock, the pins, or the schema version", () => {
    const { gm, defined } = define({
      ...HONOUR_DEFINITION,
      actionId: "seize_time",
      parameters: [],
      operations: [{ op: "replace", path: "/elapsedStep", value: 9_999 }],
    });
    expect(defined.ok).toBe(true);

    const used = gm.invoke(call(INVOKE_DEFINED_ACTION_TOOL, { actionId: "seize_time", actorId: PLAYER, parameters: {} }));
    expect(used.ok).toBe(false);
    expect(used.factual).toMatch(/protected/i);
    expect(gm.stagedWorld.elapsedStep).toBe(world().elapsedStep);
  });

  it("cannot produce a world the engine would refuse", () => {
    const { gm } = define({
      ...HONOUR_DEFINITION,
      actionId: "unmake_prestige",
      parameters: [{ name: "characterId", type: "entity_id", required: true }],
      operations: [{ op: "replace", path: "/characters[id={{characterId}}]/prestigeBps", value: "not a number" }],
    });

    const used = gm.invoke(call(INVOKE_DEFINED_ACTION_TOOL, { actionId: "unmake_prestige", actorId: PLAYER, parameters: { characterId: PLAYER } }));
    expect(used.ok).toBe(false);
    expect(WorldStateSchema.safeParse(gm.stagedWorld).success).toBe(true);
    expect(gm.stagedWorld.characters.find((character) => character.id === PLAYER)?.prestigeBps).toBe(
      world().characters.find((character) => character.id === PLAYER)?.prestigeBps,
    );
  });

  it("cannot leave a reference pointing at nothing", () => {
    const { gm } = define({
      ...HONOUR_DEFINITION,
      actionId: "exile_into_nowhere",
      parameters: [{ name: "characterId", type: "entity_id", required: true }],
      operations: [{ op: "replace", path: "/characters[id={{characterId}}]/locationProvinceId", value: "province-that-does-not-exist" }],
    });

    const used = gm.invoke(call(INVOKE_DEFINED_ACTION_TOOL, { actionId: "exile_into_nowhere", actorId: PLAYER, parameters: { characterId: PLAYER } }));
    expect(used.ok).toBe(false);
    expect(used.factual).toMatch(/reference/i);
  });

  it("needs a living actor to take it", () => {
    const { gm } = define(HONOUR_DEFINITION);
    const used = gm.invoke(call(INVOKE_DEFINED_ACTION_TOOL, {
      actionId: "confer_public_honour",
      actorId: "nobody-at-all",
      parameters: { characterId: PLAYER, prestigeBps: 8_000 },
    }));
    expect(used.ok).toBe(false);
    expect(used.factual).toMatch(/no living character/i);
  });

  it("stops at three new actions in one turn", () => {
    const gm = session();
    for (const index of [1, 2, 3]) {
      expect(gm.invoke(call(DEFINE_ACTION_TOOL, { ...HONOUR_DEFINITION, actionId: `honour_variant_${index}` })).ok).toBe(true);
    }
    const fourth = gm.invoke(call(DEFINE_ACTION_TOOL, { ...HONOUR_DEFINITION, actionId: "honour_variant_4" }));
    expect(fourth.ok).toBe(false);
    expect(fourth.factual).toMatch(/limit/i);
  });
});

describe("off by default (docs/27)", () => {
  const defaultSession = () =>
    createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: PLAYER, directiveIds: [] });

  it("omits both tools from the default surface", () => {
    const names = buildGameMasterTools().map((tool) => tool.name);
    expect(names).not.toContain(DEFINE_ACTION_TOOL);
    expect(names).not.toContain(INVOKE_DEFINED_ACTION_TOOL);
  });

  it("includes both tools only when explicitly enabled", () => {
    const names = buildGameMasterTools({ allowInventedActions: true }).map((tool) => tool.name);
    expect(names).toContain(DEFINE_ACTION_TOOL);
    expect(names).toContain(INVOKE_DEFINED_ACTION_TOOL);
  });

  it("refuses define_action without staging anything", () => {
    const gm = defaultSession();
    const outcome = gm.invoke(call(DEFINE_ACTION_TOOL, HONOUR_DEFINITION));
    expect(outcome.ok).toBe(false);
    expect(outcome.factual).toMatch(new RegExp("request_capability"));
    expect(gm.stagedWorld).toEqual(world());
  });

  it("refuses invoke_defined_action even for a campaign's own earlier definition", () => {
    const gm = createGameMasterSession({ world: world(), atStep: 1, actorCharacterId: PLAYER, directiveIds: [], definedActions: [HONOUR_DEFINITION] });
    const outcome = gm.invoke(call(INVOKE_DEFINED_ACTION_TOOL, {
      actionId: "confer_public_honour",
      actorId: PLAYER,
      parameters: { characterId: PLAYER, prestigeBps: 8_000 },
    }));
    expect(outcome.ok).toBe(false);
    expect(gm.stagedWorld.characters.find((character) => character.id === PLAYER)?.prestigeBps).toBe(
      world().characters.find((character) => character.id === PLAYER)?.prestigeBps,
    );
  });
});
