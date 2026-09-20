import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrate";
import { buildWorldSlice, renderWorldSlice } from "./slice";

describe("orchestrator prompt", () => {
  it("renders the contract's JSON schema without throwing", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("money_transfer");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("localId");
  });

  it("stays small enough to send on every call", () => {
    // Roughly 4 characters per token. The system prompt is sent every burst
    // iteration, so a schema that balloons is a per-call tax forever. The
    // ceiling moves only when a genuinely new capability is added to the
    // contract -- the watch predicate union, which buys an order that runs to
    // its own completion instead of four orders that each advance two days;
    // then storylines and pressures, which buy a world that starts things of
    // its own and follows them; then the world outside the player's army --
    // letters between powers, war and treaty as things the world holds rather
    // than infers, and a map an army has to actually cross; and now conquest
    // itself, which no arm expressed at all -- a province could not change
    // hands and a rising could not become a country, so a war could be fought
    // for a generation and leave the map exactly as it began; and now a person
    // being able to refuse, which the prompt previously forbade outright and
    // which nothing in the engine had ever recorded happening; and now what a
    // person's body has come to, which no arm could express either -- illness
    // could not impair anybody, so a man "fell ill" in a fact and went on
    // doing everything he had done the day before.
    console.log("system prompt chars:", ORCHESTRATOR_SYSTEM_PROMPT.length, "~tokens:", Math.round(ORCHESTRATOR_SYSTEM_PROMPT.length / 4));
    expect(ORCHESTRATOR_SYSTEM_PROMPT.length).toBeLessThan(59_000);
  });
});

describe("the world slice", () => {
  it("stays small enough to send with every order", () => {
    const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
    const clock = definition.clock;
    const offices = definition.government.offices;
    const world: WorldState = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const text = renderWorldSlice(
      buildWorldSlice({
        world,
        clock,
        offices,
        actorRef: { kind: "character", id: world.characters[0]!.id },
        actorPolityId: "rome",
        orderText: "Invade the Boii lands",
        facts: [],
        dueEvents: [],
        pendingEvents: [],
      }),
    );

    // Roughly 4 characters per token. The slice grows every time the world
    // learns to show something new, and each section is paid for on every
    // orchestration call. A section that pushes past this should have its cap
    // tightened rather than the budget raised.
    console.log("slice chars:", text.length, "~tokens:", Math.round(text.length / 4));
    expect(Math.round(text.length / 4)).toBeLessThan(6_000);
  });
});
