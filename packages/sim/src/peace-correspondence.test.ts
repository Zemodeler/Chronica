import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, advanceWorldTo, lettersAwaitingYou, correspondenceOf, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const ROMAN = "gaius-genucius";
const DECIUS = "decius-vibellius";
const initial = () => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
function apply(world: WorldState, actor: string, deltas: unknown[]) {
  return applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), {
    now: world.instant, actorRef: { kind: "character", id: actor }, offices: definition.government.offices,
    warfare: definition.warfare, ids: createIdFactory(`peace-${world.diplomacy.length}-${actor}`), gameId: "peace-test", playerCharacterId: ROMAN,
  });
}
const offer = (terms: string) => ({ op: "diplomatic_message_send", localId: "offer", kind: "letter", fromPolityId: "rome", fromCharacterRef: ROMAN,
  toPolityId: "rhegium-campanians", toCharacterRef: DECIUS, subject: "Peace with Rhegium", terms, visibility: "public", reason: "Negotiate peace." });
const arrived = (world: WorldState) => advanceWorldTo(world, { day: world.diplomacy.at(-1)!.deliveredOnDay!, minute: 0 });
const atWar = (world: WorldState) => world.polityAgreements.some((agreement) => agreement.kind === "war" && agreement.status === "active" && [agreement.polityId, agreement.otherPolityId].includes("rhegium-campanians"));

describe("peace correspondence follows the treaty process", () => {
  it("carries out a voluntarily offered surrender and safe-conduct undertaking, retaining the signed treaty", () => {
    const start = initial();
    start.material.officeSeats.push({ id: "rhegium-command-seat", officeId: "rhegium-campanians-command", seatIndex: 0, holderCharacterId: DECIUS,
      status: "held", vacancyCause: "none", termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] });
    const sent = apply(start, DECIUS, [{ ...offer("I will surrender Rhegium if the ordinary soldiers receive safe conduct."),
      fromPolityId: "rhegium-campanians", fromCharacterRef: DECIUS, toPolityId: "rome", toCharacterRef: ROMAN,
      clauses: [
        { kind: "submission", polityId: "rhegium-campanians", toPolityId: "rome" },
        { kind: "undertaking", byPolityId: "rome", duty: "other", what: "Grant safe conduct to the ordinary soldiers without punitive service.", withinDays: 1 },
      ],
    }]);
    expect(sent.rejected).toEqual([]);
    expect(atWar(sent.world)).toBe(true);
    const state = arrived(sent.world);
    const accepted = apply(state, ROMAN, [{ op: "diplomatic_message_answer", messageRef: state.diplomacy.at(-1)!.id, answer: "accepted", answerText: "I accept these terms.", reason: "Accept voluntary surrender." }]);
    expect(accepted.rejected).toEqual([]);
    expect(accepted.factProposals.some((fact) => fact.kind === "acceptance_unbound")).toBe(false);
    expect(atWar(accepted.world)).toBe(false);
    expect(accepted.world.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === "settlement-rhegium")?.controllerPolityId).toBe("rome");
    expect(accepted.world.material.forces.some((force) => force.polityId === "rhegium-campanians")).toBe(false);
    expect(accepted.world.material.officeSeats.find((seat) => seat.id === "rhegium-command-seat")?.vacancyCause).toBe("abolished");
    expect(WorldStateSchema.safeParse(accepted.world).success).toBe(true);
    expect(accepted.world.commitments.some((promise) => promise.description.includes("safe conduct"))).toBe(true);
    expect(accepted.world.storylines.find((storyline) => storyline.id === "rhegium-recovery")?.phase).toBe("closed");
    const message = accepted.world.diplomacy.at(-1)!;
    expect(message.agreementId).toBeTruthy();
    expect(accepted.world.polityAgreements.find((agreement) => agreement.id === message.agreementId)).toMatchObject({ kind: "peace", sourceMessageId: message.id, status: "ended" });
  });
  it("turns a tray letter offering peace into a treaty offer, without ending war before acceptance", () => {
    const sent = apply(initial(), ROMAN, [offer("We offer you peace in exchange for your surrender.")]);
    expect(sent.rejected).toEqual([]);
    expect(sent.world.diplomacy.at(-1)).toMatchObject({ kind: "peace_offer", proposes: ["peace"], agreementId: null });
    expect(atWar(sent.world)).toBe(true);
    const state = arrived(sent.world);
    const accepted = apply(state, DECIUS, [{ op: "diplomatic_message_answer", messageRef: state.diplomacy.at(-1)!.id, answer: "accepted", answerText: "I accept the terms.", reason: "Accept the offer." }]);
    expect(accepted.rejected).toEqual([]);
    expect(atWar(accepted.world)).toBe(false);
    const message = accepted.world.diplomacy.at(-1)!;
    expect(message.agreementId).toBeTruthy();
    expect(accepted.world.polityAgreements.find((agreement) => agreement.id === message.agreementId)).toMatchObject({ kind: "peace", sourceMessageId: message.id, status: "active" });
  });

  it("binds an accepted legacy plain-letter peace offer through the same treaty mechanism", () => {
    const sent = apply(initial(), ROMAN, [offer("We offer peace if you surrender.")]);
    const state = arrived(sent.world);
    state.diplomacy = state.diplomacy.map((message) => ({ ...message, kind: "letter", proposes: [] }));
    const accepted = apply(state, DECIUS, [{ op: "diplomatic_message_answer", messageRef: state.diplomacy.at(-1)!.id, answer: "accepted", answerText: "Agreed.", reason: "Accept." }]);
    expect(accepted.rejected).toEqual([]);
    expect(atWar(accepted.world)).toBe(false);
    expect(accepted.world.diplomacy.at(-1)?.agreementId).toBeTruthy();
  });

  it("shows rejection alongside a renewed offer, even when the sender omitted the reply link", () => {
    const sent = apply(initial(), ROMAN, [offer("We offer peace in exchange for punitive service for ten years.")]);
    const state = arrived(sent.world);
    const oldId = state.diplomacy.at(-1)!.id;
    const refused = apply(state, DECIUS, [{ op: "diplomatic_message_answer", messageRef: oldId, answer: "refused", answerText: "I refuse punitive service. Spare the soldiers.", reason: "Protect the garrison." }]);
    expect(atWar(refused.world)).toBe(true);
    const next = apply(refused.world, DECIUS, [{ ...offer("I will surrender Rhegium if the soldiers receive safe conduct."), fromPolityId: "rhegium-campanians", fromCharacterRef: DECIUS, toPolityId: "rome", toCharacterRef: ROMAN }]);
    expect(next.rejected).toEqual([]);
    const delivered = arrived(next.world);
    const letter = lettersAwaitingYou(delivered, ROMAN, definition.government.offices).find((message) => message.id === delivered.diplomacy.at(-1)!.id)!;
    expect(letter.offers).toEqual([{ kind: "peace", label: "peace" }]);
    expect(letter.previousRejection).toMatchObject({ terms: state.diplomacy.at(-1)!.terms, reason: "I refuse punitive service. Spare the soldiers." });
    expect(correspondenceOf(delivered, ROMAN).find((thread) => thread.withCharacterId === DECIUS)?.pages.at(-1)?.previousRejection?.reason).toContain("punitive service");
    expect(lettersAwaitingYou(next.world, ROMAN, definition.government.offices)).toEqual([]);
  });

  it("keeps treaty clauses attached to peace until acceptance, then applies them", () => {
    const start = initial();
    start.map.provinces = start.map.provinces.map((province) => province.id === "it-5sjyb" ? { ...province, controllerPolityId: "rhegium-campanians" } : province);
    const sent = apply(start, ROMAN, [{ ...offer("We offer peace. You shall give Rhegium back to Rome."), clauses: [{ kind: "cession", provinceId: "it-5sjyb", toPolityId: "rome" }] }]);
    const state = arrived(sent.world);
    const result = apply(state, DECIUS, [{ op: "diplomatic_message_answer", messageRef: state.diplomacy.at(-1)!.id, answer: "accepted", answerText: "I accept.", reason: "Accept cession." }]);
    expect(result.rejected).toEqual([]);
    expect(result.world.map.provinces.find((province) => province.id === "it-5sjyb")?.controllerPolityId).toBe("rome");
    expect(atWar(result.world)).toBe(false);
  });
});
