import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, advanceWorldTo } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { keepPromises } from "./promises";
import { settleRatifications } from "./ratification";

/**
 * Hand run as Hannibal Gisco (docs/reports/hand-run-reports.md, H2): every treaty undertaking was
 * written as a thing to do and owed by the head of government, so "Carthage will not make war on Syracuse" was marked
 * broken in a peace, and "the fleet will shelter Messana" was marked broken with the fleet in Messana's harbour.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const apply = (world: ReturnType<typeof WorldStateSchema.parse>, actor: string, deltas: unknown[]) => applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), {
  now: world.instant, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
  ids: createIdFactory(`keep-${world.diplomacy.length}-${actor}`), gameId: "keep-test", playerCharacterId: "hannibal-gisco",
});

describe("a treaty's undertakings", () => {
  const pact = () => {
    const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const sent = apply(world, "hannibal-gisco", [{ op: "diplomatic_message_send", localId: "offer", kind: "alliance_offer", fromPolityId: "carthage", fromCharacterRef: "hannibal-gisco",
      toPolityId: "mamertines", toCharacterRef: "mamertine-spokesman", subject: "Friendship and shelter", terms: "Carthage shelters Messana and neither makes war on the other.", visibility: "public", reason: "Offer.", proposes: ["alliance"],
      clauses: [
        { kind: "undertaking", byPolityId: "carthage", duty: "other", what: "The Carthaginian fleet will shelter Messana against any who would take it", withinDays: 30 },
        { kind: "undertaking", byPolityId: "mamertines", duty: "other", what: "The Mamertines will not make war on Carthage", withinDays: 30 }] }]);
    expect(sent.rejected).toEqual([]);
    const state = advanceWorldTo(sent.world, { day: sent.world.diplomacy.at(-1)!.deliveredOnDay!, minute: 0 });
    const accepted = apply(state, "mamertine-spokesman", [{ op: "diplomatic_message_answer", messageRef: state.diplomacy.at(-1)!.id, answer: "accepted", answerText: "Accepted.", reason: "Accept." }]);
    expect(accepted.rejected).toEqual([]);
    // The Council of Elders carries it.
    const waiting = accepted.world.diplomacy.find((message) => message.ratification?.status === "waiting");
    if (waiting === undefined) return accepted.world;
    const voted = { ...accepted.world, material: { ...accepted.world.material, politicalProcedures: accepted.world.material.politicalProcedures.map((procedure) => procedure.id === waiting.ratification!.procedureId ? { ...procedure, outcome: "passed" as const } : procedure) } };
    return settleRatifications(voted, { now: voted.instant, actorRef: { kind: "character", id: "hannibal-gisco" }, offices: definition.government.offices, warfare: definition.warfare, ids: createIdFactory("ratify"), gameId: "keep-test", playerCharacterId: "hannibal-gisco" }).world;
  };

  it("keeps a promise not to make war by holding back, and a sheltering by the man whose fleet it is", () => {
    const world = pact();
    const duties = world.commitments.filter((promise) => promise.description.startsWith("Under the treaty"));
    const refrain = duties.find((promise) => promise.description.includes("will not make war"))!;
    const shelter = duties.find((promise) => promise.description.includes("shelter"))!;
    expect(refrain.form).toBe("refrain");
    expect(shelter.actionKind).toBe("protection");
    expect(shelter.promisorCharacterId).toBe("hannibal-gisco");
    // Their day comes and goes with nobody at war and the fleet in the city's province.
    const later = advanceWorldTo({ ...world, material: { ...world.material, forces: world.material.forces.map((force) => force.id === "carthaginian-fleet" ? { ...force, locationId: "sic-q659z" } : force) } }, { day: world.instant.day + 400, minute: 0 });
    const kept = keepPromises({ world: later, toDay: later.instant.day, playerCharacterId: "hannibal-gisco" });
    const states = kept.world.commitments.filter((promise) => promise.description.startsWith("Under the treaty")).map((promise) => promise.status);
    expect(states).not.toContain("broken");
    expect(kept.facts.some((fact) => fact.kind === "promise_broken")).toBe(false);
  });
});
