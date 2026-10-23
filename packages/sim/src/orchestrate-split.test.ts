import { describe, expect, it } from "vitest";
import { OrchestratorOutputSchema } from "@chronica/shared";
import { mergeOrchestrations, splitOrder } from "./orchestrate";

const ORDER = [
  "Reinforce Roman Field Army to 10000 men and rename it to Legio I.",
  "Then march this army southward towards Rhegium and hunt down the rebelling army make sure none survive.",
  "send a letter to messena tell them that we shall guarantee their autonomy in exchange for becoming a roman vassal",
  "",
  "Ask the senate for the construction of a fleet in Rome, 150 ships strong",
].join(String.fromCharCode(10));

const output = (said: string, local: string) => OrchestratorOutputSchema.parse({
  intent: { summary: said, parts: [{ said, acts: [0], factLocalIds: [local] }] },
  narrativeSummary: said,
  deltas: [{ kind: "treasury_change", note: said }].slice(0, 0),
  facts: [{ localId: local, kind: "order_given", summary: said, visibility: "public", discoveryState: "public", significance: 10 }],
  delegations: [{ localId: "d_" + local, issuerRef: { kind: "character", id: "a" }, recipientRef: { kind: "character", id: "b" }, instruction: said, part: 0 }],
  outcome: "continue",
});

describe("an order of several lines", () => {
  it("is split into one call a line, a continuation staying with its line", () => {
    const lines = splitOrder(ORDER);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Then march");
  });

  it("is not split when it is one thought", () => {
    expect(splitOrder("Raise two legions.")).toEqual(["Raise two legions."]);
    expect(splitOrder(null)).toEqual([]);
  });

  it("reads as one answer, each answer's ids its own and its parts numbered on", () => {
    const merged = mergeOrchestrations([output("Raise.", "same"), output("Write.", "same")]);
    expect(merged.intent.parts.map((part) => part.said)).toEqual(["Raise.", "Write."]);
    expect(merged.facts.map((fact) => fact.localId)).toEqual(["c1_same", "c2_same"]);
    expect(merged.intent.parts.map((part) => part.factLocalIds)).toEqual([["c1_same"], ["c2_same"]]);
    expect(merged.delegations.map((delegation) => delegation.part)).toEqual([0, 1]);
  });
});

describe("an order that opens with a sentence of fact", () => {
  it("keeps the statement with the command it leans on, and does not send it to the model as an order of its own", () => {
    const order = "Messana is mine and the Mamertine garrison is beaten. Put a Syracusan garrison of a thousand men into Messana, and demand a tribute of twenty thousand a year from the Mamertines who still hold Coastal Sicelia. Write to Himilco son of Gisgo that Messana has fallen and I still want the treaty of non-aggression. Pay the army in full from the royal chest.";
    const lines = splitOrder(order);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.filter((line) => line.startsWith("Messana is mine"))).toHaveLength(1);
    expect(lines.every((line) => !line.startsWith("Messana is mine") || line.includes("Put a Syracusan garrison"))).toBe(true);
    expect(lines[0]).toContain("Messana is mine");
    expect(lines[0]).toContain("Put a Syracusan garrison");
  });
});

describe("an order written as one paragraph", () => {
  it("is split at its sentences", () => {
    const paragraph = "March towards the Campanian Legion and fight it. Hire 50 ships ready to transport Legio I to Messana. Send a letter to Messana telling them we shall be there soon. Raise a second army called Legio II with 5000 men and train them, organise the legion so that competent and loyal officers have more power.";
    expect(splitOrder(paragraph)).toHaveLength(4);
  });
});

import { withoutRecordIds } from "./order-outcomes";

describe("what the player is told of an order", () => {
  it("never carries the engine's record ids", () => {
    expect(withoutRecordIds("The column is already marching to the enemy's province under active project project-cdc613a9-d33a-492b-805b-306f19937709-4. The enemy is not yet in the same province."))
      .toBe("The column is already marching to the enemy's province. The enemy is not yet in the same province.");
  });
});

import { WorldStateSchema } from "@chronica/shared";
import { punicWarsScenario } from "@chronica/db";
import { namedForceRaised } from "./order-outcomes";

describe("an army raised under a name", () => {
  it("is found by the name the order gave it", () => {
    const base = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const forces = base.material.forces;
    const world = { ...base, material: { ...base.material, forces: [{ ...forces[0]!, name: "Legio II" }, ...forces.slice(1)] } };
    expect(namedForceRaised(world, "Raise a second army called Legio II with 3000 men.")?.name).toBe("Legio II");
    expect(namedForceRaised(world, "Raise a second army called Legio III.")).toBeUndefined();
    expect(namedForceRaised(world, "March the army called Legio II to Rhegium.")).toBeUndefined();
  });
});

import { partsNotCarriedOut, replacingPart } from "./orchestrate";

const answer = (parts: object[], deltas: object[] = [], extra: object = {}) => OrchestratorOutputSchema.parse({
  intent: { summary: "x", parts }, narrativeSummary: "x", deltas, outcome: "continue", ...extra,
});

describe("what the first answer left undone", () => {
  it("flags a part with no act, but not one refused with a reason of its own (a second call that wrote nothing new), nor an impossible one", () => {
    const output = answer([
      { said: "Disband the garrison by whatever means." },
      { said: "Burn their harbour.", whyNot: "Burning it would start a war Rome has not declared." },
      { said: "Make the Tiber flow north.", whyNot: "No consul can reverse a river." },
    ]);
    expect(partsNotCarriedOut(output).map((part) => part.index)).toEqual([0]);
  });

  it("puts one part's own answer in place of the part, its acts numbered on", () => {
    const original = answer([{ said: "Raise men.", acts: [0] }, { said: "Burn their harbour.", whyNot: "No war declared." }], [{ op: "money_transfer" }].slice(0, 0));
    const retry = answer([{ said: "Burn their harbour.", acts: [0] }], [], {});
    const replaced = replacingPart(original, 1, retry);
    expect(replaced.intent.parts[1]!.said).toBe("Burn their harbour.");
    expect(replaced.intent.parts[0]!.said).toBe("Raise men.");
  });
});

describe("an order told as a story", () => {
  it("is not cut into sentences that lean on each other", () => {
    const story = "Claudius would light scattered fires around the fort over several nights, small and irregular, meant to draw the enemy's watch without alarm. He would vary their placement each night, keeping scouts close on how the enemy responded. Once satisfied, Claudius would begin the false retreat, pulling a visible portion of the legion back under cover of the flames while hidden cohorts sprang the trap.";
    expect(splitOrder(story)).toHaveLength(1);
  });
});

import { approachFirst } from "./burst";

describe("an army ordered to act where it is not", () => {
  it("is first marched there, the act waiting on the march", () => {
    const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const elsewhere = world.map.provinces.find((province) => province.id !== army.locationId)!.id;
    const output = OrchestratorOutputSchema.parse({
      intent: { summary: "A raid.", parts: [{ said: "Raid the Samnite towns.", acts: [0] }] },
      narrativeSummary: "x", outcome: "continue",
      deltas: [{ op: "force_raid", forceRef: army.id, provinceId: elsewhere, reason: "Raid." }],
    });
    const result = approachFirst({ output }, world).output;
    expect(result.intent.parts).toHaveLength(2);
    expect(result.intent.parts[1]!.said).toMatch(/^March /);
    expect(result.intent.parts[0]!.afterParts).toEqual([1]);
    expect(result.deltas.map((delta) => delta.op)).toEqual(["force_raid", "force_modify"]);
    // An army already marching, or already there, is left as written.
    const there = OrchestratorOutputSchema.parse({ ...output, deltas: [{ op: "force_raid", forceRef: army.id, provinceId: army.locationId, reason: "Raid." }] });
    expect(approachFirst({ output: there }, world).output.deltas).toHaveLength(1);
  });
});

import { givenItsDestination } from "./burst";

describe("a march that named no place", () => {
  it("is given the place the order's goal names", () => {
    const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const there = world.map.provinces.find((province) => province.id !== army.locationId)!.id;
    const output = OrchestratorOutputSchema.parse({
      intent: { summary: "March.", parts: [
        { said: "March the Roman field army south.", acts: [0] },
        { said: "Seek battle there.", goals: [{ kind: "force_at", ref: army.id, at: there }] },
      ] },
      narrativeSummary: "x", outcome: "continue",
      deltas: [{ op: "force_modify", forceRef: army.id, hold: false, reason: "Set its battle plan." }],
    });
    const moved = givenItsDestination({ output }, world).output.deltas[0]!;
    expect(moved.op === "force_modify" && moved.locationId).toBe(there);
  });
});

import { capabilityHints } from "./orchestrate";

describe("what the engine can do for an order", () => {
  it("names the acts for the words a part used", () => {
    expect(capabilityHints("Lucius would travel to Alexandria, seeking an Egyptian wife.").join(" ")).toMatch(/envoy/);
    expect(capabilityHints("Quintus would begin running for tribune.").join(" ")).toMatch(/political_procedure_open/);
    expect(capabilityHints("Should the battle be won, offer the survivors terms.").join(" ")).toMatch(/contingency_arm/);
    expect(capabilityHints("Hold the line.")).toEqual([]);
  });
});
