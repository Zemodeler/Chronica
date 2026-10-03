import type { FactProposalDraft, WorldState } from "@chronica/shared";
import { acceptedAgreementDelta, applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * Terms accepted abroad and waiting on the chamber at home, settled once it
 * has voted.
 *
 * A man who cannot bind his government can still write over its name, and
 * the other side can still say yes. Before this, the yes was the treaty: a
 * senator with no office made peace with Hieron, and the Kingdom of Syracuse
 * was absorbed on his word. Now the acceptance waits on a ratification
 * (`DiplomaticMessage.ratification`), and the treaty is opened the day the
 * chamber carries it -- or the other side is told the terms bind nobody.
 */
export function settleRatifications(world: WorldState, context: ApplyContext): { world: WorldState; facts: FactProposalDraft[] } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  for (const message of world.diplomacy) {
    const ratification = message.ratification;
    if (ratification == null || ratification.status !== "waiting") continue;
    const procedure = next.material.politicalProcedures.find((candidate) => candidate.id === ratification.procedureId);
    const outcome = procedure?.outcome ?? (procedure === undefined ? "withdrawn" : null);
    if (outcome === null) continue;
    const home = next.map.polities.find((polity) => polity.id === message.fromPolityId)?.name ?? message.fromPolityId;
    const theirs = next.map.polities.find((polity) => polity.id === message.toPolityId)?.name ?? message.toPolityId;
    if (outcome === "passed") {
      // Ratified first, so the treaty it waited on is made now rather than held again.
      const marked: WorldState = { ...next, diplomacy: next.diplomacy.map((candidate) => (candidate.id === message.id ? { ...candidate, ratification: { ...ratification, status: "ratified" as const } } : candidate)) };
      const opened = applyDeltas(marked, [acceptedAgreementDelta(marked, message, ratification.agreementKind, ratification.boundPolityId)], { ...context, actsForTheWorld: true });
      if (opened.applied.length > 0) {
        const agreementId = opened.world.polityAgreements.find((agreement) => agreement.sourceMessageId === message.id && agreement.kind === ratification.agreementKind)?.id ?? null;
        next = { ...opened.world, diplomacy: opened.world.diplomacy.map((candidate) => (candidate.id === message.id
          ? { ...candidate, agreementId, ratification: { ...ratification, status: "ratified" as const } }
          : candidate)) };
        facts.push(...opened.factProposals, {
          localId: `ratified_${message.id}`.slice(0, 60),
          kind: "treaty_ratified",
          summary: `${home} ratified the terms agreed with ${theirs}, "${message.subject}", and they bind it now.`.slice(0, 600),
          affectedRefs: [{ kind: "polity", id: message.fromPolityId }, { kind: "polity", id: message.toPolityId }, { kind: "character", id: message.fromCharacterId }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 65,
        });
        continue;
      }
      // Carried, and the world will no longer have it: what stood when the
      // terms were agreed is gone. Told as what it is.
      const why = opened.rejected[0]?.reason ?? "the world had moved on";
      next = { ...next, diplomacy: next.diplomacy.map((candidate) => (candidate.id === message.id ? { ...candidate, ratification: { ...ratification, status: "refused" as const } } : candidate)) };
      facts.push({
        localId: `unratifiable_${message.id}`.slice(0, 60),
        kind: "acceptance_unbound",
        summary: `${home} voted the terms agreed with ${theirs}, but they could no longer be carried out: ${why}`.slice(0, 600),
        affectedRefs: [{ kind: "polity", id: message.fromPolityId }, { kind: "polity", id: message.toPolityId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 45,
      });
      continue;
    }
    next = { ...next, diplomacy: next.diplomacy.map((candidate) => (candidate.id === message.id ? { ...candidate, ratification: { ...ratification, status: "refused" as const } } : candidate)) };
    facts.push({
      localId: `not_ratified_${message.id}`.slice(0, 60),
      kind: "treaty_not_ratified",
      summary: `${home} would not ratify the terms its man had agreed with ${theirs}, "${message.subject}": they bind nobody.`.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: message.fromPolityId }, { kind: "polity", id: message.toPolityId }, { kind: "character", id: message.fromCharacterId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 60,
    });
  }
  return { world: next, facts };
}
