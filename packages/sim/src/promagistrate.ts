import { allOffices, type AuthorityGrant, type CommandHold, type Office, type WorldState } from "@chronica/shared";

/**
 * What a man holding an army past his year may do with it.
 *
 * Prorogation used to make a `CommandHold` and nothing else. His office grants
 * ended with his seat, so a proconsul in Sicily could still be obeyed by the
 * men he led -- they look to their general -- but could not lawfully draw a
 * garrison from them, pay for their bread, or agree a truce with the town in
 * front of him: he was a private man with an army, and every act was a
 * breach or a refusal. A pro-magistrate kept the imperium of the field; this
 * is that imperium, as grants that come and go with the hold:
 *
 *  - command of every army he holds, and so its detachments, garrisons and sieges;
 *  - its war chest, and money from the treasury up to an allowance for the
 *    year (what keeping his armies costs, a year of it, and never less than
 *    `MIN_FIELD_ALLOWANCE`), counted as a vote of money is (`voted-budgets.ts`);
 *  - the word of his power to the enemy in front of him: truce, passage, a
 *    town's surrender. War and peace stay the chamber's (`layBeforeTheChamber`).
 *
 * Revoked the day the hold ends (`command-tenure.ts`, `endHold`).
 */

/** The least a pro-magistrate may draw on the treasury in a year of command. */
export const MIN_FIELD_ALLOWANCE = 1_000;

const BASES: ReadonlySet<CommandHold["basis"]> = new Set(["prorogued", "awaiting_successor"]);

export function promagistrateGrants(world: WorldState, hold: CommandHold, atStep: number): AuthorityGrant[] {
  if (!BASES.has(hold.basis)) return [];
  const holder = { kind: "character" as const, id: hold.characterId };
  const expiresAtStep = hold.basis === "prorogued" ? hold.untilStep : null;
  const base = {
    holder, source: "law" as const, sourceRef: hold.id, standing: "lawful" as const, legitimacyBps: 10_000, visibility: "public" as const,
    grantedAtStep: atStep, expiresAtStep, revokedAtStep: null, revocationReason: null, succeedsGrantId: null,
  };
  const grant = (key: string, rest: Pick<AuthorityGrant, "domain" | "scope" | "powers"> & Partial<Pick<AuthorityGrant, "cap">>): AuthorityGrant =>
    ({ ...base, id: `law:${hold.id}:${key}`.slice(0, 120), ...rest });
  const grants: AuthorityGrant[] = [];
  const forces = world.material.forces.filter((force) => hold.forceIds.includes(force.id));
  for (const force of forces) {
    grants.push(grant(`command:${force.id}`, { domain: "military", scope: { kind: "force", id: force.id }, powers: ["command"] }));
    const chest = world.material.accounts.find((account) => account.owner.kind === "force" && account.owner.id === force.id && account.status === "active");
    if (chest !== undefined) grants.push(grant(`chest:${force.id}`, { domain: "fiscal", scope: { kind: "account", id: chest.id }, powers: ["spend"] }));
  }
  const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === hold.polityId && account.status === "active");
  if (treasury !== undefined) {
    const payIds = new Set(forces.map((force) => force.payObligationId).filter((id): id is string => id !== null));
    const monthly = world.material.obligations.filter((obligation) => payIds.has(obligation.id) && obligation.active)
      .reduce((sum, obligation) => sum + obligation.amount * (30 / Math.max(1, obligation.cadenceSteps)), 0);
    const allowance = Math.max(MIN_FIELD_ALLOWANCE, Math.round(monthly * 12));
    grants.push(grant("treasury", { domain: "fiscal", scope: { kind: "account", id: treasury.id }, powers: ["spend"], cap: { amount: allowance, spent: 0 } }));
  }
  grants.push(grant("field-diplomacy", { domain: "diplomatic", scope: { kind: "polity", id: hold.polityId }, powers: ["negotiate"] }));
  return grants;
}

/** Every grant a hold gave, revoked: his year in the field is over. */
export function revokeHoldGrants(world: WorldState, holdId: string, atStep: number, why: string): WorldState {
  if (!world.authorityGrants.some((grant) => grant.sourceRef === holdId && grant.revokedAtStep === null)) return world;
  return {
    ...world,
    authorityGrants: world.authorityGrants.map((grant) => (grant.sourceRef === holdId && grant.revokedAtStep === null
      ? { ...grant, revokedAtStep: atStep, revocationReason: why.slice(0, 300) }
      : grant)),
  };
}

/** "Proconsul", "Propraetor": what a man holding an army past his year of an office is called. */
export function promagistrateTitle(office: Pick<Office, "label"> | undefined): string {
  const label = office?.label ?? "";
  if (/consul/i.test(label)) return "Proconsul";
  if (/praetor/i.test(label)) return "Propraetor";
  if (/quaestor/i.test(label)) return "Proquaestor";
  return label === "" ? "Pro-magistrate" : `Pro-magistrate (${label})`;
}

/**
 * The actor's own command past his year, in words, for the slice: what he is
 * called, until when, and what he may do -- the grants above, said plainly,
 * so a proconsul is not left to guess he may still garrison a town.
 */
export function promagistrateInWords(world: WorldState, characterId: string, scenarioOffices: readonly Office[], dateOf: (step: number) => string): { title: string; line: string } | null {
  const hold = world.commandHolds.find((candidate) => candidate.status === "active" && candidate.characterId === characterId && BASES.has(candidate.basis));
  if (hold === undefined) return null;
  const office = hold.officeId === null ? undefined : allOffices(world, scenarioOffices).find((candidate) => candidate.id === hold.officeId);
  const title = promagistrateTitle(office);
  const armies = world.material.forces.filter((force) => hold.forceIds.includes(force.id)).map((force) => `${force.name} [${force.id}]`).join(" and ") || "his army";
  const purse = world.authorityGrants.find((grant) => grant.id === `law:${hold.id}:treasury`.slice(0, 120) && grant.revokedAtStep === null);
  const spend = purse?.cap === undefined ? "" : ` spend up to ${purse.cap.amount - purse.cap.spent} more from ${purse.scope.id} (${purse.cap.spent} of ${purse.cap.amount} drawn) and from its war chest;`;
  const until = hold.basis === "prorogued" && hold.untilStep !== null ? `prorogued until ${dateOf(hold.untilStep)}` : "until his successor takes the army";
  return {
    title,
    line: `${title} (${until}): may command ${armies}, detach men and leave garrisons from it, lay sieges and provision it;${spend} agree truces, passage and a town's surrender with the enemy before him. War and peace stay the chamber's.`,
  };
}
