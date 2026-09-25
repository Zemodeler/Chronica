import { boundedId, stableChoice } from "../determinism";
import type {
  Estate,
  EstateStatusSchema,
  InheritanceRule,
  InheritanceTransfer,
  MaterialWorldState,
  MoneyTransaction,
} from "../material-state";
import { z } from "zod";
import { currentAgeYears } from "./age";
import type { Character } from "./character";
import { childrenOf, familyLinksOf, type FamilyLink } from "./family";
import type { LegacyCause } from "../continuity/continuity";
import { computeOpinion } from "./opinion";

// Estates, inheritance, legacy causes, and player succession
// (character-sim phase 5).
//
// Estates never duplicate a balance or a holding -- they only name existing
// `MoneyAccount`/`Holding`/`MoneyObligation` records and the rule that decides
// who inherits them. Offices are never touched here: an office becomes
// vacant on death (`characters/succession.ts`) and is only ever refilled
// through a Phase 4 institutional procedure.

type EstateStatus = z.infer<typeof EstateStatusSchema>;

interface BeneficiaryResolution {
  readonly beneficiaryIds: readonly string[];
  readonly status: EstateStatus;
  readonly reason: string;
}

function livingChildren(world: { characters: readonly Character[]; familyLinks: readonly FamilyLink[] }, ownerCharacterId: string): readonly Character[] {
  const childIds = new Set(childrenOf(world, ownerCharacterId));
  return world.characters.filter((c) => childIds.has(c.id) && c.alive);
}

function eldestOrSenior(world: { characters: readonly Character[]; familyLinks: readonly FamilyLink[] }, ownerCharacterId: string, elapsedStep: number): Character | undefined {
  const kin = familyLinksOf(world, ownerCharacterId)
    .filter((view) => ["child", "sibling", "spouse_or_partner", "other_relative"].includes(view.kind))
    .map((view) => world.characters.find((c) => c.id === view.counterpartCharacterId))
    .filter((c): c is Character => c !== undefined && c.alive);
  if (kin.length === 0) return undefined;
  const ranked = [...kin].sort((a, b) => {
    const ageDiff = currentAgeYears(b, elapsedStep) - currentAgeYears(a, elapsedStep);
    if (ageDiff !== 0) return ageDiff;
    return stableChoice([a.id, b.id, "seniority-tie"], 2) === 0 ? -1 : 1;
  });
  return ranked[0];
}

/** Resolves who inherits, deterministically, by the estate's declared rule. Never resolves "elective"/"custom_scenario_rule" -- those stay disputed for a Phase 4 procedure or scenario-specific handling. */
export function resolveBeneficiaries(
  world: { characters: readonly Character[]; familyLinks: readonly FamilyLink[] },
  estate: Estate,
  rule: InheritanceRule,
  elapsedStep: number,
): BeneficiaryResolution {
  switch (rule.kind) {
    case "primogeniture": {
      const children = livingChildren(world, estate.ownerCharacterId);
      if (children.length === 0) return { beneficiaryIds: [], status: "disputed", reason: "No living child exists to inherit by primogeniture." };
      const eldest = [...children].sort((a, b) => {
        const diff = currentAgeYears(b, elapsedStep) - currentAgeYears(a, elapsedStep);
        return diff !== 0 ? diff : stableChoice([a.id, b.id, "primogeniture-tie"], 2) === 0 ? -1 : 1;
      })[0]!;
      return { beneficiaryIds: [eldest.id], status: "settled", reason: `${eldest.name} inherits as the eldest living child.` };
    }
    case "seniority": {
      const senior = eldestOrSenior(world, estate.ownerCharacterId, elapsedStep);
      if (senior === undefined) return { beneficiaryIds: [], status: "disputed", reason: "No living kin exists to inherit by seniority." };
      return { beneficiaryIds: [senior.id], status: "settled", reason: `${senior.name} inherits as the senior living kin.` };
    }
    case "equal_division": {
      const children = livingChildren(world, estate.ownerCharacterId);
      const beneficiaries = children.length > 0
        ? children
        : estate.testamentaryBeneficiaryIds.map((id) => world.characters.find((c) => c.id === id)).filter((c): c is Character => c !== undefined && c.alive);
      if (beneficiaries.length === 0) return { beneficiaryIds: [], status: "disputed", reason: "No living beneficiary exists for equal division." };
      return { beneficiaryIds: beneficiaries.map((c) => c.id).sort(), status: "settled", reason: "The estate is divided equally among living beneficiaries." };
    }
    case "appointment": {
      const named = estate.testamentaryBeneficiaryIds.map((id) => world.characters.find((c) => c.id === id)).find((c): c is Character => c !== undefined && c.alive);
      if (named === undefined) return { beneficiaryIds: [], status: "disputed", reason: "No named, living beneficiary survives to take the appointment." };
      return { beneficiaryIds: [named.id], status: "settled", reason: `${named.name} inherits as the named beneficiary.` };
    }
    case "elective":
      return { beneficiaryIds: [], status: "disputed", reason: "This estate is settled only through its institution's own procedure." };
    case "custom_scenario_rule":
      return { beneficiaryIds: [], status: "disputed", reason: "This estate requires scenario-specific resolution." };
  }
}

/** Settles one estate: reassigns accounts/holdings/obligations, records every transfer, and marks its final status. Never touches an office. */
export function settleEstate(
  world: { characters: readonly Character[]; material: MaterialWorldState; familyLinks: readonly FamilyLink[] },
  ownerCharacterId: string,
  atStep: number,
): { material: MaterialWorldState; transfers: readonly InheritanceTransfer[]; beneficiaryIds: readonly string[] } {
  const estate = world.material.estates.find((e) => e.ownerCharacterId === ownerCharacterId && e.status !== "settled" && e.status !== "escheated");
  if (estate === undefined) return { material: world.material, transfers: [], beneficiaryIds: [] };
  const rule = world.material.inheritanceRules.find((r) => r.id === estate.inheritanceRuleId);
  if (rule === undefined) return { material: world.material, transfers: [], beneficiaryIds: [] };

  const resolution = resolveBeneficiaries(world, estate, rule, atStep);
  const transfers: InheritanceTransfer[] = [];
  let material = world.material;
  const primaryBeneficiaryId = resolution.beneficiaryIds[0] ?? null;

  const splitCount = Math.max(1, resolution.beneficiaryIds.length);
  for (const accountId of estate.accountIds) {
    const account = material.accounts.find((a) => a.id === accountId);
    if (account === undefined) continue;
    if (resolution.beneficiaryIds.length === 0) {
      transfers.push({
        id: boundedId(estate.id, "transfer", "account", accountId), estateId: estate.id, deceasedCharacterId: ownerCharacterId,
        beneficiaryCharacterId: null, assetKind: "account_balance", assetId: accountId,
        reason: "Escheated: no valid beneficiary.", resolvedAtStep: atStep, sourceEventId: null,
      });
      material = { ...material, accounts: material.accounts.map((a) => (a.id === accountId ? { ...a, status: "locked" as const } : a)) };
      continue;
    }
    const share = Math.floor(account.balance / splitCount);
    const transactions: MoneyTransaction[] = [];
    resolution.beneficiaryIds.forEach((beneficiaryId, index) => {
      const beneficiary = world.characters.find((c) => c.id === beneficiaryId);
      if (beneficiary === undefined) return;
      const amount = index === 0 ? share + (account.balance - share * splitCount) : share;
      if (amount <= 0) return;
      const destinationAccountId = beneficiary.personalAccountId;
      transactions.push({
        id: boundedId(estate.id, "transaction", accountId, beneficiaryId), atStep, kind: "inheritance", amount,
        sourceAccountId: accountId, destinationAccountId,
        cause: { kind: "succession", id: estate.id, explanation: resolution.reason },
        visibility: "polity",
      });
      transfers.push({
        id: boundedId(estate.id, "transfer", "account", accountId, beneficiaryId), estateId: estate.id, deceasedCharacterId: ownerCharacterId,
        beneficiaryCharacterId: beneficiaryId, assetKind: "account_balance", assetId: accountId,
        reason: resolution.reason, resolvedAtStep: atStep, sourceEventId: null,
      });
    });
    material = {
      ...material,
      transactions: [...material.transactions, ...transactions],
      accounts: material.accounts.map((a) => {
        if (a.id === accountId) return { ...a, balance: 0, status: "locked" as const };
        const incoming = transactions.find((t) => t.destinationAccountId === a.id);
        return incoming ? { ...a, balance: a.balance + incoming.amount } : a;
      }),
    };
  }

  for (const holdingId of estate.holdingIds) {
    const holding = material.holdings.find((h) => h.id === holdingId);
    if (holding === undefined) continue;
    material = {
      ...material,
      holdings: material.holdings.map((h) => (h.id === holdingId && primaryBeneficiaryId !== null ? { ...h, legalHolderCharacterId: primaryBeneficiaryId } : h)),
    };
    transfers.push({
      id: boundedId(estate.id, "transfer", "holding", holdingId), estateId: estate.id, deceasedCharacterId: ownerCharacterId,
      beneficiaryCharacterId: primaryBeneficiaryId, assetKind: "holding", assetId: holdingId,
      reason: primaryBeneficiaryId !== null ? resolution.reason : "Escheated: no valid beneficiary.",
      resolvedAtStep: atStep, sourceEventId: null,
    });
  }

  for (const obligationId of estate.obligationIds) {
    const obligation = material.obligations.find((o) => o.id === obligationId);
    if (obligation === undefined) continue;
    if (rule.debtsTransfer && primaryBeneficiaryId !== null) {
      const beneficiary = world.characters.find((c) => c.id === primaryBeneficiaryId);
      material = {
        ...material,
        obligations: material.obligations.map((o) => (o.id === obligationId && beneficiary ? { ...o, payerAccountId: beneficiary.personalAccountId } : o)),
      };
      transfers.push({
        id: boundedId(estate.id, "transfer", "obligation", obligationId), estateId: estate.id, deceasedCharacterId: ownerCharacterId,
        beneficiaryCharacterId: primaryBeneficiaryId, assetKind: "obligation", assetId: obligationId,
        reason: "The obligation transfers to the beneficiary.", resolvedAtStep: atStep, sourceEventId: null,
      });
    } else {
      material = { ...material, obligations: material.obligations.map((o) => (o.id === obligationId ? { ...o, active: false } : o)) };
      transfers.push({
        id: boundedId(estate.id, "transfer", "obligation", obligationId), estateId: estate.id, deceasedCharacterId: ownerCharacterId,
        beneficiaryCharacterId: null, assetKind: "obligation", assetId: obligationId,
        reason: "The obligation is forgiven on death.", resolvedAtStep: atStep, sourceEventId: null,
      });
    }
  }

  material = {
    ...material,
    estates: material.estates.map((e) => (e.id === estate.id ? { ...e, status: resolution.status, settledAtStep: atStep } : e)),
    inheritanceTransfers: [...material.inheritanceTransfers, ...transfers],
  };

  return { material, transfers, beneficiaryIds: resolution.beneficiaryIds };
}

// ---------------------------------------------------------------------------
// Legacy causes: bounded, deterministic public-standing transfer.
// ---------------------------------------------------------------------------

const LEGACY_SCORE_FACTOR = 0.5;
const LEGACY_DECAY_PER_YEAR_BPS = 4_000;

/**
 * Bounded, deterministic reputation transfer: at most `maxCauses` living
 * characters who hold a relation toward the predecessor **and** are either in
 * the successor's polity or already family-linked to them (the concrete,
 * bounded reading of "plausibly know, inherit, or are socially bound" -- not
 * an unrestricted cascade). Private beliefs/plots are never touched; this
 * schema has no path from one character's beliefs to another's.
 */
export function deriveLegacyCauses(
  world: { characters: readonly Character[]; familyLinks: readonly FamilyLink[] },
  predecessorId: string,
  successorId: string,
  atStep: number,
  maxCauses = 5,
): readonly LegacyCause[] {
  const successor = world.characters.find((c) => c.id === successorId);
  if (successor === undefined) return [];
  const familyOfSuccessor = new Set(familyLinksOf(world, successorId).map((view) => view.counterpartCharacterId));

  const candidates = world.characters
    .filter((c) => c.alive && c.id !== predecessorId && c.id !== successorId)
    .map((holder) => ({ holder, score: computeOpinion(holder, predecessorId) }))
    .filter(({ score, holder }) => score !== 0 && (holder.polityId === successor.polityId || familyOfSuccessor.has(holder.id)))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || stableChoice([a.holder.id, b.holder.id, "legacy-tie"], 2) - 0.5)
    .slice(0, maxCauses);

  return candidates.map(({ holder, score }) => ({
    holderCharacterId: holder.id,
    successorCharacterId: successorId,
    predecessorCharacterId: predecessorId,
    cause: {
      id: boundedId(predecessorId, "legacy", holder.id, atStep),
      label: `Inherited standing: as it was held toward ${predecessorId}`,
      score: Math.round(score * LEGACY_SCORE_FACTOR),
      occurredAtStep: atStep,
      decayPerYearBps: LEGACY_DECAY_PER_YEAR_BPS,
      encounterMemoryId: null,
    },
  }));
}

// ---------------------------------------------------------------------------
// Player succession.
// ---------------------------------------------------------------------------

/**
 * Canonical successors in priority order: a living named heir first, then
 * children eldest-first, then spouse/partner, then household head -- filtered
 * to alive and not `disqualifyingStatuses`-blocked. Pure and persistence-
 * agnostic: deliberately unaware of `characterClaims` (a packages/db
 * concept), keeping the same rules/persistence boundary Phase 4 established.
 */
export function findPlayerSuccessors(
  world: { characters: readonly Character[]; familyLinks: readonly FamilyLink[] },
  deadCharacterId: string,
  atStep: number,
  maxCandidates = 5,
): readonly string[] {
  const deceased = world.characters.find((c) => c.id === deadCharacterId);
  if (deceased === undefined) return [];
  const isEligible = (c: Character) => c.alive && c.disqualifyingStatuses.length === 0;

  const ordered: string[] = [];
  if (deceased.heirCharacterId !== null) {
    const heir = world.characters.find((c) => c.id === deceased.heirCharacterId);
    if (heir !== undefined && isEligible(heir)) ordered.push(heir.id);
  }

  const children = livingChildren(world, deadCharacterId)
    .filter(isEligible)
    .sort((a, b) => currentAgeYears(b, atStep) - currentAgeYears(a, atStep));
  for (const child of children) if (!ordered.includes(child.id)) ordered.push(child.id);

  const spouse = familyLinksOf(world, deadCharacterId)
    .filter((view) => view.kind === "spouse_or_partner")
    .map((view) => world.characters.find((c) => c.id === view.counterpartCharacterId))
    .find((c): c is Character => c !== undefined && isEligible(c));
  if (spouse !== undefined && !ordered.includes(spouse.id)) ordered.push(spouse.id);

  const householdHead = familyLinksOf(world, deadCharacterId)
    .filter((view) => view.kind === "household_head")
    .map((view) => world.characters.find((c) => c.id === view.counterpartCharacterId))
    .find((c): c is Character => c !== undefined && isEligible(c));
  if (householdHead !== undefined && !ordered.includes(householdHead.id)) ordered.push(householdHead.id);

  return ordered.slice(0, maxCandidates);
}
