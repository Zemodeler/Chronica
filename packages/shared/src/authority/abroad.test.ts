import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { readAbroad } from "./abroad";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const CONSUL = "gaius-genucius";
const FORMER_CONSUL = "manius-curius";
const FOREIGN_KING = "hieron-ii";

/** A person of `polityId` who has never held anything. */
function withNobody(state: WorldState, polityId: string, id = `nobody-of-${polityId}`): WorldState {
  const model = state.characters.find((character) => character.id === CONSUL)!;
  return WorldStateSchema.parse({
    ...state,
    characters: [...state.characters, { ...model, id, name: `Nobody of ${polityId}`, polityId, officeId: null, officesHeld: [] }],
  });
}

function withAgreement(state: WorldState, agreement: Record<string, unknown>): WorldState {
  return WorldStateSchema.parse({ ...state, polityAgreements: [...state.polityAgreements, agreement] });
}

const lineKeys = (state: WorldState, characterId: string): string[] =>
  readAbroad(state, characterId, offices, clock).powers.flatMap((power) => [...power.lines, ...power.ended].map((line) => line.key));

describe("where a power stands with the others", () => {
  it("lists each power once, the war first, the allies grouped as bound to Rome", () => {
    const abroad = readAbroad(world(), CONSUL, offices, clock);
    const ids = abroad.powers.map((power) => power.polityId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(abroad.powers[0]!.posture).toBe("war");
    expect(abroad.powers.find((power) => power.polityId === "samnites")!.posture).toBe("bound_to_us");
  });

  it("names the allies a foedus draws into the war", () => {
    const war = readAbroad(world(), CONSUL, offices, clock).powers.find((power) => power.posture === "war")!;
    expect(war.sides!.yours.length).toBeGreaterThan(0);
  });

  it("shows a foedus ally the war its leader is in, through the leader", () => {
    const state = withNobody(world(), "samnites");
    const war = readAbroad(state, "nobody-of-samnites", offices, clock).powers.find((power) => power.posture === "war");
    expect(war?.lines[0]!.throughLabel).toBe(state.map.polities.find((polity) => polity.id === "rome")!.name);
  });

  it("keeps a private treaty to those who govern its parties, now or before", () => {
    const secret = { id: "secret-pact", kind: "alliance", polityId: "rome", otherPolityId: "carthage", terms: "Neither will move on Sicily.", sinceStep: 0, visibility: "private" };
    const state = withNobody(withAgreement(world(), secret), "rome");
    expect(lineKeys(state, CONSUL)).toContain("secret-pact");
    expect(lineKeys(state, FORMER_CONSUL)).toContain("secret-pact");
    expect(lineKeys(state, "nobody-of-rome")).not.toContain("secret-pact");
    expect(lineKeys(state, FOREIGN_KING)).not.toContain("secret-pact");
    const line = readAbroad(state, CONSUL, offices, clock).powers.flatMap((power) => power.lines).find((candidate) => candidate.key === "secret-pact")!;
    expect(line.secret).toBe(true);
  });

  it("does not tell a man who left office before it was made", () => {
    const later = { id: "later-pact", kind: "alliance", polityId: "rome", otherPolityId: "carthage", terms: "Made after Curius left office.", sinceStep: 100, visibility: "private" };
    const base = withAgreement(world(), later);
    const state = WorldStateSchema.parse({ ...base, elapsedStep: 200, instant: { ...base.instant, day: 200 } });
    expect(lineKeys(state, FORMER_CONSUL)).not.toContain("later-pact");
  });

  it("never hides a war or a peace, whatever the record says", () => {
    const hiddenWar = { id: "hidden-war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "Over Messana.", sinceStep: 0, visibility: "private" };
    const state = withNobody(withAgreement(world(), hiddenWar), "rome");
    expect(lineKeys(state, "nobody-of-rome")).toContain("hidden-war");
    // A third power sees it too, between others.
    expect(readAbroad(state, FOREIGN_KING, offices, clock).between.some((entry) => entry.key === "hidden-war")).toBe(true);
  });

  it("keeps ended treaties, with how they ended", () => {
    const old = {
      id: "old-peace", kind: "peace", polityId: "rome", otherPolityId: "carthage", terms: "An old peace.", sinceStep: 0,
      status: "ended", endedAtStep: 0, endedReason: "Broken over Sicily.", visibility: "public",
    };
    const carthage = readAbroad(withAgreement(world(), old), CONSUL, offices, clock).powers.find((power) => power.polityId === "carthage")!;
    expect(carthage.ended.map((line) => line.ended?.reason)).toContain("Broken over Sicily.");
  });

  it("tells the government's regard in words, and only to those who govern", () => {
    const state = withNobody(world(), "samnites");
    const governed = WorldStateSchema.parse({
      ...state,
      polityStances: [...state.polityStances, { polityId: "rome", towardPolityId: "carthage", trustScore: -40, lastShiftReason: "Carthaginian ships off Tarentum.", lastShiftAtStep: 0 }],
    });
    const regard = readAbroad(governed, CONSUL, offices, clock).powers.find((power) => power.polityId === "carthage")!.regard!;
    expect(regard.inWords).not.toMatch(/\d/);
    expect(regard.why).toBe("Carthaginian ships off Tarentum.");
    const nobody = withNobody(governed, "rome");
    expect(readAbroad(nobody, "nobody-of-rome", offices, clock).powers.every((power) => power.regard === null)).toBe(true);
  });
});
