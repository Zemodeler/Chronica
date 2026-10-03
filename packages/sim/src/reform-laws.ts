import {
  currentAgeYears,
  estateTerms,
  type Enactment,
  type Loan,
  type WorldState,
} from "@chronica/shared";
import { loanInstalment, LOAN_TERM_PERIODS } from "./debts";
import { remember, type Grievance } from "./grievances";
import type { IdFactory } from "./ports";

/**
 * The reformer's two laws: land for the landless, and debts eased.
 *
 * A tribune of the plebs could put an agrarian law to the Council of the Plebs
 * and carry it, and nothing happened: a law could do the closed verbs a
 * building does -- raise income, feed a province -- and neither of those is
 * land taken from the men who had occupied the public land and given to men
 * who had none, or a debt cut down. The reformer's whole career was those two
 * laws and the hatred they earned him, and the engine had no way to pass either.
 *
 * Both are sized here, never by the model: who is given land, how much, and
 * what the holders of the public land lose; which loans are eased and by how
 * much. Each moves the people it touches -- the men given land and the debtors
 * relieved think well of the man who carried it, the landholders and the
 * creditors do not -- and raises the sponsor's standing.
 */

/** The most named men a land law gives allotments to: the rest of the land goes to men the world does not name. */
export const LAND_ALLOTMENTS = 6;
/** The share of its yield every estate on the public land gives up, as the occupied land is taken back. */
export const LAND_RESUMED_BPS = 1_000;
/** Veterans settled on the land, who stop pressing as a class for it. */
export const SETTLED_VETERANS = 5_000;
/** The province's people who become smallholders able to serve, per ten thousand of them. */
const NEW_ASSIDUI_BPS = 100;
/** How far a province given land settles. */
const LAND_STABILITY_BPS = 300;
/** What carrying it does for the sponsor's standing. */
export const LAND_LAW_STANDING_BPS = 600;
export const DEBT_LAW_STANDING_BPS = 400;
/** The uncial rate, a twelfth a year (lex Duilia Menenia): what a debt law caps interest at where it names no rate. */
export const DEFAULT_INTEREST_CAP_BPS = 833;

/** The province a law's land lies in: the one it names, if the power holds it, else its capital's. */
function landProvinceOf(world: WorldState, polityId: string, named: string | null): string | null {
  if (named !== null && world.map.provinces.some((province) => province.id === named && province.controllerPolityId === polityId)) return named;
  const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId;
  return world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id
    ?? world.map.provinces.find((province) => province.controllerPolityId === polityId)?.id
    ?? null;
}

const withStanding = (world: WorldState, characterId: string | null, bps: number): WorldState => (characterId === null ? world : {
  ...world,
  characters: world.characters.map((character) => (character.id === characterId ? { ...character, prestigeBps: Math.min(10_000, character.prestigeBps + bps) } : character)),
});

/**
 * An agrarian law: allotments of the public land to the polity's landless
 * freemen -- the humblest first, never the sponsor himself -- the veterans
 * settled on it, the province's new smallholders able to serve, and every
 * estate already on that land a tenth poorer for what was taken back.
 */
export function carryOutLandLaw(
  world: WorldState,
  polityId: string,
  land: NonNullable<Enactment["land"]>,
  sponsorId: string | null,
  atStep: number,
  ids: IdFactory,
  seed: string,
): { world: WorldState; said: string[] } {
  const provinceId = landProvinceOf(world, polityId, land.provinceId);
  if (provinceId === null) return { world, said: [] };
  const provinceName = world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId;
  const terms = estateTerms(world, provinceId, "slight");
  const landed = new Set(world.material.holdings.map((holding) => holding.legalHolderCharacterId));
  const accounts = new Set(world.material.accounts.map((account) => account.id));
  const recipients = world.characters
    .filter((character) => character.alive && character.polityId === polityId && character.id !== sponsorId
      && character.ordo !== "patrician" && character.gender !== "female" && !landed.has(character.id)
      && accounts.has(character.personalAccountId) && currentAgeYears(character, atStep) >= 17)
    .sort((a, b) => a.prestigeBps - b.prestigeBps || a.id.localeCompare(b.id))
    .slice(0, LAND_ALLOTMENTS);
  // The men who had the public land, and lose some of it: whoever holds an
  // estate where the land lies, or anywhere of the power's, before today.
  const ownProvinces = new Set(world.map.provinces.filter((province) => province.controllerPolityId === polityId).map((province) => province.id));
  const resumed = world.material.holdings.filter((holding) => ownProvinces.has(holding.territoryId)
    && world.characters.some((character) => character.id === holding.legalHolderCharacterId && character.polityId === polityId));
  const resumedIncome = new Set(resumed.map((holding) => holding.incomeSourceId));
  const inheritance = world.material.holdings[0]?.successionRuleId ?? "household";

  const allotments = terms === null ? [] : recipients.map((character) => ({ character, holdingId: ids.next("holding"), incomeId: ids.next("income") }));
  const discharged = settleVeterans(world.society.discharged, polityId);
  let next: WorldState = {
    ...world,
    society: { ...world.society, discharged },
    material: {
      ...world.material,
      incomeSources: [
        ...world.material.incomeSources.map((source) => (resumedIncome.has(source.id)
          ? { ...source, amount: Math.max(1, source.amount - Math.floor((source.amount * LAND_RESUMED_BPS) / 10_000)) }
          : source)),
        ...allotments.map(({ character, holdingId, incomeId }) => ({
          id: incomeId, kind: "land" as const, label: `Yield of an allotment in ${provinceName}`.slice(0, 120), beneficiaryAccountId: character.personalAccountId,
          originKind: "holding" as const, originId: holdingId, amount: terms!.monthlyYield, cadenceSteps: 30, nextDueStep: atStep + 30,
          collectionRateBps: 10_000, counterpartyPolityId: null, active: true,
        })),
      ],
      holdings: [...world.material.holdings, ...allotments.map(({ character, holdingId, incomeId }) => ({
        id: holdingId, title: `An allotment of public land in ${provinceName}`.slice(0, 120), territoryId: provinceId, legalHolderCharacterId: character.id,
        incomeSourceId: incomeId, successionRuleId: inheritance, physicalControlBps: 10_000,
      }))],
      // The men the world does not name: smallholders now, who can be levied.
      provinceMaterial: world.material.provinceMaterial.map((entry) => (entry.provinceId === provinceId ? {
        ...entry,
        availableManpower: entry.availableManpower + Math.round((entry.population * NEW_ASSIDUI_BPS) / 10_000),
        stabilityBps: Math.min(10_000, entry.stabilityBps + LAND_STABILITY_BPS),
      } : entry)),
    },
  };
  next = withStanding(next, sponsorId, LAND_LAW_STANDING_BPS);
  if (sponsorId !== null) {
    const losers = [...new Set(resumed.map((holding) => holding.legalHolderCharacterId))].filter((id) => id !== sponsorId);
    next = remember(next, [
      ...allotments.map(({ character }): Grievance => ({ subjectCharacterId: character.id, targetCharacterId: sponsorId, label: "His law gave me land of my own.", score: 15, dimensions: { affection: 15, obligation: 20, trust: 10 } })),
      ...losers.map((id): Grievance => ({ subjectCharacterId: id, targetCharacterId: sponsorId, label: "His land law took the public land my family had farmed for generations.", score: -15, dimensions: { affection: -15, trust: -15, respect: -5 } })),
    ], atStep, `land-law-${seed}`);
  }
  const said = [
    allotments.length === 0
      ? `the public land in ${provinceName} is shared out among men the record does not name`
      : `the public land in ${provinceName} is shared out, and ${allotments.map(({ character }) => character.name).join(", ")} ${allotments.length === 1 ? "is" : "are"} given allotments of it`,
    ...(resumed.length === 0 ? [] : [`the estates on it give up a tenth of their yield`]),
    ...(menOf(world.society.discharged, polityId) === menOf(discharged, polityId) ? [] : [`${menOf(world.society.discharged, polityId) - menOf(discharged, polityId)} veterans are settled on it`]),
  ];
  return { world: next, said };
}

const menOf = (discharged: WorldState["society"]["discharged"], polityId: string): number =>
  discharged.filter((entry) => entry.polityId === polityId).reduce((sum, entry) => sum + entry.count, 0);

/** Up to `SETTLED_VETERANS` of the power's discharged men, the longest waiting first, settled on the land. */
function settleVeterans(discharged: WorldState["society"]["discharged"], polityId: string): WorldState["society"]["discharged"] {
  let room = SETTLED_VETERANS;
  return discharged.flatMap((entry) => {
    if (entry.polityId !== polityId || room <= 0) return [entry];
    const settled = Math.min(room, entry.count);
    room -= settled;
    return entry.count - settled > 0 ? [{ ...entry, count: entry.count - settled }] : [];
  });
}

/**
 * A debt law: every private loan owed by a man of the power held to a yearly
 * rate of interest, and a share of what is owed forgiven. A loan forgiven
 * entirely is done with; the rest are paid down at the new rate from the
 * next month.
 */
export function carryOutDebtRelief(
  world: WorldState,
  polityId: string,
  debt: NonNullable<Enactment["debt"]>,
  sponsorId: string | null,
  atStep: number,
  seed: string,
): { world: WorldState; said: string[] } {
  // Every debt law caps the interest at the uncial rate, unless the world's own record named another.
  const capPerYear = debt.interestCapBps ?? DEFAULT_INTEREST_CAP_BPS;
  const debtorOf = (loan: Loan): string | null => {
    const owner = world.material.accounts.find((account) => account.id === loan.borrowerAccountId)?.owner;
    return owner?.kind === "character" && world.characters.some((character) => character.id === owner.id && character.polityId === polityId) ? owner.id : null;
  };
  const eased = new Map<string, Loan>();
  for (const loan of world.material.loans) {
    if ((loan.status !== "active" && loan.status !== "defaulted") || loan.outstanding <= 0 || debtorOf(loan) === null) continue;
    const cap = capPerYear === null ? null : Math.round((capPerYear * loan.cadenceSteps) / 365);
    const interestBps = cap === null ? loan.interestBps : Math.min(loan.interestBps, cap);
    const outstanding = loan.outstanding - Math.floor((loan.outstanding * debt.forgiveBps) / 10_000);
    if (interestBps === loan.interestBps && outstanding === loan.outstanding) continue;
    eased.set(loan.id, { ...loan, interestBps, outstanding, ...(outstanding <= 0 ? { outstanding: 0, status: "repaid" as const } : {}) });
  }
  if (eased.size === 0) return { world, said: ["but no private debt stood to be eased"] };
  const byObligation = new Map([...eased.values()].filter((loan) => loan.serviceObligationId !== null).map((loan) => [loan.serviceObligationId!, loan]));
  let next: WorldState = {
    ...world,
    material: {
      ...world.material,
      loans: world.material.loans.map((loan) => eased.get(loan.id) ?? loan),
      // The instalment owed from the next month, at the new rate on what is still owed.
      obligations: world.material.obligations.map((obligation) => {
        const loan = byObligation.get(obligation.id);
        if (loan === undefined || !obligation.active) return obligation;
        if (loan.status === "repaid") return { ...obligation, active: false };
        return { ...obligation, amount: loanInstalment(loan.outstanding, loan.interestBps, obligation.remainingPeriods ?? LOAN_TERM_PERIODS) };
      }),
    },
  };
  next = withStanding(next, sponsorId, DEBT_LAW_STANDING_BPS);
  if (sponsorId !== null) {
    const loans = [...eased.values()];
    const debtors = [...new Set(loans.flatMap((loan) => debtorOf(loan) ?? []))];
    const creditors = [...new Set(loans.flatMap((loan) => (loan.lenderKind === "character" && loan.lenderId !== null ? [loan.lenderId] : [])))];
    next = remember(next, [
      ...debtors.map((id): Grievance => ({ subjectCharacterId: id, targetCharacterId: sponsorId, label: "His law lifted part of my debt.", score: 12, dimensions: { affection: 12, obligation: 15 } })),
      ...creditors.map((id): Grievance => ({ subjectCharacterId: id, targetCharacterId: sponsorId, label: "His debt law robbed me of what I was owed.", score: -12, dimensions: { affection: -12, trust: -15 } })),
    ], atStep, `debt-law-${seed}`);
  }
  const cleared = [...eased.values()].filter((loan) => loan.status === "repaid").length;
  return {
    world: next,
    said: [
      `${eased.size} private debt${eased.size === 1 ? " is" : "s are"} eased${capPerYear === null ? "" : `, their interest held to ${(capPerYear / 100).toFixed(capPerYear % 100 === 0 ? 0 : 1)} in the hundred a year`}${debt.forgiveBps > 0 ? `, ${Math.round(debt.forgiveBps / 100)} in the hundred of what is owed forgiven` : ""}${cleared > 0 ? `, and ${cleared} cleared entirely` : ""}`,
    ],
  };
}

/** Both laws, as one enactment carries them: called from `carryOutEnactment`. */
export function carryOutReformLaws(
  world: WorldState,
  enactment: Enactment,
  atStep: number,
  ids: IdFactory,
  sponsorId: string | null,
): { world: WorldState; said: string[] } {
  let next = world;
  const said: string[] = [];
  if (enactment.land != null) {
    const carried = carryOutLandLaw(next, enactment.polityId, enactment.land, sponsorId, atStep, ids, enactment.procedureId);
    next = carried.world;
    said.push(...carried.said);
  }
  if (enactment.debt != null) {
    const carried = carryOutDebtRelief(next, enactment.polityId, enactment.debt, sponsorId, atStep, enactment.procedureId);
    next = carried.world;
    said.push(...carried.said);
  }
  return { world: next, said };
}
