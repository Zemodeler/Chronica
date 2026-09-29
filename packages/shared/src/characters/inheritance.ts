import { boundedId, stableChoice } from "../determinism";
import type {
  Estate,
  EstateStatusSchema,
  InheritanceRule,
  InheritanceTransfer,
  MoneyAccount,
  MoneyTransaction,
} from "../material-state";
import type { WorldState } from "../world/world-state";
import { z } from "zod";
import { currentAgeYears } from "./age";
import type { Character } from "./character";
import { childrenOf, familyLinksOf, type FamilyLink } from "./family";
import type { LegacyCause } from "../continuity/continuity";
import { computeOpinion } from "./opinion";

// Estates, inheritance, legacy causes, and player succession
// (character-sim phase 5).
//
// An estate is gathered off the world on the day its owner dies (see
// `settleEstate`); an authored `Estate` record is only a will. Offices are
// never touched here: an office becomes vacant on death
// (`characters/succession.ts`) and is refilled by its own procedure.

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

// ---------------------------------------------------------------------------
// Settling an estate.
// ---------------------------------------------------------------------------

/**
 * Everything a person owns, gathered on the day they die.
 *
 * Estates used to be records a scenario had to author in advance, and the
 * Punic Wars authored none -- so every death in every game settled nothing. A
 * consul's purse stayed full under a dead man's name, his farms went on
 * yielding into it, and the son who took up the house inherited an empty
 * purse and a line promising "what is left". What a man owns is already in
 * the world: the accounts that are his, the land held in his name, his
 * ventures, his slaves and freedmen, what he owes and what is owed him. So
 * the estate is read off the world at the moment it is needed, and an
 * authored `Estate` survives only as a will: its rule and its named heirs.
 */
interface GatheredEstate {
  readonly accounts: readonly MoneyAccount[];
  readonly holdingIds: readonly string[];
  readonly ventureIds: readonly string[];
  readonly dependantIds: readonly string[];
  /** What he owed: paid out of his accounts. */
  readonly debtIds: readonly string[];
  /** What was owed him: paid into them. */
  readonly creditIds: readonly string[];
  readonly incomeIds: readonly string[];
}

function gatherEstate(world: WorldState, deceased: Character, authored: Estate | undefined): GatheredEstate {
  const { material } = world;
  const accountIds = new Set<string>([deceased.personalAccountId, ...(authored?.accountIds ?? [])]);
  for (const account of material.accounts) {
    if (account.owner.kind === "character" && account.owner.id === deceased.id) accountIds.add(account.id);
  }
  // A purse some living person also draws on is theirs as much as his, and is
  // neither emptied nor locked by his death.
  const sharedWithTheLiving = new Set(world.characters.filter((character) => character.alive && character.id !== deceased.id).map((character) => character.personalAccountId));
  const accounts = material.accounts.filter((account) => accountIds.has(account.id) && account.status !== "closed" && !sharedWithTheLiving.has(account.id));
  const held = new Set(accounts.map((account) => account.id));
  const holdingIds = new Set<string>(authored?.holdingIds ?? []);
  for (const holding of material.holdings) if (holding.legalHolderCharacterId === deceased.id) holdingIds.add(holding.id);
  return {
    accounts,
    holdingIds: [...holdingIds].sort(),
    ventureIds: material.ventures.filter((venture) => venture.ownerCharacterId === deceased.id && venture.status === "running").map((venture) => venture.id).sort(),
    dependantIds: world.characters.filter((character) => character.alive && character.ownerCharacterId === deceased.id).map((character) => character.id).sort(),
    debtIds: material.obligations.filter((obligation) => obligation.active && held.has(obligation.payerAccountId)).map((obligation) => obligation.id),
    creditIds: material.obligations.filter((obligation) => obligation.active && obligation.recipientAccountId !== undefined && held.has(obligation.recipientAccountId)).map((obligation) => obligation.id),
    incomeIds: material.incomeSources.filter((source) => held.has(source.beneficiaryAccountId)).map((source) => source.id),
  };
}

/** Somebody the law lets inherit: alive, and not himself property. */
function canInherit(character: Character | undefined): character is Character {
  return character !== undefined && character.alive && character.legalStatus !== "enslaved";
}

/** Cultures whose sons inherit before their daughters do. Rome's children inherited alike. */
const SONS_FIRST = new Set(["greek", "carthaginian", "italic"]);

interface Heirs {
  /** In order: the first is the principal heir, who takes the debts and the house. */
  readonly ids: readonly string[];
  readonly rule: InheritanceRule["kind"];
  readonly reason: string;
}

/**
 * Who inherits, by will or by custom.
 *
 * A will first: an heir named with `heirRef`, or the beneficiaries an authored
 * estate lists. Then the custom of the dead man's people. A Roman's children
 * were his *sui heredes* and shared alike, sons and daughters; a Greek's or a
 * Carthaginian's sons shared before any daughter did. With no child, a wife or
 * husband; with no spouse, the eldest living kinsman. Past that, nobody.
 */
function heirsOf(world: WorldState, deceased: Character, authored: Estate | undefined, atStep: number): Heirs {
  const byAge = (a: Character, b: Character): number =>
    currentAgeYears(b, atStep) - currentAgeYears(a, atStep) || a.id.localeCompare(b.id);
  const find = (id: string): Character | undefined => world.characters.find((character) => character.id === id);

  const named = [deceased.heirCharacterId, ...(authored?.testamentaryBeneficiaryIds ?? [])]
    .filter((id): id is string => id !== null)
    .map(find)
    .filter(canInherit);
  if (named.length > 0) {
    const ids = [...new Set(named.map((character) => character.id))];
    return { ids, rule: "appointment", reason: `${find(ids[0]!)!.name} inherits as the heir ${deceased.name} named.` };
  }

  // An authored estate with a rule of its own keeps it: the scenario said how.
  if (authored !== undefined) {
    const rule = world.material.inheritanceRules.find((candidate) => candidate.id === authored.inheritanceRuleId);
    if (rule !== undefined && rule.kind !== "equal_division") {
      const resolution = resolveBeneficiaries(world, authored, rule, atStep);
      return { ids: resolution.beneficiaryIds.filter((id) => canInherit(find(id))), rule: rule.kind, reason: resolution.reason };
    }
  }

  const children = livingChildren(world, deceased.id).filter(canInherit).sort(byAge);
  const sons = children.filter((child) => child.gender === "male");
  const line = SONS_FIRST.has(deceased.cultureId) && sons.length > 0 ? sons : children;
  if (line.length > 0) {
    return {
      ids: line.map((child) => child.id),
      rule: "equal_division",
      reason: line.length === 1
        ? `${line[0]!.name} inherits as ${deceased.name}'s ${line === sons && children.length > sons.length ? "son" : "child"}.`
        : `${deceased.name}'s ${line === sons && children.length > sons.length ? "sons" : "children"} share the estate, ${line[0]!.name} as the eldest taking the house.`,
    };
  }

  const kin = familyLinksOf(world, deceased.id, atStep);
  const spouse = kin
    .filter((view) => view.kind === "spouse_or_partner")
    .map((view) => find(view.counterpartCharacterId))
    .filter(canInherit)
    .sort(byAge)[0];
  if (spouse !== undefined) return { ids: [spouse.id], rule: "seniority", reason: `${spouse.name} inherits, there being no child.` };

  const senior = kin
    .filter((view) => view.kind === "sibling" || view.kind === "other_relative" || view.kind === "parent" || view.kind === "household_head")
    .map((view) => find(view.counterpartCharacterId))
    .filter(canInherit)
    .sort(byAge)[0];
  if (senior !== undefined) return { ids: [senior.id], rule: "seniority", reason: `${senior.name} inherits as the eldest of the kin.` };

  return { ids: [], rule: "seniority", reason: `${deceased.name} left no heir.` };
}

/** What one heir came away with, for the record and for the choice of who follows. */
export interface EstatePortion {
  readonly beneficiaryId: string;
  readonly coin: number;
  readonly holdingIds: readonly string[];
  readonly ventureIds: readonly string[];
  readonly dependantIds: readonly string[];
  /** Obligations he now pays that the dead man used to. */
  readonly debtIds: readonly string[];
  /** And what he is now owed. */
  readonly creditIds: readonly string[];
}

export interface EstateSettlement {
  readonly world: WorldState;
  readonly estateId: string | null;
  readonly transfers: readonly InheritanceTransfer[];
  /** Principal heir first. */
  readonly beneficiaryIds: readonly string[];
  readonly portions: readonly EstatePortion[];
  readonly reason: string;
  /** Nobody could inherit: the coin went to the state, if there is one, and the rest waits for a claimant. */
  readonly heirless: boolean;
  /** Where the coin went when there was no heir. */
  readonly escheatedToAccountId: string | null;
  readonly coin: number;
}

/**
 * Settles what a dead person owned. Never touches an office: a seat is emptied
 * by `vacateOfficesOf` and filled by its own procedure.
 *
 * - Coin is split alike among the heirs; the principal takes what does not divide.
 * - Land and ventures go round the heirs in turn, eldest first: partible, as
 *   the ancient household was, but a farm is not cut in two.
 * - The income of each follows it to its new holder's purse. What was his by
 *   office or by position -- a salary, a pension -- dies with him.
 * - Debts go to the principal heir where the rule says so; loans he made are
 *   owed to the principal heir.
 * - Slaves and freedmen pass to the principal heir, as patronage did.
 * - His accounts are emptied and locked, so nothing pays into a dead man.
 *
 * With nobody to inherit, the coin and the rents go to his power's treasury
 * and his debts die unpaid; the land stays in his name until someone claims it.
 */
export function settleEstate(world: WorldState, deceasedId: string, atStep: number): EstateSettlement {
  const deceased = world.characters.find((character) => character.id === deceasedId);
  const authored = world.material.estates.find((estate) => estate.ownerCharacterId === deceasedId && estate.status !== "settled" && estate.status !== "escheated");
  const nothing: EstateSettlement = { world, estateId: null, transfers: [], beneficiaryIds: [], portions: [], reason: "", heirless: false, escheatedToAccountId: null, coin: 0 };
  if (deceased === undefined) return nothing;

  const gathered = gatherEstate(world, deceased, authored);
  const heirs = heirsOf(world, deceased, authored, atStep);
  const coin = gathered.accounts.reduce((sum, account) => sum + Math.max(0, account.balance), 0);
  const owesAnything = gathered.holdingIds.length + gathered.ventureIds.length + gathered.dependantIds.length + gathered.debtIds.length + gathered.creditIds.length + gathered.incomeIds.length > 0;
  if (coin === 0 && !owesAnything && authored === undefined) return nothing;

  let material = world.material;
  let characters = world.characters;

  // The rule the settlement went by, kept as a record because a transfer must
  // name an estate and an estate must name a rule.
  const debtsTransfer = authored === undefined
    ? true
    : world.material.inheritanceRules.find((rule) => rule.id === authored.inheritanceRuleId)?.debtsTransfer ?? true;
  const ruleId = authored?.inheritanceRuleId ?? `customary-${heirs.rule}`;
  if (!material.inheritanceRules.some((rule) => rule.id === ruleId)) {
    material = { ...material, inheritanceRules: [...material.inheritanceRules, { id: ruleId, kind: heirs.rule, institutionId: null, debtsTransfer: true }] };
  }
  const estateId = authored?.id ?? boundedId(deceasedId, "estate", atStep);
  const heirless = heirs.ids.length === 0;
  const status = heirless ? "escheated" as const : "settled" as const;
  material = authored === undefined
    ? {
      ...material,
      estates: [...material.estates, {
        id: estateId,
        ownerCharacterId: deceasedId,
        accountIds: gathered.accounts.map((account) => account.id),
        holdingIds: [...gathered.holdingIds],
        obligationIds: [...gathered.debtIds],
        inheritanceRuleId: ruleId,
        testamentaryBeneficiaryIds: deceased.heirCharacterId === null ? [] : [deceased.heirCharacterId],
        status,
        settledAtStep: atStep,
      }],
    }
    : { ...material, estates: material.estates.map((estate) => (estate.id === estateId ? { ...estate, status, settledAtStep: atStep } : estate)) };

  const transfers: InheritanceTransfer[] = [];
  const transfer = (assetKind: InheritanceTransfer["assetKind"], assetId: string, beneficiaryId: string | null, reason: string): void => {
    transfers.push({
      id: boundedId(estateId, "transfer", assetKind, assetId, beneficiaryId ?? "none"),
      estateId, deceasedCharacterId: deceasedId, beneficiaryCharacterId: beneficiaryId,
      assetKind, assetId, reason: reason.slice(0, 240), resolvedAtStep: atStep, sourceEventId: null,
    });
  };
  const personOf = (id: string): Character => world.characters.find((character) => character.id === id)!;
  const purseOf = (id: string): string => personOf(id).personalAccountId;
  const principal = heirs.ids[0] ?? null;
  const treasury = heirless && deceased.polityId !== null
    ? material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === deceased.polityId && account.status === "active")?.id ?? null
    : null;
  const portions = new Map(heirs.ids.map((id) => [id, { beneficiaryId: id, coin: 0, holdingIds: [] as string[], ventureIds: [] as string[], dependantIds: [] as string[], debtIds: [] as string[], creditIds: [] as string[] }]));

  // ── Coin ────────────────────────────────────────────────────────────────
  const deadAccounts = new Set(gathered.accounts.map((account) => account.id));
  const credits = new Map<string, number>();
  const transactions: MoneyTransaction[] = [];
  for (const account of gathered.accounts) {
    if (account.balance <= 0) continue;
    if (heirless) {
      if (treasury === null) {
        transfer("account_balance", account.id, null, "Escheated: no heir, and no treasury to take it.");
        continue;
      }
      transactions.push({
        id: boundedId(estateId, "transaction", account.id, "escheat"), atStep, kind: "inheritance", amount: account.balance,
        sourceAccountId: account.id, destinationAccountId: treasury,
        cause: { kind: "succession", id: estateId, explanation: `${deceased.name} left no heir; the estate fell to the state.` },
        visibility: "polity",
      });
      credits.set(treasury, (credits.get(treasury) ?? 0) + account.balance);
      transfer("account_balance", account.id, null, "Escheated to the state: no heir.");
      continue;
    }
    const share = Math.floor(account.balance / heirs.ids.length);
    heirs.ids.forEach((beneficiaryId, index) => {
      const amount = index === 0 ? account.balance - share * (heirs.ids.length - 1) : share;
      if (amount <= 0) return;
      const destination = purseOf(beneficiaryId);
      transactions.push({
        id: boundedId(estateId, "transaction", account.id, beneficiaryId), atStep, kind: "inheritance", amount,
        sourceAccountId: account.id, destinationAccountId: destination,
        cause: { kind: "succession", id: estateId, explanation: heirs.reason },
        visibility: "polity",
      });
      credits.set(destination, (credits.get(destination) ?? 0) + amount);
      portions.get(beneficiaryId)!.coin += amount;
      transfer("account_balance", account.id, beneficiaryId, heirs.reason);
    });
  }
  // Emptied only where the coin had somewhere to go: an heirless man with no
  // treasury behind him keeps his balance, locked, for whoever claims it.
  const emptied = heirless && treasury === null ? new Set<string>() : deadAccounts;
  material = {
    ...material,
    transactions: [...material.transactions, ...transactions],
    accounts: material.accounts.map((account) => {
      if (deadAccounts.has(account.id)) return { ...account, balance: emptied.has(account.id) ? 0 : account.balance, status: "locked" as const };
      const incoming = credits.get(account.id);
      return incoming === undefined ? account : { ...account, balance: account.balance + incoming };
    }),
  };

  // ── Land and ventures, in turn ──────────────────────────────────────────
  const newHolderOf = new Map<string, string>();
  let turn = 0;
  const nextHeir = (): string | null => (principal === null ? null : heirs.ids[(turn++) % heirs.ids.length]!);
  for (const holdingId of gathered.holdingIds) {
    const to = nextHeir();
    if (to === null) {
      transfer("holding", holdingId, null, "Unclaimed: it stays in the dead man's name until somebody makes good a claim.");
      continue;
    }
    newHolderOf.set(`holding:${holdingId}`, to);
    portions.get(to)!.holdingIds.push(holdingId);
    transfer("holding", holdingId, to, heirs.reason);
  }
  for (const ventureId of gathered.ventureIds) {
    const to = nextHeir();
    if (to === null) {
      transfer("venture", ventureId, null, "Wound up: nobody inherited it.");
      continue;
    }
    newHolderOf.set(`venture:${ventureId}`, to);
    portions.get(to)!.ventureIds.push(ventureId);
    transfer("venture", ventureId, to, heirs.reason);
  }
  material = {
    ...material,
    holdings: material.holdings.map((holding) => {
      const to = newHolderOf.get(`holding:${holding.id}`);
      return to === undefined ? holding : { ...holding, legalHolderCharacterId: to };
    }),
    ventures: material.ventures.map((venture) => {
      if (!gathered.ventureIds.includes(venture.id)) return venture;
      const to = newHolderOf.get(`venture:${venture.id}`);
      return to === undefined ? { ...venture, status: "closed" as const } : { ...venture, ownerCharacterId: to };
    }),
  };

  // ── What it all paid into ───────────────────────────────────────────────
  const income = new Set(gathered.incomeIds);
  material = {
    ...material,
    incomeSources: material.incomeSources.map((source) => {
      if (!income.has(source.id)) return source;
      const follows = source.originKind === "holding" || source.originKind === "venture"
        ? newHolderOf.get(`${source.originKind}:${source.originId}`) ?? null
        : null;
      if (follows !== null) {
        transfer("income", source.id, follows, `${source.label} now pays ${personOf(follows).name}.`);
        return { ...source, beneficiaryAccountId: purseOf(follows) };
      }
      // An heirless man's rents are the state's until his land is claimed.
      if (heirless && treasury !== null && source.originKind === "holding") {
        transfer("income", source.id, null, `${source.label} is paid to the state until the land is claimed.`);
        return { ...source, beneficiaryAccountId: treasury };
      }
      transfer("income", source.id, null, `${source.label} died with ${deceased.name}.`);
      return { ...source, active: false };
    }),
  };

  // ── Debts, and what he was owed ─────────────────────────────────────────
  const debts = new Set(gathered.debtIds);
  const owedHim = new Set(gathered.creditIds);
  material = {
    ...material,
    obligations: material.obligations.map((obligation) => {
      if (debts.has(obligation.id)) {
        if (principal !== null && debtsTransfer) {
          portions.get(principal)!.debtIds.push(obligation.id);
          transfer("obligation", obligation.id, principal, "The debt passes to the heir with the estate.");
          return { ...obligation, payerAccountId: purseOf(principal) };
        }
        transfer("obligation", obligation.id, null, heirless ? "The debt dies with him: there is no heir to pay it." : "The obligation is forgiven on death.");
        return { ...obligation, active: false };
      }
      if (owedHim.has(obligation.id)) {
        if (obligation.kind === "debt_service" && principal !== null) {
          portions.get(principal)!.creditIds.push(obligation.id);
          transfer("obligation", obligation.id, principal, "What was owed him is owed to his heir.");
          return { ...obligation, recipientAccountId: purseOf(principal) };
        }
        if (obligation.kind === "debt_service" && treasury !== null) {
          transfer("obligation", obligation.id, null, "What was owed him is owed to the state.");
          return { ...obligation, recipientAccountId: treasury };
        }
        transfer("obligation", obligation.id, null, `${obligation.label} ends with him.`);
        return { ...obligation, active: false };
      }
      return obligation;
    }),
  };

  // ── His people ──────────────────────────────────────────────────────────
  if (principal !== null && gathered.dependantIds.length > 0) {
    const dependants = new Set(gathered.dependantIds);
    characters = characters.map((character) => (dependants.has(character.id) ? { ...character, ownerCharacterId: principal } : character));
    for (const id of gathered.dependantIds) {
      portions.get(principal)!.dependantIds.push(id);
      transfer("dependant", id, principal, personOf(id).legalStatus === "enslaved" ? "A slave of the household passes to the heir." : "The patronage of a freedman passes to the heir.");
    }
  }

  material = { ...material, inheritanceTransfers: [...material.inheritanceTransfers, ...transfers] };
  return {
    world: { ...world, material, characters },
    estateId,
    transfers,
    beneficiaryIds: heirs.ids,
    portions: [...portions.values()],
    reason: heirs.reason,
    heirless,
    escheatedToAccountId: treasury,
    coin,
  };
}

/** What `beneficiaryId` came away with from `deceasedId`'s estate, read back from the record. */
export function portionFrom(world: WorldState, deceasedId: string, beneficiaryId: string): EstatePortion | null {
  const estate = [...world.material.estates].reverse().find((candidate) => candidate.ownerCharacterId === deceasedId && candidate.settledAtStep !== null);
  if (estate === undefined) return null;
  const mine = world.material.inheritanceTransfers.filter((transfer) => transfer.estateId === estate.id && transfer.beneficiaryCharacterId === beneficiaryId);
  if (mine.length === 0) return null;
  const purse = world.characters.find((character) => character.id === beneficiaryId)?.personalAccountId;
  const coin = world.material.transactions
    .filter((transaction) => transaction.kind === "inheritance" && transaction.cause.id === estate.id && transaction.destinationAccountId === purse)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const of = (kind: InheritanceTransfer["assetKind"]): string[] => mine.filter((transfer) => transfer.assetKind === kind).map((transfer) => transfer.assetId);
  const obligations = new Map(world.material.obligations.map((obligation) => [obligation.id, obligation]));
  return {
    beneficiaryId,
    coin,
    holdingIds: of("holding"),
    ventureIds: of("venture"),
    dependantIds: of("dependant"),
    debtIds: of("obligation").filter((id) => obligations.get(id)?.payerAccountId === purse),
    creditIds: of("obligation").filter((id) => obligations.get(id)?.recipientAccountId === purse),
  };
}

// ---------------------------------------------------------------------------
// Legacy causes: bounded, deterministic public-standing transfer.
// ---------------------------------------------------------------------------

const LEGACY_SCORE_FACTOR = 0.5;
/** An opinion this strong is inherited from outside the heir's own power and family. */
const STRONG_FEELING = 20;
const LEGACY_DECAY_PER_YEAR_BPS = 4_000;

/**
 * Bounded, deterministic reputation transfer: at most `maxCauses` living
 * characters who hold a relation toward the predecessor **and** are in the
 * successor's polity, family-linked to them, or feel strongly enough that a
 * border does not matter -- not an unrestricted cascade. Private beliefs/plots are never touched; this
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
  const predecessorName = world.characters.find((c) => c.id === predecessorId)?.name ?? "the dead";
  const familyOfSuccessor = new Set(familyLinksOf(world, successorId).map((view) => view.counterpartCharacterId));

  const candidates = world.characters
    .filter((c) => c.alive && c.id !== predecessorId && c.id !== successorId)
    .map((holder) => ({ holder, score: computeOpinion(holder, predecessorId) }))
    // A feeling strong enough crosses borders: the Carthaginian whose fleet the
    // father burned is the son's enemy too.
    .filter(({ score, holder }) => score !== 0 && (holder.polityId === successor.polityId || familyOfSuccessor.has(holder.id) || Math.abs(score) >= STRONG_FEELING))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || stableChoice([a.holder.id, b.holder.id, "legacy-tie"], 2) - 0.5)
    .slice(0, maxCauses);

  return candidates.map(({ holder, score }) => ({
    holderCharacterId: holder.id,
    successorCharacterId: successorId,
    predecessorCharacterId: predecessorId,
    cause: {
      id: boundedId(predecessorId, "legacy", holder.id, atStep),
      label: score > 0
        ? `Heir to ${predecessorName}, whom they held dear`
        : `Heir to ${predecessorName}, whom they had cause to hate`,
      score: Math.round(score * LEGACY_SCORE_FACTOR),
      occurredAtStep: atStep,
      decayPerYearBps: LEGACY_DECAY_PER_YEAR_BPS,
      encounterMemoryId: null,
    },
  }));
}

/**
 * The house's friends and enemies, carried over to whoever takes it up.
 *
 * `deriveLegacyCauses` has always said who would feel what about the heir,
 * and nothing ever wrote it anywhere: the son of the man who burned your
 * farm was a stranger to you. Written into each holder's relation toward the
 * successor, once per predecessor and successor, and kept in
 * `legacyCauses` so the inspector can say where a grudge came from.
 */
export function applyLegacy(world: WorldState, predecessorId: string, successorId: string, atStep: number): WorldState {
  if (world.legacyCauses.some((entry) => entry.predecessorCharacterId === predecessorId && entry.successorCharacterId === successorId)) return world;
  const legacy = deriveLegacyCauses(world, predecessorId, successorId, atStep);
  if (legacy.length === 0) return world;
  const byHolder = new Map(legacy.map((entry) => [entry.holderCharacterId, entry]));
  return {
    ...world,
    legacyCauses: [...world.legacyCauses, ...legacy],
    characters: world.characters.map((character) => {
      const entry = byHolder.get(character.id);
      if (entry === undefined) return character;
      const existing = character.relations.find((relation) => relation.subjectCharacterId === successorId);
      const relations = existing === undefined
        ? [...character.relations, { subjectCharacterId: successorId, causes: [entry.cause] }]
        : character.relations.map((relation) => (relation === existing ? { ...relation, causes: [...relation.causes, entry.cause] } : relation));
      return { ...character, relations };
    }),
  };
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
