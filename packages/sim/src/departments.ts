import {
  activeDepartments,
  allOffices,
  bandForSkill,
  boundedId as mintId,
  computeOpinion,
  diversionShare,
  expectedPay,
  greedOf,
  OFFICIAL_REACH_KM,
  REFERENCE_PROVINCE_KM,
  kmBetween,
  readDepartments,
  aptitude,
  stableHash,
  type Character,
  type Diversion,
  type DepartmentScope,
  type MoneyTransaction,
  type PostRole,
  boundedId,
  formingDays,
  leverDefinition,
  leversNamedBy,
  labelFromCategoryId,
  warsOf,
  type Department,
  type Enactment,
  type FactProposalDraft,
  type LeverId,
  type Office,
  type StandingEffect,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * The passage of time for departments (docs/plans/departments.md §3, §4).
 *
 * A department that has formed takes its levers from whoever had them -- an
 * older department of the same power, or the ruler, who simply stops holding
 * what somebody else now does. One that has people in it learns: a day's
 * experience for every day, which `readDepartments` reads as a point a year.
 * A department with nobody in it learns nothing while it stands empty.
 */
export interface KeepDepartmentsResult {
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
}

export function keepDepartments(world: WorldState, toDay: number, before?: WorldState): KeepDepartmentsResult {
  const money = before === undefined ? { world, facts: [] as FactProposalDraft[] } : settleMoney(world, toDay, before);
  const audited = resolveAudits(money.world, toDay);
  const settled = { world: audited.world, facts: [...money.facts, ...audited.facts] };
  world = settled.world;
  const departments = activeDepartments(world);
  if (departments.length === 0) return settled;

  const held = new Set(world.material.officeSeats.filter((seat) => seat.status === "held" && seat.holderCharacterId !== null).map((seat) => seat.officeId));
  const staffed = (department: Department): boolean =>
    department.officeIds.some((officeId) => held.has(officeId)) || (department.headOfficeId !== null && held.has(department.headOfficeId));

  const facts: FactProposalDraft[] = [...settled.facts];
  const formedNow = departments.filter((department) => department.formsAtStep <= toDay && (department.countedAtStep === null || department.countedAtStep < department.formsAtStep));

  let next = (world.departments ?? []).map((department) => {
    if (department.abolishedAtStep !== null || department.formsAtStep > toDay) return department;
    const from = Math.max(department.countedAtStep ?? department.formsAtStep, department.formsAtStep);
    const gained = staffed(department) ? Math.max(0, toDay - from) : 0;
    return { ...department, experienceDays: department.experienceDays + gained, countedAtStep: toDay };
  });

  // A department that has formed takes its levers: they are struck off every
  // older department of the same power, which keeps whatever else it had.
  for (const formed of formedNow) {
    // A department the world opened with was always there: nothing to tell.
    const told = formed.origin !== "scenario";
    next = next.map((department) => {
      if (department.id === formed.id || department.abolishedAtStep !== null) return department;
      if (department.scope.kind !== formed.scope.kind || department.scope.id !== formed.scope.id) return department;
      const kept = department.levers.filter((lever) => !formed.levers.includes(lever));
      return kept.length === department.levers.length ? department : { ...department, levers: kept };
    });
    if (!told) continue;
    const work = formed.levers.map((lever) => leverDefinition(lever).words);
    facts.push({
      localId: `department_formed_${formed.id}`,
      kind: "government",
      summary: `${formed.name} has been organised and takes charge of ${work.length === 0 ? "its work" : work.join(", ")}.`.slice(0, 400),
      affectedRefs: [formed.scope.kind === "polity" ? { kind: "polity", id: formed.scope.id } : { kind: "character", id: formed.scope.id }],
      visibility: formed.scope.kind === "polity" ? "polity" : "private",
      discoveryState: formed.scope.kind === "polity" ? "polity" : "private",
      knowableInDays: 0,
      significance: 35,
    });
  }

  // What a department does that no lever says, at the strength its people
  // manage -- a steward's gift for administration -- and nothing while it
  // stands empty.
  const living = new Map(world.characters.filter((character) => character.alive).map((character) => [character.id, character]));
  const byEntity = new Map(next.filter((department) => department.abolishedAtStep === null && department.standingEntityId !== null && department.formsAtStep <= toDay).map((department) => [department.standingEntityId!, department]));
  const genericEntities = byEntity.size === 0 ? world.genericEntities : world.genericEntities.map((entity) => {
    const department = byEntity.get(entity.id);
    if (department === undefined) return entity;
    const people = world.material.officeSeats
      .filter((seat) => seat.status === "held" && seat.holderCharacterId !== null && (department.officeIds.includes(seat.officeId) || seat.officeId === department.headOfficeId))
      .map((seat) => living.get(seat.holderCharacterId!))
      .filter((person): person is NonNullable<typeof person> => person !== undefined);
    const band = bandForSkill(people.length === 0 ? null : people.reduce((sum, person) => sum + person.skills.stewardship, 0) / people.length);
    return { ...entity, effects: band === null ? [] : department.effects.map((effect) => ({ ...effect, band })) };
  });

  return { world: { ...world, departments: next, genericEntities }, facts };
}

// ── Founding, reforming, abolishing ─────────────────────────────────────────

/** What a department does when neither its levers nor its law say anything: the people's favour, a little. */
const FLOOR_EFFECT: StandingEffect = { quantity: "stability", direction: "raise", band: "slight", scope: "realm" };

type DepartmentMeasure = NonNullable<Enactment["department"]>;

/**
 * A department founded, reformed or abolished by a measure carried
 * (docs/plans/departments.md §4). Never refused: a department whose measure
 * named no lever is given what its name plainly says, and one whose name says
 * nothing the engine computes goes on doing the one thing every office of
 * state does, a little -- so no department is a name with nothing behind it.
 */
export function carryOutDepartment(
  world: WorldState,
  polityId: string,
  measure: DepartmentMeasure,
  atStep: number,
  ids: IdFactory,
  scenarioOffices: readonly Office[],
  sponsorCharacterId: string | null,
  title: string,
): { world: WorldState; said: string[] } {
  const existing = measure.departmentId === null ? undefined : world.departments.find((department) => department.id === measure.departmentId);
  const said: string[] = [];
  let next = world;

  if (measure.abolish) {
    if (existing === undefined || existing.abolishedAtStep !== null) return { world, said };
    next = {
      ...next,
      departments: next.departments.map((department) => (department.id === existing.id ? { ...department, abolishedAtStep: atStep } : department)),
      genericEntities: existing.standingEntityId === null ? next.genericEntities : next.genericEntities.filter((entity) => entity.id !== existing.standingEntityId),
    };
    said.push(`${existing.name} is abolished, and its work goes back to ${polityRulerWords(next, polityId)}`);
    return { world: recordInConstitution(next, polityId, atStep, `${existing.name} abolished (${title})`, sponsorCharacterId), said };
  }

  // Its offices: named ones kept, new ones made with an empty seat each.
  const known = allOffices(next, scenarioOffices);
  const madeOffices: string[] = [];
  for (const wanted of measure.offices) {
    if (known.some((office) => office.id === wanted.officeId)) continue;
    const label = wanted.officeLabel ?? labelFromCategoryId(wanted.officeId);
    const office: Office = {
      id: wanted.officeId,
      label,
      polityId,
      authorisedActionIds: [],
      sponsorableCategories: [],
      treasuryAccountId: null,
      treasuryPermissions: [],
      incomeSourceId: null,
      expectedBlocId: null,
      successionRuleId: "appointed-by-the-government",
      eligibilityRequirementIds: [],
    };
    const seats = Array.from({ length: wanted.seats ?? 1 }, (_, index) => ({
      id: boundedId(office.id, "seat", index),
      officeId: office.id,
      seatIndex: index,
      holderCharacterId: null,
      status: "vacant" as const,
      vacancyCause: "never_filled" as const,
      termStartedAtStep: null,
      termExpiresAtStep: null,
      appointmentProcedureId: null,
      removalProcedureId: null,
      eligibilityRequirementIds: [],
    }));
    next = { ...next, offices: [...next.offices, office], material: { ...next.material, officeSeats: [...next.material.officeSeats, ...seats] } };
    madeOffices.push(label);
  }

  const name = measure.name ?? existing?.name ?? title;
  const named = measure.levers ?? existing?.levers ?? [];
  const levers: LeverId[] = named.length > 0 || measure.effects.length > 0 || (existing?.standingEntityId ?? null) !== null
    ? [...named]
    : leversNamedBy(name);
  const effects = measure.effects.length > 0 ? measure.effects : levers.length === 0 && existing?.standingEntityId == null ? [FLOOR_EFFECT] : [];

  const officeIds = measure.offices.filter((office) => office.role !== "deputy").map((office) => office.officeId);
  const headOfficeId = measure.offices.find((office) => office.role === "head")?.officeId ?? null;
  const deputyOfficeIds = measure.offices.filter((office) => office.role === "deputy").map((office) => office.officeId);

  // What no lever says, as an arrangement doing it -- weak or strong as the
  // department's people are able (`keepDepartments`).
  let standingEntityId = existing?.standingEntityId ?? null;
  if (effects.length > 0) {
    const entityId = standingEntityId ?? ids.next("entity");
    const entity = {
      id: entityId,
      kind: "department",
      label: name.slice(0, 160),
      ownerRef: { kind: "polity" as const, id: polityId },
      attributes: {},
      linkedEntityIds: [],
      createdAtStep: atStep,
      provenanceEventIds: [],
      provinceId: null,
      effects: effects.map((effect) => ({ ...effect, scope: "realm" as const })),
    };
    next = { ...next, genericEntities: [...next.genericEntities.filter((candidate) => candidate.id !== entityId), entity] };
    standingEntityId = entityId;
  }

  const atWar = warsOf(next.polityAgreements, polityId).length > 0;
  if (existing === undefined) {
    const department: Department = {
      id: ids.next("department"),
      scope: { kind: "polity", id: polityId },
      name,
      levers,
      officeIds: officeIds.length > 0 ? officeIds : headOfficeId === null ? [] : [headOfficeId],
      headOfficeId,
      deputyOfficeIds,
      pay: measure.pay ?? "honorary",
      foundedAtStep: atStep,
      formsAtStep: atStep + formingDays(levers.length, atWar),
      experienceDays: 0,
      countedAtStep: null,
      mechanicRuleId: null,
      standingEntityId,
      effects,
      budgetPerMonth: 0,
      rumouredAtStep: null,
      gates: [],
      origin: "order",
      abolishedAtStep: null,
    };
    next = { ...next, departments: [...next.departments, department] };
    const work = levers.map((lever) => leverDefinition(lever).words);
    said.push(`${name} is founded${work.length === 0 ? "" : `, to take charge of ${work.join(", ")}`}, once it has been organised${madeOffices.length === 0 ? "" : `, with the new office${madeOffices.length === 1 ? "" : "s"} of ${madeOffices.join(" and ")}`}`);
  } else {
    // A reform takes effect the day it is carried: whatever it now holds is
    // struck off whichever department held it before.
    const added = levers.filter((lever) => !existing.levers.includes(lever));
    next = {
      ...next,
      departments: next.departments.map((department) => {
        if (department.id === existing.id) {
          return {
            ...department,
            name,
            levers,
            ...(measure.offices.length === 0 ? {} : { officeIds, headOfficeId, deputyOfficeIds }),
            ...(measure.pay === null ? {} : { pay: measure.pay }),
            standingEntityId,
            ...(effects.length === 0 ? {} : { effects }),
          };
        }
        if (department.abolishedAtStep !== null || department.scope.kind !== "polity" || department.scope.id !== polityId) return department;
        const kept = department.levers.filter((lever) => !added.includes(lever));
        return kept.length === department.levers.length ? department : { ...department, levers: kept };
      }),
    };
    said.push(`${name} is reformed`);
  }
  return { world: recordInConstitution(next, polityId, atStep, `${name}: ${existing === undefined ? "founded" : "reformed"} (${title})`, sponsorCharacterId), said };
}

function polityRulerWords(world: WorldState, polityId: string): string {
  return world.constitutions.some((constitution) => constitution.polityId === polityId && constitution.rulerOfficeId !== null) ? "the head of state" : "whoever governs";
}

/** A department is a part of the constitution: its founding and its end are in the constitution's history. */
function recordInConstitution(world: WorldState, polityId: string, atStep: number, summary: string, byCharacterId: string | null): WorldState {
  return {
    ...world,
    constitutions: world.constitutions.map((constitution) => (constitution.polityId !== polityId ? constitution : {
      ...constitution,
      history: [...constitution.history, {
        atStep, origin: "reform" as const, fromForm: constitution.form, toForm: constitution.form, summary: summary.slice(0, 400), byCharacterId,
      }].slice(-24),
    })),
  };
}

// ── Pay and graft, month by month (§7b, §9) ─────────────────────────────────

/** Past this share of the take gone missing in a span, men start to say so. */
const RUMOUR_SHARE = 0.05;
const RUMOUR_EVERY_DAYS = 180;
/** A man sends what he takes to his patron, rather than keeping it, when he owes him this much and wants money this little. */
const PATRON_OPINION = 60;
const PATRON_WEALTH_DRIVE = 50;
const DAYS_PER_MONTH = 30;

interface Post { readonly person: Character; readonly role: PostRole }

function postsOf(world: WorldState, department: Department): Post[] {
  const living = new Map(world.characters.filter((character) => character.alive).map((character) => [character.id, character]));
  const posts = new Map<string, Post>();
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    const person = living.get(seat.holderCharacterId);
    if (person === undefined) continue;
    const role: PostRole | null = seat.officeId === department.headOfficeId ? "head"
      : department.officeIds.includes(seat.officeId) ? "officer"
        : department.deputyOfficeIds.includes(seat.officeId) ? "deputy" : null;
    if (role === null) continue;
    const known = posts.get(person.id);
    if (known === undefined || (known.role !== "head" && role === "head")) posts.set(person.id, { person, role });
  }
  return [...posts.values()];
}

/** Where a man sends what he takes: his own purse, or his patron's. */
function destinationFor(world: WorldState, person: Character): string {
  if (person.mind.drives.wealth >= PATRON_WEALTH_DRIVE) return person.personalAccountId;
  let patron: Character | null = null;
  let best = PATRON_OPINION - 1;
  for (const relation of person.relations) {
    const opinion = computeOpinion(person, relation.subjectCharacterId);
    if (opinion <= best) continue;
    const candidate = world.characters.find((character) => character.id === relation.subjectCharacterId && character.alive);
    if (candidate === undefined) continue;
    patron = candidate;
    best = opinion;
  }
  return patron?.personalAccountId ?? person.personalAccountId;
}

/** How far a man is from his power's capital, in reference provinces of road, at most eight. */
function remotenessFrom(world: WorldState, person: Character, polityId: string | null): number {
  const capital = polityId === null ? null : world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
  const capitalProvince = capital === null ? null : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id ?? null;
  if (capitalProvince === null || capitalProvince === person.locationProvinceId) return 0;
  return (kmBetween(world, person.locationProvinceId, capitalProvince, OFFICIAL_REACH_KM) ?? OFFICIAL_REACH_KM) / REFERENCE_PROVINCE_KM;
}

/**
 * What a department's people are paid, and what they take, for what passed
 * through their hands since the last settling. Money moves as transactions,
 * and what was taken is written down where an audit can find it -- the
 * treasury is short by exactly what somebody's purse is long.
 */
function settleMoney(world: WorldState, toDay: number, before: WorldState): { world: WorldState; facts: FactProposalDraft[] } {
  const earlier = new Set(before.material.transactions.map((transaction) => transaction.id));
  const fresh = world.material.transactions.filter((transaction) => !earlier.has(transaction.id));
  const facts: FactProposalDraft[] = [];
  let accounts = world.material.accounts;
  const transactions: MoneyTransaction[] = [];
  let diversions = [...world.diversions];
  const balance = (accountId: string): number => accounts.find((account) => account.id === accountId)?.balance ?? 0;
  const move = (from: string, to: string, amount: number, kind: "salary" | "diversion", departmentId: string, explanation: string): number => {
    const paid = Math.min(amount, Math.max(0, balance(from)));
    if (paid <= 0 || from === to) return 0;
    accounts = accounts.map((account) => (account.id === from ? { ...account, balance: account.balance - paid } : account.id === to ? { ...account, balance: account.balance + paid } : account));
    transactions.push({
      id: mintId("txn", kind, departmentId, to, toDay),
      atStep: toDay, kind, amount: paid, sourceAccountId: from, destinationAccountId: to,
      cause: { kind: "department", id: departmentId, explanation: explanation.slice(0, 200) },
      visibility: kind === "diversion" ? "private" : "polity",
    });
    return paid;
  };
  const noteDiversion = (person: Character, scope: DepartmentScope, departmentId: string | null, amount: number, toAccountId: string): void => {
    const index = diversions.findIndex((row) => row.byCharacterId === person.id && row.departmentId === departmentId && row.scope.id === scope.id && row.foundAtStep === null);
    if (index >= 0) {
      const row = diversions[index]!;
      diversions[index] = { ...row, amount: row.amount + amount, lastAtStep: toDay, toAccountId };
      return;
    }
    const row: Diversion = { id: mintId("diversion", person.id, scope.id, departmentId ?? "household", toDay), byCharacterId: person.id, scope, departmentId, amount, toAccountId, firstAtStep: toDay, lastAtStep: toDay, foundAtStep: null };
    diversions = [...diversions, row].slice(-600);
  };

  const reader = readDepartments(world);
  const polityAccount = (polityId: string): string | null => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)?.id ?? null;

  const departments = world.departments.map((department) => {
    if (department.abolishedAtStep !== null || department.formsAtStep > toDay || department.scope.kind !== "polity") return department;
    const polityId = department.scope.id;
    const treasury = polityAccount(polityId);
    const holdsTaxes = reader.holding(department.scope, "tax_roll").department?.id === department.id;
    // What came in through its hands since it was last settled.
    const polityAccounts = new Set(world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polityId).map((account) => account.id));
    const collected = holdsTaxes ? fresh.filter((transaction) => transaction.kind === "tax" && transaction.destinationAccountId !== undefined && polityAccounts.has(transaction.destinationAccountId)).reduce((sum, transaction) => sum + transaction.amount, 0) : 0;
    const span = Math.max(0, toDay - Math.max(department.countedAtStep ?? department.formsAtStep, department.formsAtStep));
    const monthly = span === 0 ? department.budgetPerMonth : Math.round((collected * DAYS_PER_MONTH) / span);
    const budgetPerMonth = span === 0 ? department.budgetPerMonth : Math.max(0, Math.round(department.budgetPerMonth + (monthly - department.budgetPerMonth) * Math.min(1, span / 90)));
    if (treasury === null || span === 0) return { ...department, budgetPerMonth };

    const posts = postsOf(world, department);
    const paidShare = new Map<string, number>();
    for (const post of posts) {
      const expected = expectedPay(post.role, budgetPerMonth);
      if (department.pay !== "salaried") { paidShare.set(post.person.id, 0); continue; }
      const owed = Math.round((expected * span) / DAYS_PER_MONTH);
      const paid = move(treasury, post.person.personalAccountId, owed, "salary", department.id, `${post.person.name}'s pay as of ${department.name}`);
      paidShare.set(post.person.id, owed === 0 ? 1 : paid / owed);
    }

    // What its officers take of what passed through their hands. Honest
    // colleagues stop some of it: half the share of them that are.
    let diverted = 0;
    const working = posts.filter((post) => post.role !== "deputy");
    if (collected > 0 && working.length > 0) {
      const honest = working.filter((post) => greedOf(post.person) < 25).length / working.length;
      for (const post of working) {
        const share = diversionShare(greedOf(post.person), paidShare.get(post.person.id) ?? 0, remotenessFrom(world, post.person, polityId));
        const take = Math.floor((collected / working.length) * share * (1 - honest / 2));
        if (take <= 0) continue;
        const to = destinationFor(world, post.person);
        const moved = move(treasury, to, take, "diversion", department.id, `What ${post.person.name} kept back from ${department.name}`);
        if (moved > 0) { noteDiversion(post.person, department.scope, department.id, moved, to); diverted += moved; }
      }
    }

    let rumouredAtStep = department.rumouredAtStep;
    if (diverted > 0 && diverted >= collected * RUMOUR_SHARE && (rumouredAtStep === null || toDay - rumouredAtStep >= RUMOUR_EVERY_DAYS)) {
      rumouredAtStep = toDay;
      facts.push({
        localId: `department_short_${department.id}_${toDay}`.slice(0, 60),
        kind: "government",
        summary: `Men say less reaches ${department.name} than the rolls promise.`,
        affectedRefs: [{ kind: "polity", id: polityId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 30,
        significance: 30,
      });
    }
    return { ...department, budgetPerMonth, rumouredAtStep };
  });

  // A household's stewards and agents, on what its land and trade paid in.
  const sourceKind = new Map(world.material.incomeSources.map((source) => [source.id, source.originKind]));
  for (const contract of world.material.contracts) {
    if (contract.status !== "active" || (contract.role !== "steward" && contract.role !== "agent")) continue;
    const hand = world.characters.find((character) => character.id === contract.employeeCharacterId && character.alive);
    const ownerId = world.material.accounts.find((account) => account.id === contract.employerAccountId)?.owner;
    if (hand === undefined || ownerId?.kind !== "character") continue;
    const runs = (kind: string | undefined): boolean => kind === "venture" || (contract.role === "steward" && kind === "holding");
    const income = fresh.filter((transaction) => transaction.destinationAccountId === contract.employerAccountId && transaction.cause.kind === "scheduled_income" && runs(sourceKind.get(transaction.cause.id)));
    const collected = income.reduce((sum, transaction) => sum + transaction.amount, 0);
    if (collected <= 0) continue;
    const owner = world.characters.find((character) => character.id === ownerId.id);
    const paidShare = contract.monthlyPay / Math.max(1, expectedPay("head", collected));
    const take = Math.floor(collected * diversionShare(greedOf(hand), paidShare, owner === undefined ? 0 : remotenessFrom(world, hand, owner.polityId)));
    if (take <= 0) continue;
    const to = destinationFor(world, hand);
    const moved = move(contract.employerAccountId, to, take, "diversion", contract.id, `What ${hand.name} kept back from his master's estates`);
    if (moved > 0) noteDiversion(hand, { kind: "household", id: ownerId.id }, null, moved, to);
  }

  if (transactions.length === 0 && departments.every((department, index) => department === world.departments[index])) return { world, facts };
  return {
    world: { ...world, departments, diversions, material: { ...world.material, accounts, transactions: [...world.material.transactions, ...transactions] } },
    facts,
  };
}

// ── Audits (§9) ─────────────────────────────────────────────────────────────

const AUDIT_FLOOR = 0.1;
const AUDIT_CEILING = 0.9;

/**
 * Audits whose day has come. Each man who took from the books gone through is
 * found, or not, on the auditor's eye against his care in hiding it: the
 * auditor's gift for the tax roll and for finding things out, against the
 * thief's wits and his way with people; better under a good head of audits,
 * worse the farther away the thief was working.
 */
export function resolveAudits(world: WorldState, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  const due = world.audits.filter((audit) => audit.status === "under_way" && audit.dueAtStep <= toDay);
  if (due.length === 0) return { world, facts: [] };
  const reader = readDepartments(world);
  const facts: FactProposalDraft[] = [];
  let diversions = world.diversions;
  const audits = world.audits.map((audit) => {
    if (!due.includes(audit)) return audit;
    const auditor = world.characters.find((character) => character.id === audit.auditorCharacterId);
    const department = audit.departmentId === null ? undefined : world.departments.find((candidate) => candidate.id === audit.departmentId);
    const books = department?.name ?? `${world.characters.find((character) => character.id === audit.scope.id)?.name ?? "a man"}'s estates`;
    const told = [...new Set([audit.orderedByCharacterId, audit.auditorCharacterId])].map((id) => ({ kind: "character" as const, id }));
    if (auditor === undefined || !auditor.alive) return { ...audit, status: "cleared" as const };
    const eye = (aptitude(auditor, "taxation") + aptitude(auditor, "espionage")) / 2;
    const lift = audit.scope.kind === "polity" ? reader.headLift(audit.scope, "audit") : 0;
    const found: string[] = [];
    diversions = diversions.map((row) => {
      if (row.foundAtStep !== null || row.scope.id !== audit.scope.id || row.departmentId !== audit.departmentId) return row;
      const thief = world.characters.find((character) => character.id === row.byCharacterId);
      if (thief === undefined) return row;
      const care = (thief.skills.intrigue + aptitude(thief, "manipulation")) / 2;
      const far = remotenessFrom(world, thief, thief.polityId);
      const odds = Math.max(AUDIT_FLOOR, Math.min(AUDIT_CEILING, (0.5 + (eye - care) / 100 - 0.05 * far) * (1 + lift)));
      const roll = (stableHash([audit.id, row.id]) % 10_000) / 10_000;
      if (roll >= odds) return row;
      found.push(`${thief.name} kept back ${row.amount}`);
      return { ...row, foundAtStep: toDay };
    });
    facts.push({
      localId: `audit_${audit.id}`.slice(0, 60),
      kind: found.length > 0 ? "peculation_found" : "audit_cleared",
      summary: found.length > 0
        ? `${auditor.name} went through the books of ${books} and found that ${found.join(", and ")}.`.slice(0, 400)
        : `${auditor.name} went through the books of ${books} and found them in order.`,
      affectedRefs: told,
      visibility: "private",
      discoveryState: "private",
      knowableInDays: 0,
      knownToRefs: told,
      significance: found.length > 0 ? 60 : 25,
    });
    return { ...audit, status: found.length > 0 ? "found" as const : "cleared" as const };
  });
  return { world: { ...world, audits, diversions }, facts };
}
