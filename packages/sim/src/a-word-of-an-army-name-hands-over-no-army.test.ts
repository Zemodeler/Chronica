import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, ensureProvinceMaterial } from "@chronica/shared";
import { servesInTerms } from "./apply/apply-deltas";

/**
 * A treaty's words hand over only the army they name (found replaying the consul-run fixes). Rome's terms to the Campanians
 * -- "give yourselves up to the Roman people; your ground passes to Rome" -- put the Roman field army into the service of the
 * Campanian Legion: one word of its name, "Roman", stood a few words before "passes".
 */
const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

describe("an army named in a treaty's terms", () => {
  it("is not handed over for one word of its name standing near a word of service", () => {
    const terms = "Lay down your arms and give yourselves up to the Roman people; your ground passes to Rome.";
    expect(servesInTerms(world, terms, "rome", "rhegium-campanians", [])).toEqual([]);
  });

  it("nor into the service of a power that gives itself up", () => {
    const terms = "The Campanian legion serves Rome, and the Campanians give themselves up to the Roman people.";
    const clauses = [{ kind: "submission" as const, polityId: "rhegium-campanians", toPolityId: "rome" }];
    const handed = servesInTerms(world, terms, "rome", "rhegium-campanians", clauses);
    expect(handed.every((clause) => clause.kind === "force_transfer" && clause.toPolityId !== "rhegium-campanians")).toBe(true);
  });

  it("still hands over the army whose whole name the terms put into service", () => {
    const terms = "The war over Rhegium ends. The Campanian legion serves as a punitive legion for ten years, maintained by Rome.";
    const handed = servesInTerms(world, terms, "rome", "rhegium-campanians", []);
    expect(handed).toEqual([{ kind: "force_transfer", forceRef: "campanian-legion", toPolityId: "rome" }]);
  });
});
