import {
  admissionRefusal,
  allOffices,
  allSuccessionRules,
  candidacyOffice,
  candidateOf,
  officeRequirements,
  type FactProposalDraft,
  type Office,
  type SuccessionRule,
  type WorldState,
} from "@chronica/shared";

/**
 * A man putting his name forward for an elected office is admitted or refused
 * the day he does it.
 *
 * `political_procedure_open` opened a nomination with no eligibility check at
 * all -- it wrote `eligibilityRequirementIds: []` -- so a legionary at 2,190
 * "stood for the military tribunate", his order read "waiting on a vote" for
 * a month, and on polling day the election quietly left him off the count.
 * The presiding magistrate refused a name at the declaration; so does this,
 * with the numbers, and the candidacy is settled there and then.
 */
export function admitCandidacy(
  world: WorldState,
  procedureId: string | null,
  scenarioOffices: readonly Office[],
  successionRules: readonly SuccessionRule[],
  atStep: number,
  emitFact: (fact: FactProposalDraft) => void,
): WorldState {
  const procedure = procedureId === null ? undefined : world.material.politicalProcedures.find((candidate) => candidate.id === procedureId);
  if (procedure === undefined || procedure.outcome !== null) return world;
  const elective = new Set(allSuccessionRules(world, successionRules).filter((rule) => rule.kind === "elective").map((rule) => rule.id));
  const office = candidacyOffice(procedure, allOffices(world, scenarioOffices).filter((candidate) => elective.has(candidate.successionRuleId)));
  const candidateId = candidateOf(procedure);
  const candidate = candidateId === null ? undefined : world.characters.find((character) => character.id === candidateId);
  if (office === null || candidate === undefined) return world;
  const { requirementIds } = officeRequirements(world, office);
  const refusal = admissionRefusal(world, office, requirementIds, candidate, atStep);
  const settled = refusal === null
    ? { ...procedure, eligibilityRequirementIds: [...requirementIds] }
    : { ...procedure, eligibilityRequirementIds: [...requirementIds], stage: "resolved" as const, outcome: "failed" as const, outcomeReason: `Not admitted: ${refusal}`.slice(0, 400), resolvedAtStep: atStep };
  if (refusal !== null) {
    emitFact({
      localId: `candidacy_refused_${procedure.id}`.replace(/[^a-z0-9_-]/g, "_").slice(0, 60),
      kind: "candidacy_refused",
      summary: `The presiding magistrate would not take ${candidate.name}'s name for ${office.label}: ${refusal}`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: candidate.id }, { kind: "polity", id: office.polityId }],
      knownToRefs: [{ kind: "character", id: candidate.id }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 45,
    });
  }
  return { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((candidacy) => (candidacy.id === procedure.id ? settled : candidacy)) } };
}
