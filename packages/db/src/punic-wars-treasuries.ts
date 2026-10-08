import { inferredGovernmentForm, provinceTaxCapacity, type WorldState } from "@chronica/shared";

/**
 * A chest for every power that keeps one (scenario notes: docs/plans/scenario-notes-offices.md).
 *
 * Twelve powers had a treasury (Rome, Carthage, Syracuse, the Mamertines, the eight allies of the foedus). Every other power had none: a king's
 * repayment of a loan went nowhere, a tribute paid to Egypt was paid to nobody, a levy or a dole by the Ptolemies was a sum with no account behind it.
 * A state with a king, a council or a league has a chest; a tribal people, by its form, has none (the research, `docs/plans/government.md`:
 * no standing tax, no loans) and is left as it was.
 *
 * What comes in. A standing tax of the state's own (`kind: "tax"`, the engine bounds it by what the land can bear), and the chest opens with four
 * months of it, as the allies' do; four fifths of it goes out as the magistracies, garrisons and works of the state, as the allies' does, the pay of its armies and fleets (at 7 a man and 500 a ship a month, not above six tenths of the revenue) being the greater part of it where it has any.
 *
 *  - **The scale**: two in the hundred of what the power's provinces could bear in a month (Carthage's own 1,550,000 is 2.1 in the hundred of its capacity,
 *    Rome's 534,000 is 3, the allies' about 1.2), never more than 2,400,000 a month and never less than 500.
 *  - **Egypt** is set by hand: 2,100,000 a month, about 4,200 talents of silver a year (a talent being 6,000 drachmae). The sources that name a figure are
 *    late and loose: Jerome (on Daniel 11:5, from a lost earlier account) gives Ptolemy II 14,800 talents of silver a year and 1,500,000 artabs of wheat,
 *    which nobody can check and which counts the corn; the Revenue Laws papyrus of about 259 and the Zenon archive show a revenue run through tax farmers,
 *    the royal monopolies (oil, beer, textiles), the harbour dues and the rents of the king's land, and nothing that adds to a sum. The figure here
 *    is Jerome's discounted to under three tenths, which leaves Egypt the richest chest of the age beside Carthage's, as every ancient account has it.
 *    Confidence: that Egypt was the richest state of its day, high; the figure, low (the order of magnitude, medium).
 *  - Every other power: no better source than the land, so the rule above; the figure is a floor of plausibility and not a claim.
 */

/** Of what a power's provinces can bear in a month, the share its standing tax asks. */
export const STANDING_TAX_SHARE = 0.02;
export const STANDING_TAX_FLOOR = 500;
export const STANDING_TAX_CEILING = 2_400_000;
/** Egypt's, by hand (see above). */
export const EGYPT_MONTHLY_REVENUE = 2_100_000;
const HAND_SET: Readonly<Record<string, number>> = { "ptolemaic-egypt": EGYPT_MONTHLY_REVENUE };
/**
 * Powers that keep no chest on purpose: the Campanian legion at Rhegium is a band of soldiers that took a city and lives off it, and the scenario's story of the unpaid
 * mercenaries wants nobody to be paying them (`punic-wars-scenario.test.ts`).
 */
export const NO_CHEST_BY_DESIGN: ReadonlySet<string> = new Set(["rhegium-campanians"]);
/** What a man under arms is paid a month (Rome's legions: 65,000 for the nine thousand of its field army and the rest), and a warship's crew (the Syracusan squadron: 500 a ship). */
const PAY_PER_MAN = 7;
const PAY_PER_SHIP = 500;
/** The most of its revenue a state's army pay may take, in the hundred: a poor state pays its men less, as a poor one did. */
const PAY_SHARE_CEILING = 60;

/** The powers that should keep a chest and do not: a state by its form, holding ground, not ended. */
export function powersWithoutAChest(world: WorldState): readonly string[] {
  const chests = new Set(world.material.accounts.filter((account) => account.owner.kind === "polity").map((account) => account.owner.id));
  const holding = new Set(world.map.provinces.map((province) => province.controllerPolityId).filter((id): id is string => id !== null));
  return world.map.polities
    .filter((polity) => polity.endedAtStep == null && holding.has(polity.id) && !chests.has(polity.id) && !NO_CHEST_BY_DESIGN.has(polity.id) && inferredGovernmentForm(polity) !== "tribal_confederation")
    .map((polity) => polity.id)
    .sort();
}

export function withEveryTreasury(world: WorldState): WorldState {
  const wanting = powersWithoutAChest(world);
  if (wanting.length === 0) return world;
  const accounts: WorldState["material"]["accounts"][number][] = [];
  const incomeSources: WorldState["material"]["incomeSources"][number][] = [];
  const obligations: WorldState["material"]["obligations"][number][] = [];
  const payIds = new Map<string, string>();
  for (const polityId of wanting) {
    const capacity = world.map.provinces.filter((province) => province.controllerPolityId === polityId).reduce((sum, province) => sum + (provinceTaxCapacity(world, province.id) ?? 0), 0);
    const monthly = HAND_SET[polityId] ?? Math.round(Math.min(STANDING_TAX_CEILING, Math.max(STANDING_TAX_FLOOR, capacity * STANDING_TAX_SHARE)) / 100) * 100;
    accounts.push({ id: `${polityId}-treasury`, owner: { kind: "polity", id: polityId }, currencyId: "drachma", balance: 4 * monthly, status: "active", visibility: "polity" });
    incomeSources.push({ id: `${polityId}-standing-tax`, kind: "tax", label: "The standing tax of the state", beneficiaryAccountId: `${polityId}-treasury`, originKind: "polity", originId: polityId, amount: monthly, collectionRateBps: 10_000, counterpartyPolityId: null, cadenceSteps: 30, nextDueStep: 30, active: true });
    // Its armies and fleets are paid out of it (a force with a treasury behind it and no pay could never fall into arrears): at the rate of the age, within what the revenue bears.
    const forces = world.material.forces.filter((force) => force.polityId === polityId);
    const wanted = forces.map((force) => ({ force, pay: force.personnel.reduce((sum, category) => sum + category.fit * (category.categoryId === "warship" ? PAY_PER_SHIP : PAY_PER_MAN), 0) }));
    const total = wanted.reduce((sum, entry) => sum + entry.pay, 0);
    const scale = total <= 0 ? 0 : Math.min(1, (monthly * PAY_SHARE_CEILING) / 100 / total);
    let paid = 0;
    for (const { force, pay } of wanted) {
      const amount = Math.round(pay * scale);
      if (amount <= 0) continue;
      paid += amount;
      payIds.set(force.id, `${force.id}-pay`);
      obligations.push({ id: `${force.id}-pay`, kind: "army_pay", label: `Pay of the ${force.name}`.slice(0, 120), payerAccountId: `${polityId}-treasury`, amount, cadenceSteps: 30, nextDueStep: 30, priority: 900, arrears: 0, missedPeriods: 0, active: true });
    }
    obligations.push({ id: `${polityId}-upkeep`, kind: "salary", label: "The magistracies, garrisons and works of the state", payerAccountId: `${polityId}-treasury`, amount: Math.max(Math.round(monthly * 0.1), Math.round(monthly * 0.8) - paid), cadenceSteps: 30, nextDueStep: 30, priority: 500, arrears: 0, missedPeriods: 0, active: true });
  }
  return {
    ...world,
    material: {
      ...world.material,
      accounts: [...world.material.accounts, ...accounts],
      incomeSources: [...world.material.incomeSources, ...incomeSources],
      obligations: [...world.material.obligations, ...obligations],
      forces: payIds.size === 0 ? world.material.forces : world.material.forces.map((force) => (payIds.has(force.id) ? { ...force, payObligationId: payIds.get(force.id)! } : force)),
    },
  };
}
