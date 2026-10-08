import {
  LOOSE_COHESION_BPS,
  STANDARD_LEVERS,
  activeDepartments,
  allOffices,
  currentAgeYears,
  isMagistracy,
  leverDefinition,
  leversNamedBy,
  mayAct,
  readDepartments,
  stableHash,
  type Character,
  type FactProposalDraft,
  type LeverId,
  type Office,
  type WorldState,
} from "@chronica/shared";
import { carryOutDepartment } from "./departments";
import type { GovernmentRules } from "./constitutions";
import type { IdFactory } from "./ports";

/**
 * Appointments by rule (docs/economy.md, "What the model is left to"; docs/plans/government.md, "Appointments by rule").
 *
 * A ruler who is carrying more than one man can carry, whose chest is in debt, whose people are hungry or who has been struck at,
 * puts somebody in charge: he makes the charge (a dioiketes over the revenues, a keeper of the grain, a warden of the harbours) and
 * `fillAppointments` then names the ablest man of the power to it by his gifts for its work. The model is not asked: the ambitions
 * `wantDepartments` lays on a ruler for it are hidden from the prompts of people the model plays (`management-talk.ts`), and these
 * are done for him, a month at a time.
 *
 * Only where history says a ruler could. A king names his officers himself, and a Hellenistic kingdom's charges are the ones its
 * court had (the finance officer, the keepers of the ports and of the grain, the generals); a power with a chamber that elects or
 * assigns its magistrates invents none: it fills the posts it has through the elections and appointments it already holds, and a
 * ruler whose appointments are the chamber's (`mayAct`: Rome's consuls, Carthage's suffetes) lays nothing here. The player is never
 * seated, and a power he rules is left to him.
 */

/** One charge a ruler can make, in a Greek court's words and in a plain one's. */
interface Charge {
  readonly need: "treasury" | "grain" | "watch" | "war" | "harbours" | "courts";
  readonly levers: readonly LeverId[];
  readonly greek: { readonly office: string; readonly department: string };
  readonly plain: { readonly office: string; readonly department: string };
  readonly key: string;
}

const CHARGES: readonly Charge[] = [
  { need: "treasury", key: "dioiketes", levers: ["tax_roll", "credit"], greek: { office: "Dioiketes", department: "The Revenues" }, plain: { office: "Treasurer of the Realm", department: "The Treasury" } },
  { need: "grain", key: "keeper-of-the-grain", levers: ["grain"], greek: { office: "Sitophylax", department: "The Keepers of the Grain" }, plain: { office: "Keeper of the Granaries", department: "The Granaries" } },
  { need: "war", key: "marshal", levers: ["levy", "supply"], greek: { office: "Strategos of the Host", department: "The Generals" }, plain: { office: "Marshal of the Host", department: "The Marshals" } },
  { need: "harbours", key: "warden-of-the-harbours", levers: ["customs"], greek: { office: "Epistates of the Harbours", department: "The Harbour Dues" }, plain: { office: "Warden of the Harbours", department: "The Harbour Dues" } },
  { need: "watch", key: "master-of-the-watch", levers: ["watch"], greek: { office: "Archiphylakites", department: "The Guard" }, plain: { office: "Master of the Watch", department: "The Watch" } },
  { need: "courts", key: "chief-judge", levers: ["courts"], greek: { office: "Epistates of the Courts", department: "The Courts" }, plain: { office: "Chief Judge", department: "The Courts" } },
];

/** What a ruler gives away first when he is carrying too much: the purse, the bread, the host, the dues, the watch, the courts. */
const HAND_OFF_ORDER: readonly Charge["need"][] = ["treasury", "grain", "war", "harbours", "watch", "courts"];

/** A month's review: this soon after a charge was made by rule or pressure, a power makes no other. */
export const APPOINT_COOLDOWN_DAYS = 90;
/** A charge nobody pressed for, a king's own tidying of his court, is slower still. */
export const APPOINT_TIDY_COOLDOWN_DAYS = 365;
/** The most charges made in one review, across the world. */
export const APPOINT_MAX_PER_REVIEW = 4;
/** A power makes at most this many charges by rule over its life. */
export const APPOINT_MAX_PER_POWER = 5;

const HUNGER_BPS = 5_000;
const UNREST_BPS = 5_000;
const PRESSURE_MEMORY_DAYS = 90;
const MIN_AGE = 25;
const HANDED_OFF_WORKLOAD = -9;

export interface AppointByRuleInput {
  readonly world: WorldState;
  readonly government: GovernmentRules;
  readonly toDay: number;
  readonly ids: IdFactory;
  readonly playerCharacterId?: string | null | undefined;
  /** The most charges to make in this review (tests lift it). */
  readonly max?: number;
}

interface Reason {
  readonly need: Charge["need"];
  readonly why: string;
  readonly ambitionPrefix: "hand-off" | "treasurer" | "watch" | "grain" | null;
  readonly tidy: boolean;
}

/**
 * What presses a power to make a charge now, the most urgent first, or null: the chest in debt with nobody over the tax roll, hunger
 * with unrest and nobody over the grain, a plot against the state's men with nobody keeping watch, the ruler holding more than one
 * man can do well (his weakest portfolio goes first), and, a king's own tidying, a court that lacks what a court of its sort had.
 */
function reasonFor(world: WorldState, polityId: string, rulerId: string, king: boolean): Reason | null {
  const reader = readDepartments(world);
  const scope = { kind: "polity" as const, id: polityId };
  const unheld = (charge: Charge): boolean => charge.levers.every((lever) => reader.holding(scope, lever).department === null);
  const charge = (need: Charge["need"]): Charge => CHARGES.find((entry) => entry.need === need)!;

  const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId);
  if (chest !== undefined && chest.balance < 0 && unheld(charge("treasury"))) return { need: "treasury", why: "the chest is in debt", ambitionPrefix: "treasurer", tidy: false };

  const hungry = world.map.provinces.some((province) => {
    if (province.controllerPolityId !== polityId) return false;
    const entry = world.material.provinceMaterial.find((material) => material.provinceId === province.id);
    return entry !== undefined && entry.foodSecurityBps < HUNGER_BPS && entry.stabilityBps < UNREST_BPS;
  });
  if (hungry && unheld(charge("grain"))) return { need: "grain", why: "the people are hungry", ambitionPrefix: "grain", tidy: false };

  const struck = world.covertPlots.some((plot) => plot.resolvedAtStep !== null && world.elapsedStep - plot.resolvedAtStep <= PRESSURE_MEMORY_DAYS
    && (plot.outcome === "discovered" || plot.outcome === "killed" || plot.outcome === "maimed")
    && world.characters.some((character) => character.id === plot.targetCharacterId && character.polityId === polityId));
  if (struck && unheld(charge("watch"))) return { need: "watch", why: "a plot was laid against the state's own men", ambitionPrefix: "watch", tidy: false };

  if (reader.workload(rulerId) <= HANDED_OFF_WORKLOAD) {
    const need = HAND_OFF_ORDER.find((candidate) => unheld(charge(candidate)));
    if (need !== undefined) return { need, why: "he held more than one man can do well", ambitionPrefix: "hand-off", tidy: false };
  }

  if (king) {
    const hasPort = world.map.provinces.some((province) => province.settlements.some((settlement) => settlement.kind === "port" && settlement.controllerPolityId === polityId));
    for (const need of ["treasury", "harbours", "war"] as const) {
      if (need === "harbours" && !hasPort) continue;
      if (unheld(charge(need))) return { need, why: "a kingdom has such an officer", ambitionPrefix: null, tidy: true };
    }
  }
  return null;
}

/** Whoever the ruler might name: of age, of his people, not himself, not the player, and not a man already sitting in a magistracy. */
function mightBeNamed(world: WorldState, government: GovernmentRules, polityId: string, rulerIds: ReadonlySet<string>, playerId: string | null, toDay: number): Character[] {
  const offices = new Map(allOffices(world, government.offices).map((office) => [office.id, office]));
  const sitting = new Set(world.material.officeSeats
    .filter((seat) => seat.status === "held" && seat.holderCharacterId !== null && isMagistracy(offices.get(seat.officeId)))
    .map((seat) => seat.holderCharacterId!));
  return world.characters.filter((character) => character.alive && character.polityId === polityId && !rulerIds.has(character.id) && character.id !== playerId
    && !sitting.has(character.id) && currentAgeYears(character, toDay) >= MIN_AGE);
}

const isGreekCourt = (ruler: Character): boolean => ruler.cultureId === "greek";

/** The ruler's own appointments are his to make: a king's, a chief's, a head of a power no chamber holds them in. */
function mayName(world: WorldState, government: GovernmentRules, rulerId: string): boolean {
  const may = mayAct(world, rulerId, "appointment", { offices: government.offices });
  return may === null || may.grade === "alone" || may.grade === "with_colleague";
}

/**
 * A republic's or a league's posts that exist and are named (not elected) but sit in no department: the ruler gives them the work
 * their name says. No office is invented.
 */
function existingPost(world: WorldState, government: GovernmentRules, polityId: string): { office: Office; levers: LeverId[] } | null {
  const reader = readDepartments(world);
  const scope = { kind: "polity" as const, id: polityId };
  const inDepartment = new Set(activeDepartments(world).flatMap((department) => [...department.officeIds, ...department.deputyOfficeIds, ...(department.headOfficeId === null ? [] : [department.headOfficeId])]));
  const named = new Set(government.successionRules.filter((rule) => rule.kind === "appointment").map((rule) => rule.id));
  const ruler = world.constitutions.find((constitution) => constitution.polityId === polityId)?.rulerOfficeId ?? null;
  for (const office of [...allOffices(world, government.offices)].sort((a, b) => a.id.localeCompare(b.id))) {
    if (office.polityId !== polityId || office.id === ruler || inDepartment.has(office.id) || !isMagistracy(office)) continue;
    if (!named.has(office.successionRuleId) && office.successionRuleId !== "appointed-by-the-government") continue;
    const levers = leversNamedBy(office.label).filter((lever) => (STANDARD_LEVERS as readonly string[]).includes(lever) && reader.holding(scope, lever).department === null);
    if (levers.length > 0) return { office, levers };
  }
  return null;
}

export function appointByRule(input: AppointByRuleInput): { readonly world: WorldState; readonly facts: readonly FactProposalDraft[] } {
  const player = input.playerCharacterId ?? null;
  const facts: FactProposalDraft[] = [];
  let world = input.world;
  let made = 0;
  const monarchies = new Set(world.constitutions.filter((constitution) => constitution.form === "monarchy").map((constitution) => constitution.polityId));

  // The month's order of going is a shuffle of the powers, stable for the month, so the cap does not always favour the same few.
  const month = Math.floor(input.toDay / 30);
  for (const polity of [...world.map.polities].sort((a, b) => stableHash([a.id, String(month)]) - stableHash([b.id, String(month)]) || a.id.localeCompare(b.id))) {
    if (made >= (input.max ?? APPOINT_MAX_PER_REVIEW)) break;
    // A loose people or a single town has nothing to hand to anybody (as `wantDepartments`).
    if (polity.cohesionBps < LOOSE_COHESION_BPS) continue;
    if (world.map.provinces.filter((province) => province.controllerPolityId === polity.id).length < 3) continue;
    const rulers = readDepartments(world).rulers(polity.id).filter((ruler) => ruler.alive);
    const ruler = rulers[0];
    if (ruler === undefined || rulers.some((candidate) => candidate.id === player)) continue;

    const mine = activeDepartments(world).filter((department) => department.scope.kind === "polity" && department.scope.id === polity.id && department.origin === "pressure");
    if (mine.length >= APPOINT_MAX_PER_POWER) continue;
    const last = Math.max(-Infinity, ...mine.map((department) => department.foundedAtStep));
    if (input.toDay - last < APPOINT_COOLDOWN_DAYS) continue;
    if (!mayName(world, input.government, ruler.id)) continue;

    const king = monarchies.has(polity.id);
    const rulerIds = new Set(rulers.map((candidate) => candidate.id));
    if (mightBeNamed(world, input.government, polity.id, rulerIds, player, input.toDay).length === 0) continue;

    const before = new Set(world.departments.map((department) => department.id));
    let title: string;
    let measure: NonNullable<Parameters<typeof carryOutDepartment>[2]>;
    let why: string;
    let ambitionPrefix: Reason["ambitionPrefix"] = null;

    if (king) {
      const reason = reasonFor(world, polity.id, ruler.id, true);
      if (reason === null) continue;
      if (reason.tidy && input.toDay - last < APPOINT_TIDY_COOLDOWN_DAYS) continue;
      const charge = CHARGES.find((entry) => entry.need === reason.need)!;
      const words = isGreekCourt(ruler) ? charge.greek : charge.plain;
      const officeId = `${polity.id}-${charge.key}`.slice(0, 120);
      if (allOffices(world, input.government.offices).some((office) => office.id === officeId)) continue;
      const reader = readDepartments(world);
      const levers = charge.levers.filter((lever) => reader.holding({ kind: "polity", id: polity.id }, lever).department === null);
      if (levers.length === 0) continue;
      measure = {
        departmentId: null, name: words.department, levers: [...levers],
        offices: [{ officeId, officeLabel: words.office, role: "head", seats: 1 }],
        pay: "honorary", effects: [], abolish: false,
      };
      title = words.department;
      why = reason.why;
      ambitionPrefix = reason.ambitionPrefix;
    } else {
      // A power with a chamber that elects its magistrates makes none: it gives the work to a post it has, if there is one.
      const post = existingPost(world, input.government, polity.id);
      if (post === null) continue;
      measure = {
        departmentId: null, name: `The ${post.office.label}`.slice(0, 120), levers: post.levers,
        offices: [{ officeId: post.office.id, officeLabel: null, role: "head", seats: null }],
        pay: "honorary", effects: [], abolish: false,
      };
      title = measure.name!;
      why = "its work had no one over it";
    }

    const carried = carryOutDepartment(world, polity.id, measure, input.toDay, input.ids, input.government.offices, ruler.id, title);
    if (carried.said.length === 0) continue;
    // Made by pressure, not by an order: the cooldown counts it.
    world = {
      ...carried.world,
      departments: carried.world.departments.map((department) => (before.has(department.id) ? department : { ...department, origin: "pressure" as const })),
    };
    // What the ruler wanted of his officers is done: the ambition is fulfilled, and the review does not lay it again.
    if (ambitionPrefix !== null) {
      const ambitionId = `${ambitionPrefix}-${polity.id}`;
      world = {
        ...world,
        characters: world.characters.map((character) => (!rulerIds.has(character.id) ? character : {
          ...character,
          ambitions: character.ambitions.map((ambition) => (ambition.id === ambitionId && ambition.status === "active" ? { ...ambition, status: "fulfilled" as const } : ambition)),
        })),
      };
    }
    made += 1;
    const work = (measure.levers ?? []).map((lever) => leverDefinition(lever).words);
    facts.push({
      localId: `charge_by_rule_${polity.id}_${input.toDay}`.slice(0, 60),
      kind: "government",
      summary: `${ruler.name} set up ${title}${work.length === 0 ? "" : ` to take charge of ${work.join(", ")}`}, and means to name a man over it, because ${why}.`.slice(0, 400),
      affectedRefs: [{ kind: "polity", id: polity.id }, { kind: "character", id: ruler.id }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 30,
    });
  }
  return { world, facts };
}
