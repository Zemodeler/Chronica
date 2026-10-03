import type { Office } from "../characters/character";
import { allOffices } from "../characters/character";
import { officeGrantsDirectAccess } from "../characters/political-authority";
import type { Fact } from "../world/facts";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import type { Books } from "../material/books";
import { perMonth, readTheBooks } from "../material/books";
import { musterTheForces, type Muster } from "../material/forces";
import type { ScenarioWarfareRules } from "../warfare/battle";
import { authorityInWords, buildStation, CLAIMED_OFFICE_SOURCE_REF, factsKnownToStation } from "./station";
import { buildAuthorityIndex, isActive } from "./authority-grant";
import { ALL_CHAMBER_POWERS } from "../political-parts";

export interface InsightLine { readonly key: string; readonly text: string; readonly detail: string | null }
export interface PermissionReading extends InsightLine { readonly direct: boolean }
export interface DepartureReading {
  readonly key: string;
  readonly office: string;
  readonly when: string;
  readonly lost: readonly string[];
  readonly retained: readonly string[];
  readonly affairs: readonly string[];
}
export interface ReportDisagreement {
  readonly key: string;
  readonly subject: string;
  readonly accounts: readonly InsightLine[];
}
export interface OfficeInsights {
  readonly permissions: readonly PermissionReading[];
  readonly departures: readonly DepartureReading[];
  readonly readiness: Readonly<Record<string, readonly InsightLine[]>>;
  readonly exposure: { readonly own: readonly InsightLine[]; readonly kept: readonly InsightLine[] };
  readonly disagreements: readonly ReportDisagreement[];
  readonly service: Readonly<Record<string, readonly InsightLine[]>>;
}

export const EMPTY_OFFICE_INSIGHTS: OfficeInsights = {
  permissions: [], departures: [], readiness: {}, exposure: { own: [], kept: [] }, disagreements: [], service: {},
};
const number = (n: number): string => Math.round(n).toLocaleString("en-GB");
const RESERVED: Readonly<Record<string, string>> = {
  declare_war: "Declare war", extraordinary_tax: "Levy an extraordinary tax", borrow: "Borrow for the state",
  foundational_law: "Introduce a foundational law", over_limit_muster: "Muster beyond the usual limit",
};

/** Reads existing records only. Nothing here grants sight, predicts consent, or infers an NPC's private motives. */
export function readOfficeInsights(input: {
  readonly world: WorldState;
  readonly characterId: string | null;
  readonly offices?: readonly Office[];
  readonly clock?: ScenarioClock;
  readonly warfare?: ScenarioWarfareRules;
  readonly facts?: readonly Fact[];
  readonly ownBooks?: Books;
  readonly keptBooks?: Books;
  readonly muster?: Muster;
}): OfficeInsights {
  const { world, characterId, clock, warfare } = input;
  if (characterId === null || !world.characters.some((person) => person.id === characterId)) return EMPTY_OFFICE_INSIGHTS;
  const offices = allOffices(world, input.offices ?? []);
  const station = buildStation({ world, characterId, offices });
  const date = (day: number): string => clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock);
  const knownFacts = factsKnownToStation(input.facts ?? [], station, world.instant, world);
  const realSeats = station.seats.filter((seat) => !seat.seatId.startsWith(CLAIMED_OFFICE_SOURCE_REF));
  const permissions: PermissionReading[] = [];
  for (const rule of world.material.reservedPowers.filter((rule) => rule.polityId === station.polityId)) {
    const chamber = world.material.institutions.find((body) => body.id === rule.institutionId);
    const direct = realSeats.some((seat) => officeGrantsDirectAccess(seat.office, rule.category));
    const sponsor = realSeats.some((seat) => seat.office.sponsorableCategories.includes(rule.category));
    permissions.push({ key: rule.id, text: RESERVED[rule.category] ?? rule.category, direct,
      detail: direct ? "Your office permits this directly."
        : `${chamber?.name ?? "The deciding body"} must authorise this.${sponsor ? " You may bring the motion." : " Your held offices do not let you sponsor the motion."}` });
  }
  for (const { seatId, office } of realSeats) {
    if (office.treasuryAccountId === null || office.treasuryPermissions.length === 0) continue;
    const direct = office.treasuryPermissions.includes("spend_without_vote");
    permissions.push({ key: `treasury:${seatId}`, text: `Treasury spending as ${office.label}`, direct,
      detail: direct ? "You may spend without a vote." : office.treasuryPermissions.includes("propose_spending")
        ? "You may propose spending; a vote is required before you spend." : "You may inspect the books; this office grants no spending permission." });
  }
  const chamberSubjects = { laws: "laws and continuing measures", war: "war, peace, treaties and levies", taxes: "taxation and public spending", elections: "appointments by election", constitution: "changes to the constitution", judgment: "trials and removals" };
  for (const body of world.material.institutions.filter((body) => body.polityId === station.polityId)) {
    const powers = body.powers ?? ALL_CHAMBER_POWERS;
    if (powers.length === 0) continue;
    permissions.push({ key: `chamber:${body.id}`, text: `${body.name}: ${powers.map((power) => chamberSubjects[power]).join("; ")}`, direct: false,
      detail: body.advisory === true ? "This body's vote is advice; the ruler still decides." : "Questions within these powers can be decided by this body. Holding an office does not replace its decision on a question put before it." });
  }

  const departures: DepartureReading[] = [];
  const actualIndex = buildAuthorityIndex(world.material, world.authorityGrants, offices, world.elapsedStep);
  const actual = actualIndex.grants.filter((grant) => grant.holder.kind === "character" && grant.holder.id === characterId && isActive(grant, world.elapsedStep));
  for (const { seatId, office } of realSeats) {
    const seat = world.material.officeSeats.find((seat) => seat.id === seatId);
    if (seat?.termExpiresAtStep == null) continue;
    const afterWorld: WorldState = { ...world,
      characters: world.characters.map((person) => person.id === characterId && person.officeId === office.id ? { ...person, officeId: null } : person),
      material: { ...world.material, officeSeats: world.material.officeSeats.filter((seat) => seat.id !== seatId) },
      authorityGrants: world.authorityGrants.filter((grant) => !(grant.source === "office" && grant.sourceRef === seatId)),
    };
    const after = buildAuthorityIndex(afterWorld.material, afterWorld.authorityGrants, offices, world.elapsedStep).grants
      .filter((grant) => grant.holder.kind === "character" && grant.holder.id === characterId && isActive(grant, world.elapsedStep));
    const lost = actual.filter((grant) => grant.source === "office" && grant.sourceRef === seatId).flatMap((grant) => {
      const missing = grant.powers.filter((power) => !after.some((other) => other.domain === grant.domain && other.scope.kind === grant.scope.kind && other.scope.id === grant.scope.id && other.powers.includes(power)));
      if (missing.length === 0) return [];
      const phrase = authorityInWords({ ...station, grants: [{ ...grant, powers: missing }] }, world)[0];
      return phrase === undefined ? [] : [`${phrase.powers.join(" and ")} in ${phrase.domain} matters over ${phrase.overLabel}`];
    });
    const affairs = world.commitments.filter((promise) => promise.promisorCharacterId === characterId && promise.requiredOfficeId === office.id
      && ["pending", "prepared", "partially_fulfilled", "deferred"].includes(promise.status))
      .map((promise) => `Promise requiring this office: ${promise.description}`);
    for (const project of world.projects.filter((project) => project.overseerCharacterId === characterId
      && project.sponsorEntityRef.kind === "polity" && project.sponsorEntityRef.id === office.polityId
      && ["proposed", "funded", "in_progress"].includes(project.status))) {
      affairs.push(`Public work you currently oversee: ${project.label}. Arrange continuing oversight if your responsibilities change.`);
    }
    const pay = world.material.incomeSources.find((source) => source.id === office.incomeSourceId && source.active);
    if (pay !== undefined) affairs.push(`Office income of ${number(perMonth(pay.amount, pay.cadenceSteps) * pay.collectionRateBps / 10_000)} a month ends with the appointment.`);
    const retained = realSeats.filter((other) => other.seatId !== seatId).map((other) => other.office.label);
    departures.push({ key: seatId, office: office.label, when: date(seat.termExpiresAtStep), lost: [...new Set(lost)], retained: [...new Set(retained)], affairs });
  }

  const readiness: Record<string, InsightLine[]> = {};
  for (const force of (input.muster ?? musterTheForces(world, characterId, offices, clock, warfare)).forces) {
    const raw = world.material.forces.find((candidate) => candidate.id === force.id)!;
    const lines: InsightLine[] = [];
    const short = Math.max(0, force.authorizedStrength - force.fitStrength);
    if (short > 0) lines.push({ key: "strength", text: `${number(short)} ${force.naval ? "ships" : "men"} short of the establishment.`, detail: "This is a gap against the rolls, not a prohibition on campaigning." });
    if (force.unavailable > 0) lines.push({ key: "unfit", text: `${number(force.unavailable)} ${force.naval ? "ships laid up" : "men unfit for duty"}.`, detail: null });
    if (raw.provisionStatus !== "provisioned" || raw.provisionedThroughStep <= world.elapsedStep) lines.push({ key: "supply", text: `Provisions: ${force.provisionLabel}.`, detail: `Recorded provision horizon: ${force.provisionedThroughLabel}.` });
    else lines.push({ key: "supply", text: `Provisioned through ${force.provisionedThroughLabel}.`, detail: "A recorded horizon; a new campaign may change requirements." });
    if (force.payStatus !== "Paid" && force.payStatus !== "Paid out of what they take") lines.push({ key: "pay", text: `Wages: ${force.payStatus}.`, detail: "Unfunded or unpaid wages put continued service at risk." });
    if (raw.moraleBps < 5_000) lines.push({ key: "morale", text: `Morale: ${force.moraleLabel}.`, detail: "Low spirits reduce effective strength." });
    if (force.naval) lines.push({ key: "transport", text: `Transport room for about ${number(force.carries)} men.`, detail: "Capacity of this fleet, before choosing a voyage or embarkation point." });
    readiness[force.id] = lines;
  }

  const exposure = (books: Books): InsightLine[] => {
    const accountIds = new Set(books.accounts.map((account) => account.id));
    const sources = world.material.incomeSources.filter((source) => source.active && accountIds.has(source.beneficiaryAccountId));
    const amount = (source: typeof sources[number]) => perMonth(source.amount, source.cadenceSteps) * source.collectionRateBps / 10_000;
    const total = sources.reduce((sum, source) => sum + amount(source), 0);
    const lines: InsightLine[] = [];
    const labels = { tax: "Tax receipts", land: "Land income", office: "Office income", trade: "Trade income", pension: "Pensions", tribute: "Tribute" };
    for (const kind of Object.keys(labels) as (keyof typeof labels)[]) {
      const group = sources.filter((source) => source.kind === kind);
      const monthly = group.reduce((sum, source) => sum + amount(source), 0);
      if (group.length < 2 || total <= 0 || monthly / total < .5) continue;
      const without = books.surplus - monthly;
      lines.push({ key: `kind:${kind}`, text: `${labels[kind]}: ${number(monthly)} a month (${Math.round(monthly / total * 100)}% of income).`,
        detail: `At least half of this book's income depends on this activity. If these receipts stop together, the monthly ${without >= 0 ? "surplus" : "shortfall"} becomes ${number(Math.abs(without))}, with other income and expenses unchanged.` });
    }
    for (const source of [...sources].sort((a, b) => amount(b) - amount(a))) {
      const monthly = amount(source);
      if (monthly <= 0 || total <= 0) continue;
      const venture = world.material.ventures.find((venture) => venture.incomeSourceId === source.id && venture.status === "running");
      const partner = source.counterpartyPolityId === null ? undefined : world.map.polities.find((polity) => polity.id === source.counterpartyPolityId);
      const detail: string[] = [];
      if (monthly / total >= .5) detail.push("At least half of this book's income comes from this one source.");
      if (partner !== undefined) detail.push(`Depends on dealings with ${partner.name}.`);
      if (venture !== undefined) {
        const from = world.map.provinces.find((province) => province.id === venture.fromProvinceId)?.name ?? "its starting market";
        const to = world.map.provinces.find((province) => province.id === venture.toProvinceId)?.name ?? "its destination market";
        detail.push(`${from} to ${to}.${venture.bySea ? " Sea trade is exposed to war and blockade." : " This income depends on the two markets remaining connected."}`);
      }
      if (detail.length === 0) continue;
      const without = books.surplus - monthly;
      detail.push(`If this income stops, the monthly ${without >= 0 ? "surplus" : "shortfall"} becomes ${number(Math.abs(without))}, with other income and expenses unchanged.`);
      lines.push({ key: source.id, text: `${source.label}: ${number(monthly)} a month (${Math.round(monthly / total * 100)}% of income).`, detail: detail.join(" ") });
    }
    return lines;
  };

  // Compare structured observations at the same instant. Two different days can simply mean an army moved.
  const observations = new Map<string, { fact: Fact; men: number; locationId: string }[]>();
  for (const fact of knownFacts) {
    for (const report of fact.forcesAsReported ?? []) {
      const key = `${report.forceId}:${fact.time.day}:${fact.time.minute}`;
      observations.set(key, [...(observations.get(key) ?? []), { fact, men: report.men, locationId: report.locationId }]);
    }
  }
  const disagreements: ReportDisagreement[] = [];
  for (const [key, reports] of observations) {
    if (new Set(reports.map((report) => `${report.men}:${report.locationId}`)).size < 2) continue;
    const forceId = reports[0]!.fact.forcesAsReported?.find((report) => key.startsWith(`${report.forceId}:`))?.forceId;
    const force = world.material.forces.find((force) => force.id === forceId);
    disagreements.push({ key, subject: force?.name ?? "A reported force", accounts: reports.map(({ fact, men, locationId }) => ({
      key: fact.id, text: fact.summary,
      detail: `${date(fact.time.day)}: reported strength ${number(men)}, at ${world.map.provinces.find((province) => province.id === locationId)?.name ?? "an unnamed location"}. Source: ${fact.evidence?.provenance.replaceAll("_", " ") ?? "recorded account"}.`,
    })) });
  }

  const service: Record<string, InsightLine[]> = {};
  const serviceDates = new Map<string, number>();
  const addService = (id: string, line: InsightLine, atStep: number) => {
    serviceDates.set(line.key, atStep);
    service[`person:${id}`] = [...(service[`person:${id}`] ?? []), line];
  };
  for (const project of world.projects) {
    if (project.overseerCharacterId == null || project.sponsorEntityRef.kind !== "character" || project.sponsorEntityRef.id !== characterId) continue;
    if (project.status !== "completed" && project.status !== "failed") continue;
    const recordedAt = project.completedAtStep ?? world.elapsedStep;
    addService(project.overseerCharacterId, { key: `project:${project.id}`, text: `${project.status === "completed" ? "Completed" : "Recorded as failed"} under their oversight: ${project.label}.`,
      detail: `${project.completedAtStep === null ? "As of " : ""}${date(recordedAt)}. From work you sponsored; the outcome alone does not establish personal fault.` }, recordedAt);
  }
  for (const promise of world.commitments) {
    if (promise.beneficiaryCharacterId !== characterId || promise.resolvedAtStep === null) continue;
    if (!["fulfilled", "broken", "failed"].includes(promise.status)) continue;
    addService(promise.promisorCharacterId, { key: `promise:${promise.id}`, text: `${promise.status === "fulfilled" ? "Kept" : "Did not fulfil"} a promise to you: ${promise.description}`, detail: `${date(promise.resolvedAtStep)}. ${promise.resolutionReason ?? "Recorded in your dealings."}` }, promise.resolvedAtStep);
  }
  for (const fact of knownFacts) {
    if (!fact.affectedEntities.some((entity) => entity.kind === "character")) continue;
    for (const entity of fact.affectedEntities.filter((entity) => entity.kind === "character")) {
      addService(entity.id, { key: `fact:${fact.id}`, text: fact.summary, detail: `${date(fact.time.day)}. ${fact.evidence?.provenance.replaceAll("_", " ") ?? "Known record"}; involvement does not by itself establish responsibility.` }, fact.time.day);
    }
  }
  for (const key of Object.keys(service)) service[key] = service[key]!.sort((a, b) => (serviceDates.get(b.key) ?? 0) - (serviceDates.get(a.key) ?? 0) || a.key.localeCompare(b.key)).slice(0, 8);
  return { permissions, departures, readiness, exposure: { own: exposure(input.ownBooks ?? readTheBooks(world, characterId, offices, "own")), kept: exposure(input.keptBooks ?? readTheBooks(world, characterId, offices, "kept")) }, disagreements, service };
}
