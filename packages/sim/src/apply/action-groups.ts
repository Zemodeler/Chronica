import type { WorldDelta } from "@chronica/shared";

/** Required effects of hiring commit together; unrelated world acts stay independent. */
export function hiringGroups(deltas: readonly WorldDelta[], supplied: readonly (readonly WorldDelta[])[] = []): readonly (readonly WorldDelta[])[] {
  const groups = supplied.map((group) => new Set(group));
  for (const contract of deltas) {
    if (contract.op !== "service_contract_open") continue;
    const group = groups.find((entry) => entry.has(contract)) ?? new Set<WorldDelta>([contract]);
    if (!groups.includes(group)) groups.push(group);
    for (const candidate of deltas) {
      if (candidate.op === "force_create" && contract.company !== null
        && candidate.categoryId === contract.company.categoryId && candidate.authorizedStrength === contract.company.strength
        && /hir|charter|mercenar|contract/i.test(`${candidate.name} ${candidate.reason}`)) group.add(candidate);
    }
    // Include any local declarations the contract needs. Failed hiring must
    // not leave an employee, company or payment manufactured for it behind.
    let grew = true;
    while (grew) {
      grew = false;
      const refs = new Set([...JSON.stringify([...group]).matchAll(/local:([^"\s]+)/g)].map((match) => match[1]));
      for (const candidate of deltas) if ("localId" in candidate && refs.has(candidate.localId) && !group.has(candidate)) { group.add(candidate); grew = true; }
    }
  }
  // Shared prerequisites make one group, not two copies of the same act.
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length;) {
    if ([...groups[j]!].some((delta) => groups[i]!.has(delta))) { for (const delta of groups[j]!) groups[i]!.add(delta); groups.splice(j, 1); }
    else j++;
  }
  return groups.filter((group) => group.size > 1).map((group) => deltas.filter((delta) => group.has(delta)));
}
