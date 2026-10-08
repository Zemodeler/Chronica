import {
  hubOf,
  isOccupied,
  provinceSites,
  readDepartments,
  stableHash,
  type Province,
  type PublicWorkContract,
  type StandingEffect,
  type StructureKind,
  type WorkKind,
  type WorldState,
  WORK_KINDS,
} from "@chronica/shared";

/**
 * The works a state lets for its own good (docs/economy.md, "Where the money goes").
 *
 * When a power's chest has cover above its reserve, whoever keeps its works (the censors, with the aediles for the city's, at Rome; the officers of the
 * accounts and the Elders' leave at Carthage; the king's steward of works under a king) lets a contract. The rules choose it, by `stableHash` and
 * the state of the land: the capital and the places a great town makes busy come first, then the places a war has scarred, then the ones with
 * the most to gain; and what is built is what the place lacks and the age would have built there: a road (the Via Appia, 312, is the pattern),
 * an aqueduct (the Aqua Appia, the same year), a temple, walls, a harbour with its docks, public granaries, a forum and its halls.
 *
 * What it does when it stands is a made thing's (`world/standing-effects.ts`): a lasting lift of the ceiling of development at that place, which
 * the trade flows already read at both ends of a route (`trade-flows.ts`: the haul is cheaper by the roads and harbours of the two hubs), and
 * for temples, walls and granaries the calm, the defence and the bread they give. The money goes to contractors: the merchant house of that
 * power that takes the contract (the publicani at Rome) is paid the price by instalments and pays out the cost to the men who do the work, and
 * keeps the difference; where no house stands in the power, the whole goes to the men nobody names. Nothing is made: every drachma that is
 * paid is a drachma the chest held.
 */

export interface WorkPlan {
  readonly kind: WorkKind;
  readonly province: Province;
  readonly name: string;
  readonly structureKind: StructureKind;
  readonly effects: readonly StandingEffect[];
  /** What it costs to do, and the months it takes. */
  readonly cost: number;
  readonly months: number;
  readonly milestones: readonly string[];
}

/** What each sort of work costs, of a year of what the power takes in; and how long it takes in months. */
const COST_SHARE: Readonly<Record<WorkKind, number>> = { road: 0.085, aqueduct: 0.07, harbour: 0.075, walls: 0.055, temple: 0.035, granary: 0.03, forum: 0.04 };
const MONTHS: Readonly<Record<WorkKind, number>> = { road: 14, aqueduct: 18, harbour: 14, walls: 12, temple: 10, granary: 6, forum: 9 };
const WEIGHT: Readonly<Record<WorkKind, number>> = { road: 3, aqueduct: 2, harbour: 2, walls: 1, temple: 2, granary: 2, forum: 1 };
/** The least a work costs, whatever the share says. */
export const LEAST_WORK_COST = 6_000;
/** The contractor's gain over the cost, in basis points: the publicani did not build for nothing. */
export const CONTRACTOR_GAIN_BPS = 1_200;

const STAGES: Readonly<Record<WorkKind, readonly string[]>> = {
  road: ["the line is surveyed and the ground cleared", "the bed is laid", "the paving is laid and the bridges raised", "the milestones are set up"],
  aqueduct: ["the springs are tapped and the line surveyed", "the channel is cut", "the arches and the conduit are raised", "the water is led in"],
  harbour: ["the shore is cleared and the piles driven", "the moles are built out", "the quays and the sheds are raised", "the harbour is opened to ships"],
  walls: ["the foundations are dug", "the lower courses are laid", "the towers and the gates are raised", "the walls are finished"],
  temple: ["the ground is hallowed and the foundations laid", "the walls of the cella rise", "the roof and the columns are set", "the god is brought in"],
  granary: ["the site is levelled", "the walls are raised", "the vaults are roofed", "the first grain is stored"],
  forum: ["the ground is cleared and drained", "the porticoes are raised", "the halls and the booths are roofed", "the forum is opened"],
};

const SLIGHT = (quantity: StandingEffect["quantity"]): StandingEffect => ({ quantity, direction: "raise", band: "slight", scope: "here" });
const MARKED = (quantity: StandingEffect["quantity"]): StandingEffect => ({ quantity, direction: "raise", band: "marked", scope: "here" });

/** What each sort of work is, to the engine: the kind of building and what it goes on doing. */
export const MADE: Readonly<Record<WorkKind, { structureKind: StructureKind; effects: readonly StandingEffect[] }>> = {
  road: { structureKind: "other", effects: [MARKED("development")] },
  aqueduct: { structureKind: "other", effects: [SLIGHT("development"), SLIGHT("stability")] },
  harbour: { structureKind: "other", effects: [MARKED("development")] },
  walls: { structureKind: "wall", effects: [SLIGHT("defense"), SLIGHT("stability")] },
  temple: { structureKind: "temple", effects: [SLIGHT("stability"), SLIGHT("legitimacy")] },
  granary: { structureKind: "depot", effects: [SLIGHT("food_security"), SLIGHT("supply")] },
  forum: { structureKind: "market", effects: [SLIGHT("development"), SLIGHT("stability")] },
};

const NAMES: Readonly<Record<WorkKind, (place: string) => string>> = {
  road: (place) => `The paved road through ${place}`,
  aqueduct: (place) => `The aqueduct of ${place}`,
  harbour: (place) => `The harbour and docks of ${place}`,
  walls: (place) => `The walls of ${place}`,
  temple: (place) => `A temple at ${place}`,
  granary: (place) => `The public granaries of ${place}`,
  forum: (place) => `The forum and halls of ${place}`,
};

const settledOf = (province: Province): number => province.settlements.reduce((sum, settlement) => sum + settlement.size, 0);

/** The sort of work a structure was raised as, read off its provenance (`works:<kind>:<n>`); undefined for anything else. */
export function workKindOf(provenance: string | null): WorkKind | undefined {
  if (provenance === null || !provenance.startsWith("works:")) return undefined;
  const kind = provenance.split(":")[1];
  return (WORK_KINDS as readonly string[]).includes(kind ?? "") ? (kind as WorkKind) : undefined;
}

/** Which sort of work stands in each province already, read once off the structures the rules' own contracts raised. */
function standingWorks(world: WorldState, inHand: readonly PublicWorkContract[]): Map<string, Map<WorkKind, number>> {
  const found = new Map<string, Map<WorkKind, number>>();
  for (const structure of world.structures) {
    const kind = workKindOf(structure.provenanceProjectId);
    if (kind === undefined || structure.lapsedAtStep != null) continue;
    const here = found.get(structure.provinceId) ?? new Map<WorkKind, number>();
    here.set(kind, (here.get(kind) ?? 0) + 1);
    found.set(structure.provinceId, here);
  }
  // And what is being built: a second harbour is not let where the first is half raised.
  for (const contract of inHand) {
    const here = found.get(contract.provinceId) ?? new Map<WorkKind, number>();
    here.set(contract.kind, (here.get(contract.kind) ?? 0) + 1);
    found.set(contract.provinceId, here);
  }
  return found;
}

/**
 * The work a power would let now, or null where nothing is worth it: the place first (by `stableHash` among near-equals), then what the place
 * lacks. Reads the provinces the power holds once; called at most once a season for a power, never for every province each month.
 */
export function planWork(world: WorldState, polityId: string, annualTakings: number, count: number, inHand: readonly PublicWorkContract[] = []): WorkPlan | null {
  const sites = provinceSites(world);
  const rows = new Map(world.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const built = standingWorks(world, inHand);
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  const capital = polity?.capitalSettlementId == null ? undefined : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId));
  let best: { province: Province; score: number } | null = null;
  for (const province of world.map.provinces) {
    if (province.controllerPolityId !== polityId || isOccupied(province) || province.settlements.length === 0) continue;
    const row = rows.get(province.id);
    const site = sites.get(province.id);
    const development = row?.developmentBps ?? 3_000;
    const standing = built.get(province.id);
    const lasting = standing === undefined ? 0 : [...standing.values()].reduce((sum, n) => sum + n, 0);
    const score = (province.id === capital?.id ? 3_000 : 0)
      + (site?.agglomeration ?? 0) * 2_000
      + (row?.scarBps ?? 0) * 0.6
      + Math.min(60, settledOf(province)) * 25
      + Math.max(0, 6_000 - development) * 0.3
      - lasting * 1_500
      + (stableHash([polityId, province.id, "works", count]) % 300);
    if (best === null || score > best.score || (score === best.score && province.id < best.province.id)) best = { province, score };
  }
  if (best === null) return null;
  const province = best.province;
  const standing = built.get(province.id);
  const settled = settledOf(province);
  const scar = rows.get(province.id)?.scarBps ?? 0;
  const isCapital = province.id === capital?.id;
  const port = province.settlements.some((settlement) => settlement.kind === "port");
  const fortifiable = province.settlements.some((settlement) => (settlement.kind === "city" || settlement.kind === "port" || settlement.kind === "fortress") && settlement.fortificationLevel < 6);
  const has = (kind: WorkKind): boolean => standing?.has(kind) === true;
  const wanted: { kind: WorkKind; weight: number }[] = [];
  const offer = (kind: WorkKind, ok: boolean, boost = 0): void => { if (ok) wanted.push({ kind, weight: WEIGHT[kind] + boost }); };
  offer("road", !has("road"));
  offer("aqueduct", settled >= 24 && !has("aqueduct"), isCapital ? 2 : 0);
  offer("harbour", port && !has("harbour"), 2);
  offer("walls", fortifiable && !has("walls"), scar > 1_000 ? 2 : 0);
  offer("temple", settled >= 10 && (standing?.get("temple") ?? 0) < 2, scar > 1_000 ? 1 : 0);
  offer("granary", (hubOf(world, province.id) === province.id || settled >= 12) && !has("granary"));
  offer("forum", settled >= 30 && !has("forum"), isCapital ? 2 : 0);
  if (wanted.length === 0) return null;
  const total = wanted.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = stableHash([polityId, province.id, "kind", count]) % total;
  let kind = wanted[0]!.kind;
  for (const entry of wanted) {
    if (pick < entry.weight) { kind = entry.kind; break; }
    pick -= entry.weight;
  }
  // Dearer where the town is bigger and the capital's are grander: from four fifths to a fifth over.
  const grandeur = 0.8 + Math.min(0.4, settled / 150) + (isCapital ? 0.1 : 0);
  const cost = Math.max(LEAST_WORK_COST, Math.round((annualTakings * COST_SHARE[kind] * grandeur) / 100) * 100);
  const place = province.settlements.find((settlement) => settlement.kind === "city" || settlement.kind === "port" || settlement.kind === "town")?.name ?? province.name;
  const made = MADE[kind];
  return { kind, province, name: NAMES[kind](place), structureKind: made.structureKind, effects: made.effects, cost, months: MONTHS[kind], milestones: STAGES[kind] };
}

/** The charge of the works in a power: who lets the contracts, and in what words. Null where nobody holds it (or the player does). */
export function whoLetsTheWorks(world: WorldState, polityId: string, playerCharacterId: string | null): { readonly overseerId: string | null; readonly words: string } | null {
  const holding = readDepartments(world).holding({ kind: "polity", id: polityId }, "public_works_cost");
  if (holding.people.length === 0) return null;
  if (playerCharacterId !== null && holding.people.some((person) => person.id === playerCharacterId)) return null;
  const form = world.constitutions.find((constitution) => constitution.polityId === polityId)?.form;
  const head = holding.head ?? holding.people[0] ?? null;
  const place = world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
  const words = holding.department !== null ? `${holding.department.name} of ${place}`
    : form === "monarchy" ? `The king's steward of works for ${place}`
    : `The magistrates of ${place}`;
  return { overseerId: head === null ? null : head.id, words };
}

/** How many works a power may begin in a year, by what it takes in: one for a small power, two for a great, three for the greatest. */
export function worksAYear(annualTakings: number): number {
  return annualTakings < 300_000 ? 0 : 1 + (annualTakings >= 2_400_000 ? 1 : 0) + (annualTakings >= 12_000_000 ? 1 : 0);
}

