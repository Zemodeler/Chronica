import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type ScenarioClock, type WorldState } from "@chronica/shared";
import { buildWorldSlice, renderWorldSlice } from "./slice";

const clock: ScenarioClock = ScenarioDefinitionSchema.parse(punicWarsScenario.definition).clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const slice = (state: WorldState = world()) =>
  buildWorldSlice({
    world: state,
    clock,
    actorRef: { kind: "character", id: state.characters[0]!.id },
    actorPolityId: "rome",
    orderText: "Invade the Boii lands",
    facts: [],
    dueEvents: [],
    pendingEvents: [],
  });

describe("what the player's government can see of the world", () => {
  it("shows other powers, not only our own side", () => {
    // The slice used to filter every axis to our own polity, so an order to
    // invade was carried out by a model that could not see the enemy at all --
    // and invented placeholders for ground it had no id for.
    const powers = slice().foreignPowers.map((power) => power.id);
    expect(powers).toContain("carthage");
    expect(powers).toContain("boii");
    expect(powers).not.toContain("rome");
  });

  it("names foreign armies and leaders by the id an order must use", () => {
    const carthage = slice().foreignPowers.find((power) => power.id === "carthage")!;
    expect(carthage.forces.join(" ")).toMatch(/\[[a-z0-9-]+\]/);
  });

  it("renders every place with its id, ours and theirs alike", () => {
    const text = renderWorldSlice(slice());
    expect(text).toContain("PLACES");
    expect(text).toContain("OTHER POWERS");
    // The Boii province is somewhere an invasion must be able to name.
    expect(text).toContain("punic-italy-middle-padus");
  });

  it("tells the world plainly which countries have nobody in them", () => {
    const text = renderWorldSlice(slice());
    expect(text).toContain("COUNTRIES WITH NOBODY IN THEM");
    expect(text).toContain("Give each of them the people and forces they plainly ought to have");
  });

  it("stays small enough to send", () => {
    const text = renderWorldSlice(slice());
    // Roughly four characters to the token: the slice must not grow into the
    // thing that makes every order expensive.
    expect(text.length).toBeLessThan(12_000);
  });
});
