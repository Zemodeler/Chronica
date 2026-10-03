import { allOffices, type Office } from "../characters/character";
import { entityKey, type Linked } from "../knowledge/glossary";
import { accountLabel } from "../material/account-names";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import { leverDefinition, type Department, type Diversion } from "../world/departments";
import type { WorldState } from "../world/world-state";
import { buildStation, holdsPolityStanding, speaksForPolity, type Station } from "./station";
import { ordersUnderWay } from "./under-way";

/**
 * How the state's work is divided, and who is answerable for each part.
 *
 * Departments, their offices and the men in them, what passes through their
 * hands, the works they have in hand, and what has been found in their books.
 * It reads the same stored records the engine runs on (`world.departments`,
 * `world.audits`, `world.diversions`) and the same project readings the desk
 * uses (`ordersUnderWay`), so the two cannot disagree about a work's progress.
 *
 * Three distinctions the page must keep:
 *
 * - A **vacancy** is an office the record says is empty. An **unnamed
 *   holder** is a college or board the record says is filled but does not
 *   name -- eight quaestors, a hundred and four judges. The first is a
 *   problem; the second is only something the record does not tell.
 * - A **discovered irregularity** is a diversion an audit found, with what it
 *   found. **Hidden theft** is a diversion nobody has found, and is never in
 *   this reading at all: the engine knows it, the player does not. All that
 *   may show of it is a rumour, which is the department's own and proves
 *   nothing.
 * - An audit that found nothing is different from one that could not look at
 *   everything; only the first clears anybody.
 */

export type PostCondition = "held" | "vacant" | "unnamed" | "partly";

export interface AdminPost {
  readonly key: string;
  readonly officeLabel: string;
  readonly role: "head" | "officer" | "deputy";
  readonly condition: PostCondition;
  readonly holders: readonly Linked[];
  readonly note: string;
}

export type FindingKind = "found" | "cleared" | "incomplete" | "interrupted" | "under_way" | "rumour";

export interface AdminFinding {
  readonly key: string;
  readonly kind: FindingKind;
  readonly text: string;
  readonly marked: boolean;
}

export interface AdminWork {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly stalled: boolean;
}

export interface AdminDepartment {
  readonly key: string;
  readonly name: string;
  /** A household's stewards rather than a power's department. */
  readonly household: boolean;
  /** "gathering the taxes", "the grain supply". */
  readonly responsibilities: readonly string[];
  readonly head: { readonly condition: PostCondition | "none"; readonly summary: string; readonly person: Linked | null };
  /** The one thing wrong that is known, or null. `marked` wants the player's word. */
  readonly issue: { readonly text: string; readonly marked: boolean } | null;
  readonly posts: readonly AdminPost[];
  /** What passes through its hands, how its people are paid, and what needs a chamber's leave. */
  readonly spending: readonly string[];
  readonly work: readonly AdminWork[];
  readonly findings: readonly AdminFinding[];
}

export interface Administration {
  readonly departments: readonly AdminDepartment[];
  /** Spending that a law has authorised, for the state. */
  readonly authorisations: readonly string[];
  /** How many departments have a known issue that wants a word. */
  readonly wanting: number;
}

const EMPTY: Administration = { departments: [], authorisations: [], wanting: 0 };
/** A rumour is news for about half a year. */
const RUMOUR_DAYS = 180;
const money = (amount: number): string => Math.round(amount).toLocaleString("en-GB");
const upper = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

export function readAdministration(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): Administration {
  if (characterId === null) return EMPTY;
  const station: Station = buildStation({ world, characterId, offices });
  const governs = holdsPolityStanding(station);
  const fiscal = speaksForPolity(station, "fiscal");
  const today = world.elapsedStep;
  const date = (day: number): string => (clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock));
  const person = (id: string): Linked => ({ label: world.characters.find((character) => character.id === id)?.name ?? "someone", key: entityKey("person", id) });
  const everyOffice = allOffices(world, offices);
  const officeById = new Map(everyOffice.map((office) => [office.id, office]));
  const underWay = new Map(ordersUnderWay(world, characterId, offices, clock).map((item) => [item.key, item]));
  const heldSeatOffices = new Set(station.seats.map((seat) => seat.office.id));

  const departments = (world.departments ?? []).filter((department) => department.abolishedAtStep === null).flatMap((department): AdminDepartment[] => {
    const household = department.scope.kind === "household";
    const ownPower = department.scope.kind === "polity" && department.scope.id === station.polityId;
    const ownHousehold = household && department.scope.id === characterId;
    const sits = [department.headOfficeId, ...department.officeIds, ...department.deputyOfficeIds].some((id) => id !== null && heldSeatOffices.has(id));
    // A power's departments are for those who run its money or sit in one; a
    // household's for its owner and the steward it hired.
    if (!((ownPower && (governs || fiscal || sits)) || ownHousehold)) return [];
    return [readDepartment(department, household)];
  });

  function postsOf(department: Department): AdminPost[] {
    const roles: { id: string; role: AdminPost["role"] }[] = [];
    const add = (id: string | null, role: AdminPost["role"]) => { if (id !== null && !roles.some((entry) => entry.id === id)) roles.push({ id, role }); };
    add(department.headOfficeId, "head");
    for (const id of department.officeIds) add(id, "officer");
    for (const id of department.deputyOfficeIds) add(id, "deputy");
    return roles.map(({ id, role }): AdminPost => {
      const office = officeById.get(id);
      const label = office?.label ?? id.replace(/^.*:/, "").replace(/[-_]/g, " ");
      const seats = world.material.officeSeats.filter((seat) => seat.officeId === id);
      const held = seats.filter((seat) => seat.status === "held" && seat.holderCharacterId !== null);
      const holders = [...new Set(held.map((seat) => seat.holderCharacterId!))].map(person);
      // A seat the record has, empty, is a vacancy. An office with no seat in
      // the record at all and a seat count is a body nobody has been named to.
      if (seats.length === 0) {
        const count = office?.seatCount ?? 1;
        return office === undefined || (office.seatCount === undefined && count === 1)
          ? { key: id, officeLabel: label, role, condition: "vacant", holders: [], note: "Nobody holds it." }
          : { key: id, officeLabel: label, role, condition: "unnamed", holders: [], note: `${count} ${count === 1 ? "member" : "members"} sit in it; the record does not name them.` };
      }
      if (held.length === 0) return { key: id, officeLabel: label, role, condition: "vacant", holders: [], note: `Vacant${seats.length > 1 ? `: all ${seats.length} seats` : ""}.` };
      if (held.length < seats.length) return { key: id, officeLabel: label, role, condition: "partly", holders, note: `${held.length} of ${seats.length} seats filled.` };
      return { key: id, officeLabel: label, role, condition: "held", holders, note: "" };
    });
  }

  function readDepartment(department: Department, household: boolean): AdminDepartment {
    const posts = postsOf(department);
    const headPost = posts.find((post) => post.role === "head");
    const headless = department.headOfficeId === null;
    const rulerOfficeId = world.constitutions.find((constitution) => constitution.polityId === department.scope.id)?.rulerOfficeId ?? null;
    const head: AdminDepartment["head"] = headPost !== undefined
      ? {
        condition: headPost.condition,
        person: headPost.holders[0] ?? null,
        summary: headPost.condition === "vacant" ? `The ${headPost.officeLabel} is vacant`
          : headPost.condition === "unnamed" ? `The ${headPost.officeLabel}, whose holders are not named in the record`
            : headPost.holders.length === 0 ? `The ${headPost.officeLabel}`
              : `${headPost.holders.map((holder) => holder.label).join(" and ")}, ${headPost.officeLabel.toLowerCase()}`,
      }
      : { condition: "none", person: null, summary: headless ? (household ? "Its owner keeps the accounts himself" : rulerOfficeId === null ? "No head is named" : "The head of state directs it himself") : "No head is named" };

    // The one known issue, most pressing first. Hidden theft is not on this list.
    const findings: AdminFinding[] = [];
    const mine = (diversion: Diversion) => diversion.departmentId === department.id;
    const found = world.diversions.filter((diversion) => mine(diversion) && diversion.foundAtStep !== null);
    for (const diversion of found) {
      findings.push({
        key: `found:${diversion.id}`,
        kind: "found",
        text: `An audit found ${money(diversion.amount)} missing, taken by ${person(diversion.byCharacterId).label} between ${date(diversion.firstAtStep)} and ${date(diversion.lastAtStep)}. It was found ${date(diversion.foundAtStep!)}.`,
        marked: true,
      });
    }
    for (const audit of world.audits.filter((candidate) => candidate.departmentId === department.id)) {
      const auditor = person(audit.auditorCharacterId).label;
      const ordered = audit.orderedByCharacterId === characterId || governs;
      if (!ordered) continue;
      if (audit.status === "under_way") findings.push({ key: `audit:${audit.id}`, kind: "under_way", text: `${auditor} is going through the books; a finding is due ${date(audit.dueAtStep)}.`, marked: audit.dueAtStep < today });
      else if (audit.status === "no_discrepancy") findings.push({ key: `audit:${audit.id}`, kind: "cleared", text: `${auditor} went through all the books that were asked for and found nothing wrong.`, marked: false });
      else if (audit.status === "incomplete") findings.push({ key: `audit:${audit.id}`, kind: "incomplete", text: `${auditor} found nothing in what he could go through, but could not go through all of it. That clears nobody.`, marked: false });
      else if (audit.status === "interrupted") findings.push({ key: `audit:${audit.id}`, kind: "interrupted", text: "An audit was begun and could not be finished.", marked: false });
    }
    const rumoured = department.rumouredAtStep !== null && today - department.rumouredAtStep <= RUMOUR_DAYS;
    if (rumoured && found.length === 0) {
      findings.push({ key: `rumour:${department.id}`, kind: "rumour", text: "Men say less reaches it than the rolls promise. Nothing is proven.", marked: false });
    }

    const vacantPosts = posts.filter((post) => post.condition === "vacant");
    const forming = department.formsAtStep > today;
    const overdue = findings.find((finding) => finding.kind === "under_way" && finding.marked);
    let issue: AdminDepartment["issue"] = null;
    const foundFinding = findings.find((finding) => finding.kind === "found");
    if (foundFinding !== undefined) issue = { text: "An irregularity has been found in its books.", marked: true };
    else if (headPost?.condition === "vacant") issue = { text: "Its head is not appointed.", marked: true };
    else if (overdue !== undefined) issue = { text: "An audit is overdue.", marked: true };
    else if (vacantPosts.length > 0 && vacantPosts.length === posts.length) issue = { text: "Every post in it is vacant.", marked: true };
    else if (rumoured && found.length === 0) issue = { text: "There is talk of money going missing, unproven.", marked: false };
    else if (vacantPosts.length > 0) issue = { text: `${vacantPosts.length === 1 ? "A post is" : `${vacantPosts.length} posts are`} vacant.`, marked: false };
    else if (forming) issue = { text: `Still being organised; it will be at work ${date(department.formsAtStep)}.`, marked: false };

    const spending: string[] = [];
    if (department.budgetPerMonth > 0) spending.push(`About ${money(department.budgetPerMonth)} passes through it in a month.`);
    spending.push(department.pay === "salaried" ? "Its officers are paid a salary." : "Its offices are honorary: they carry no pay.");
    for (const gate of department.gates) {
      const body = world.material.institutions.find((institution) => institution.id === gate.institutionId)?.name ?? "a council";
      spending.push(`${upper(GATE_IN_WORDS[gate.act])} needs the leave of ${body}.`);
    }

    // Works in hand: those it oversees, and, for a department that pays for
    // public works, those the state itself has begun.
    const officerIds = new Set(posts.flatMap((post) => world.material.officeSeats.filter((seat) => seat.officeId === post.key && seat.holderCharacterId !== null).map((seat) => seat.holderCharacterId!)));
    const handlesWorks = department.levers.includes("public_works_cost");
    const work: AdminWork[] = [];
    for (const project of world.projects) {
      if (project.status === "completed" || project.status === "cancelled" || project.status === "failed") continue;
      const overseen = project.overseerCharacterId != null && officerIds.has(project.overseerCharacterId);
      const stateWork = handlesWorks && !household && project.sponsorEntityRef.kind === "polity" && project.sponsorEntityRef.id === department.scope.id && project.kind !== "march" && project.kind !== "sailing" && project.kind !== "crossing";
      if (!overseen && !stateWork) continue;
      const item = underWay.get(`project:${project.id}`);
      work.push({ key: `project:${project.id}`, label: project.label, detail: item?.detail ?? "Under way.", stalled: item?.stalled ?? false });
    }

    return {
      key: department.id,
      name: department.name,
      household,
      responsibilities: department.levers.map((lever) => leverDefinition(lever).words),
      head,
      issue,
      posts,
      spending,
      work,
      findings,
    };
  }

  const authorisations = governs || fiscal
    ? world.genericEntities
      .filter((entity) => entity.kind === "budget_authorization" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === station.polityId)
      .map((entity) => {
        const account = world.material.accounts.find((candidate) => candidate.id === entity.attributes["accountId"]);
        const from = account === undefined ? "the treasury" : accountLabel(world, account, "clause");
        const amount = entity.attributes["authorizedAmount"];
        return typeof amount === "number" ? `Up to ${money(amount)} from ${from} for ${entity.label}.` : `A standing budget from ${from} for ${entity.label}.`;
      })
    : [];

  const sorted = [...departments].sort((a, b) => Number(b.issue?.marked === true) - Number(a.issue?.marked === true) || a.name.localeCompare(b.name));
  return { departments: sorted, authorisations, wanting: sorted.filter((department) => department.issue?.marked === true).length };
}

const GATE_IN_WORDS = {
  spend: "spending",
  make_war: "making war",
  make_peace: "making peace",
  assign_command: "giving a command",
  receive_embassy: "receiving an embassy",
  judge_commander: "judging a commander",
  create_or_abolish: "founding or abolishing it",
} as const;
