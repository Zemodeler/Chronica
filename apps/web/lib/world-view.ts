import "server-only";

import type {
  ChronicleEntryView,
  GamePhase,
  MaterialWorldViewModel,
  NewsViewModel,
  ProvinceView,
  ScenarioClock,
  WorldState,
  WorldViewModel,
} from "@chronica/shared";
import {
  DisplayPatchSchema,
  NewsViewModelSchema,
  WorldViewModelSchema,
} from "@chronica/shared";
import type { ChronicleView } from "@chronica/db";
import { FIRST_PUNIC_CARTHAGINIAN_OVERLAY, FIRST_PUNIC_SICILY_OVERLAY } from "./first-punic-map-territory";

// Projects real simulation state into the view-model shapes the pages already
// render (packages/shared/src/web.ts), in place of apps/web/lib/game-repository.ts's
// in-memory fixture. Scoped honestly rather than fully: it reports what the world
// state actually contains -- real control, real forces, real balances -- and
// declines to invent the narrative flavour (unrest, rumour age) the fixture used
// to fill the same fields, because nothing in WorldState backs that yet.

const TURN_STATUS_TO_PHASE: Record<string, GamePhase> = {
  collecting: "collecting",
  queued: "queued",
  resolving: "resolving",
  news: "news",
  resolved: "resolved",
  failed: "failed",
  finished: "finished",
};

function toPhase(turnStatus: string): GamePhase {
  return TURN_STATUS_TO_PHASE[turnStatus] ?? "collecting";
}

/**
 * Opening saves created before the geographic-ID migration still contain four
 * abstract Sicilian regions. Keep those snapshots immutable, but render their
 * opening politics on the current five-region map until their first resolved
 * turn creates a newer snapshot.
 */
const LEGACY_FIRST_PUNIC_OPENING_OVERLAY = [
  { provinceId: "ita-72843720b863019116732", controllerPolityId: "rome", controlFirmnessBps: 9_000, terrainId: "coastal-plain", tier: "far" as const },
  ...FIRST_PUNIC_CARTHAGINIAN_OVERLAY,
  ...FIRST_PUNIC_SICILY_OVERLAY,
] as const;

/** Mulberry32 seeded PRNG — deterministic replacement for Math.random(). */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** String → 32-bit integer for seeding. */
function strSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h;
}

type Vec2 = { x: number; y: number; dx: number; dy: number };

/**
 * Fruchterman-Reingold spring-electrical layout.
 * Deterministic: same seed → same positions.
 * Returns positions in a 440 × 220 viewport (matching the SVG viewBox).
 */
function springElectricalLayout(
  ids: readonly string[],
  edges: ReadonlySet<string>,
  seed: string,
  W = 440,
  H = 220,
  iterations = 120,
): Map<string, { x: number; y: number }> {
  const n = ids.length;
  if (n === 0) return new Map();

  const rand = mulberry32(strSeed(seed));
  const nodes: Vec2[] = Array.from({ length: n }, () => ({ x: rand() * W, y: rand() * H, dx: 0, dy: 0 }));

  if (n === 1) {
    const first = nodes[0];
    if (first !== undefined) return new Map([[ids[0] ?? "", { x: W / 2, y: H / 2 }]]);
  }

  const k = Math.sqrt((W * H) / n);

  for (let iter = 0; iter < iterations; iter++) {
    const temp = W * (1 - iter / iterations) * 0.15;
    for (const node of nodes) { node.dx = 0; node.dy = 0; }

    for (let i = 0; i < n; i++) {
      const ni = nodes[i];
      if (ni === undefined) continue;
      for (let j = i + 1; j < n; j++) {
        const nj = nodes[j];
        if (nj === undefined) continue;
        const ddx = ni.x - nj.x;
        const ddy = ni.y - nj.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.1;
        const force = (k * k) / dist;
        ni.dx += (ddx / dist) * force;
        ni.dy += (ddy / dist) * force;
        nj.dx -= (ddx / dist) * force;
        nj.dy -= (ddy / dist) * force;
      }
    }

    for (const edge of edges) {
      const sep = edge.indexOf("-");
      const ai = Number(edge.slice(0, sep));
      const bi = Number(edge.slice(sep + 1));
      const na = nodes[ai];
      const nb = nodes[bi];
      if (na === undefined || nb === undefined) continue;
      const ddx = na.x - nb.x;
      const ddy = na.y - nb.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.1;
      const force = (dist * dist) / k;
      const fx = (ddx / dist) * force;
      const fy = (ddy / dist) * force;
      na.dx -= fx; na.dy -= fy;
      nb.dx += fx; nb.dy += fy;
    }

    for (const node of nodes) {
      const len = Math.sqrt(node.dx * node.dx + node.dy * node.dy) || 1;
      const capped = Math.min(len, temp);
      node.x = Math.max(0, Math.min(W, node.x + (node.dx / len) * capped));
      node.y = Math.max(0, Math.min(H, node.y + (node.dy / len) * capped));
    }
  }

  const margin = 36;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rx = maxX - minX || 1, ry = maxY - minY || 1;
  const result = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    const node = nodes[i];
    if (id === undefined || node === undefined) continue;
    result.set(id, {
      x: Math.round(margin + ((node.x - minX) / rx) * (W - 2 * margin)),
      y: Math.round(margin + ((node.y - minY) / ry) * (H - 2 * margin)),
    });
  }
  return result;
}

export interface WorldViewMeta {
  readonly gameId: string;
  readonly gameTitle: string;
  readonly turnIndex: number;
  readonly turnStatus: string;
  readonly submittedPlayers: number;
  readonly totalPlayers: number;
  readonly lowBandwidth?: boolean;
  readonly clock?: ScenarioClock;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd", "th"][Math.min(n % 10, 4)] ?? "th");
  return `${n}${suffix}`;
}

function dayOfYearToDate(doy: number): { month: number; day: number } {
  let d = Math.max(1, Math.min(365, doy));
  for (let m = 0; m < 12; m++) {
    const dim = MONTH_DAYS[m]!;
    if (d <= dim) return { month: m + 1, day: d };
    d -= dim;
  }
  return { month: 12, day: 31 };
}

/**
 * Project a calendar label from an elapsed simulation-day count. Keeping this
 * separate from the coarse turn step lets the Chronicle place several events
 * on distinct days within a season without changing authoritative time.
 */
export function projectDateLabelAtElapsedDays(daysElapsed: number, clock: ScenarioClock): string {
  const epoch = clock.epoch;
  if (epoch === undefined) return `Step ${Math.floor(daysElapsed * clock.stepsPerYear / 365)}`;
  const epochDoy = MONTH_DAYS.slice(0, epoch.month - 1).reduce((a, b) => a + b, 0) + epoch.day;
  const totalDoy = epochDoy + Math.max(0, Math.floor(daysElapsed));
  const yearsElapsed = Math.floor((totalDoy - 1) / 365);
  const doy = ((totalDoy - 1) % 365) + 1;
  const { month, day } = dayOfYearToDate(doy);
  const signedYear = (epoch.era ?? "CE") === "BCE"
    ? 1 - epoch.year + yearsElapsed
    : epoch.year + yearsElapsed;
  const yearLabel = signedYear <= 0 ? `${1 - signedYear} BCE` : `${signedYear}`;
  return `${ordinal(day)} of ${MONTH_NAMES[month - 1]} ${yearLabel}`;
}

export function projectDateLabel(elapsedStep: number, clock: ScenarioClock): string {
  return projectDateLabelAtElapsedDays(Math.floor(elapsedStep * (365 / clock.stepsPerYear)), clock);
}

/**
 * Convert authoritative conflict state into a self-consistent map overlay.
 * Older snapshots may contain a siege keyed by a province rather than a
 * settlement; render the matching settlement when one exists, and omit
 * unrecoverable stale records so a historic bad workflow can never crash the
 * entire game page.
 */
function projectMapConflicts(world: WorldState) {
  const forceIds = new Set(world.material.forces.map((force) => force.id));
  const polityIds = new Set(world.map.polities.map((polity) => polity.id));
  const settlements = world.map.provinces.flatMap((province) =>
    province.settlements.map((settlement) => ({ settlement, province })),
  );
  const settlementById = new Map(settlements.map(({ settlement }) => [settlement.id, settlement.id]));
  const legacyProvinceTarget = new Map(
    world.map.provinces
      .filter((province) => province.settlements.length === 1)
      .map((province) => [province.id, province.settlements[0]!.id]),
  );

  return {
    battles: world.conflicts.battles.filter((battle) => battle.participantForceIds.every((forceId) => forceIds.has(forceId))),
    sieges: world.conflicts.sieges.flatMap((siege) => {
      const settlementId = settlementById.get(siege.settlementId) ?? legacyProvinceTarget.get(siege.settlementId);
      if (!settlementId || !siege.invadingForceIds.every((forceId) => forceIds.has(forceId)) || !siege.defendingForceIds.every((forceId) => forceIds.has(forceId))) return [];
      return [{ ...siege, settlementId }];
    }),
    wars: world.conflicts.wars.filter((war) => polityIds.has(war.polityAId) && polityIds.has(war.polityBId)),
  };
}

export function projectWorldView(world: WorldState, meta: WorldViewMeta, viewerCharacterId: string): WorldViewModel {
  const polityNames = new Map(world.map.polities.map((polity) => [polity.id, polity.name]));
  const usesLegacyFirstPunicOpening = world.map.provinces.some((province) => province.id === "drepanum");
  const isFirstPunicOpening = world.pins.scenarioId === "00000000-0000-4000-8000-000000000101" && world.elapsedStep === 0;
  const displayProvinces = usesLegacyFirstPunicOpening
    ? [...LEGACY_FIRST_PUNIC_OPENING_OVERLAY]
    : isFirstPunicOpening
      ? [...new Map([...FIRST_PUNIC_CARTHAGINIAN_OVERLAY, ...FIRST_PUNIC_SICILY_OVERLAY, ...world.map.provinces.map((province) => ({ provinceId: province.id, controllerPolityId: province.controllerPolityId, controlFirmnessBps: province.controlFirmnessBps, terrainId: province.terrainId, tier: province.tier }))].map((province) => [province.provinceId, province])).values()]
      : world.map.provinces.map((province) => ({ provinceId: province.id, controllerPolityId: province.controllerPolityId, controlFirmnessBps: province.controlFirmnessBps, terrainId: province.terrainId, tier: province.tier }));

  const edgeSet = new Set<string>();
  const provinceIds = world.map.provinces.map((p) => p.id);
  for (const edge of world.map.edges) {
    const ai = provinceIds.indexOf(edge.from);
    const bi = provinceIds.indexOf(edge.to);
    if (ai >= 0 && bi >= 0) edgeSet.add(`${Math.min(ai, bi)}-${Math.max(ai, bi)}`);
  }
  const layout = springElectricalLayout(provinceIds, edgeSet, meta.gameId);

  const provinces: ProvinceView[] = world.map.provinces.map((province) => {
    const controllerName = province.controllerPolityId === null
      ? "Uncontrolled"
      : polityNames.get(province.controllerPolityId) ?? province.controllerPolityId;
    const stationedForces = world.material.forces.filter((force) => force.locationId === province.id);
    const garrisonLabel = stationedForces.length === 0
      ? "No forces present"
      : `${stationedForces.map((force) => force.name).join(", ")} present`;
    const { x, y } = layout.get(province.id) ?? { x: 220, y: 110 };

    return {
      id: province.id,
      name: province.name,
      controller: controllerName,
      terrain: province.terrainId,
      tier: province.tier,
      controlLabel: province.controllerPolityId === null
        ? "Uncontrolled ground"
        : `${(province.controlFirmnessBps / 100).toFixed(0)}% controlled by ${controllerName}`,
      garrisonLabel,
      unrestLabel: "No unrest data available yet",
      knowledgeLabel: `Current as of turn ${meta.turnIndex}`,
      x,
      y,
      neighbours: world.map.edges
        .filter((edge) => edge.from === province.id || edge.to === province.id)
        .map((edge) => {
          const neighbourId = edge.from === province.id ? edge.to : edge.from;
          const neighbour = world.map.provinces.find((candidate) => candidate.id === neighbourId);
          return { provinceId: neighbourId, provinceName: neighbour?.name ?? neighbourId, crossing: edge.crossing };
        }),
      actions: [
        { id: `inspect-${province.id}`, label: `Inspect ${province.name}`, href: `#province-${province.id}` },
        {
          id: `order-${province.id}`,
          label: `Write an order concerning ${province.name}`,
          href: `/games/${meta.gameId}/orders?province=${province.id}`,
        },
      ],
    };
  });

  const armies = world.material.forces.map((force) => {
    const location = world.map.provinces.find((province) => province.id === force.locationId)?.name ?? force.locationId;
    const commander = world.characters.find((character) => character.id === force.commanderCharacterId)?.name
      ?? force.commanderCharacterId;
    const fit = force.personnel.reduce((total, category) => total + category.fit, 0);
    const unavailable = force.personnel.reduce(
      (total, category) => total + category.unavailable.reduce((sum, entry) => sum + entry.count, 0),
      0,
    );
    return {
      id: force.id,
      name: force.name,
      location,
      commander,
      strengthLabel: `${fit + unavailable} total; ${fit} fit`,
      currentOrder: "Awaiting orders",
    };
  });
  const mapConflicts = projectMapConflicts(world);
  const besiegedSettlementIds = new Set(mapConflicts.sieges.map((siege) => siege.settlementId));

  return WorldViewModelSchema.parse({
    gameId: meta.gameId,
    gameTitle: meta.gameTitle,
    phase: toPhase(meta.turnStatus),
    turnIndex: meta.turnIndex,
    elapsedStepLabel: meta.clock !== undefined ? projectDateLabel(world.elapsedStep, meta.clock) : `Step ${world.elapsedStep}`,
    submittedPlayers: meta.submittedPlayers,
    totalPlayers: meta.totalPlayers,
    lowBandwidth: meta.lowBandwidth ?? false,
    mapOverlay: {
      revision: meta.turnIndex,
      polities: usesLegacyFirstPunicOpening
        ? [{ polityId: "rome", name: "Roman Republic" }, { polityId: "carthage", name: "Carthage" }, { polityId: "syracuse", name: "Kingdom of Syracuse" }]
        : world.map.polities.map((polity) => ({ polityId: polity.id, name: polity.name })),
      provinces: displayProvinces,
      settlements: world.map.provinces.flatMap((province) => province.settlements.map((settlement) => {
        const capitalPolity = world.map.polities.find((polity) => polity.capitalSettlementId === settlement.id);
        return {
          settlementId: settlement.id,
          provinceId: province.id,
          anchorFeatureId: settlement.id,
          name: settlement.name,
          kind: settlement.kind,
          controllerPolityId: settlement.controllerPolityId,
          capitalPolityId: capitalPolity?.id ?? null,
          importance: settlement.size,
          underSiege: besiegedSettlementIds.has(settlement.id),
          damaged: false,
        };
      })),
      forces: world.material.forces.map((force) => {
        const fit = force.personnel.reduce((total, category) => total + category.fit, 0);
        const unavailable = force.personnel.reduce((total, category) => total + category.unavailable.reduce((sum, entry) => sum + entry.count, 0), 0);
        const commander = world.characters.find((character) => character.id === force.commanderCharacterId)?.name ?? force.commanderCharacterId;
        return {
          forceId: force.id,
          provinceId: force.locationId,
          ownerPolityId: force.polityId,
          name: force.name,
          commanderLabel: commander,
          strengthLabel: `${fit + unavailable} total; ${fit} fit`,
          relation: "unknown" as const,
          selected: false,
          movement: null,
        };
      }),
      conflicts: mapConflicts,
    },
    provinces,
    armies,
    material: projectMaterialView(world, viewerCharacterId),
    ongoingActions: world.actions,
  } satisfies WorldViewModel);
}

function projectMaterialView(world: WorldState, viewerCharacterId: string): MaterialWorldViewModel {
  const character = world.characters.find((candidate) => candidate.id === viewerCharacterId);
  const personalAccount = world.material.accounts.find((account) => account.id === character?.personalAccountId);
  const personalAccess = world.material.accountAccess.find(
    (access) => access.characterId === viewerCharacterId && access.accountId === personalAccount?.id,
  );
  const treasuryAccess = world.material.accountAccess.filter(
    (access) => access.characterId === viewerCharacterId && access.accountId !== personalAccount?.id,
  );
  const holdings = world.material.holdings.filter((holding) => holding.legalHolderCharacterId === viewerCharacterId);
  const income = world.material.incomeSources.filter((source) => source.beneficiaryAccountId === personalAccount?.id);
  const forces = world.material.forces.filter((force) => force.controllerCharacterId === viewerCharacterId);
  const institution = world.material.institutions[0];

  return {
    characterName: character?.name ?? "Unknown character",
    currencyName: world.material.currency.name,
    currencySymbol: undefined,
    personalAccount: {
      id: personalAccount?.id ?? "no-account",
      label: "Your personal purse",
      balance: personalAccount?.balance ?? 0,
      permissions: personalAccess?.permissions ?? [],
      status: personalAccount?.status ?? "active",
      recentChanges: world.material.transactions
        .filter((transaction) => transaction.destinationAccountId === personalAccount?.id || transaction.sourceAccountId === personalAccount?.id)
        .map((transaction) => ({
          id: transaction.id,
          label: transaction.cause.explanation,
          amount: transaction.destinationAccountId === personalAccount?.id ? transaction.amount : -transaction.amount,
          whenLabel: `Step ${transaction.atStep}`,
        })),
    },
    accessibleTreasuries: treasuryAccess.map((access) => {
      const account = world.material.accounts.find((candidate) => candidate.id === access.accountId);
      return {
        id: access.accountId,
        label: account !== undefined && account.owner.kind === "polity" ? "Royal treasury" : access.accountId,
        balance: account?.balance ?? 0,
        permissions: access.permissions,
        status: account?.status ?? "active",
        recentChanges: [],
      };
    }),
    income: income.map((source) => ({
      id: source.id,
      label: source.label,
      amount: source.amount,
      cadenceLabel: `every ${source.cadenceSteps} steps`,
      nextDueLabel: `Step ${source.nextDueStep}`,
      collectionStatus: source.active ? "collectible" : "suspended",
    })),
    holdings: holdings.map((holding) => ({
      id: holding.id,
      title: holding.title,
      territoryLabel: world.map.provinces.find((province) => province.id === holding.territoryId)?.name ?? holding.territoryId,
      controlLabel: `${(holding.physicalControlBps / 100).toFixed(0)}% under direct control`,
      incomeLabel: "See income for the amount and cadence",
    })),
    government: {
      institutionName: institution?.name ?? "No institution",
      reservedPowers: world.material.reservedPowers.map((power) => power.category),
      motionStatus: "none",
      blocs: (institution?.votingBlocs ?? []).map((bloc) => ({
        id: bloc.id,
        name: bloc.name,
        weight: bloc.weight,
        vote: "not_cast" as const,
        reason: "No vote has been called yet.",
      })),
    },
    forces: forces.map((force) => {
      const fit = force.personnel.reduce((total, category) => total + category.fit, 0);
      const unavailable = force.personnel.reduce(
        (total, category) => total + category.unavailable.reduce((sum, entry) => sum + entry.count, 0),
        0,
      );
      return {
        id: force.id,
        name: force.name,
        authorizedStrength: force.authorizedStrength,
        totalHeadcount: fit + unavailable,
        fitStrength: fit,
        effectiveStrength: fit,
        unavailable,
        provisionLabel: force.provisionStatus,
        provisionedThroughLabel: `Step ${force.provisionedThroughStep}`,
        payStatus: force.payArrearsPeriods > 0 ? `${force.payArrearsPeriods} pay periods in arrears` : "Paid",
        changeExplanation: "No change recorded yet this turn.",
      };
    }),
    orderReadback: { payerLabel: "No order pending", cost: 0, approvalLabel: "No approval required." },
    visibility: "private",
  } satisfies MaterialWorldViewModel;
}

export function projectNewsView(
  chronicle: ChronicleView,
  meta: {
    readonly gameId: string;
    readonly readyPlayers: number;
    readonly totalPlayers: number;
    readonly currentPlayerReady: boolean;
    readonly chronicleReadSequence?: number;
  },
): NewsViewModel {
  const entries: ChronicleEntryView[] = chronicle.entries.map((entry) => {
    const patchResult = DisplayPatchSchema.safeParse(entry.displayPatch);
    return {
      id: entry.id,
      sequence: entry.sequence,
      title: entry.audience === "all_players" ? "Reported to all players" : "Reported through your position",
      body: entry.body,
      audience: entry.audience,
      characterKnows: entry.audience !== "knowledge_scoped",
      involvementLabel: entry.audience === "knowledge_scoped"
        ? "Visible through your character's position."
        : "Reported to all players.",
      materialConsequence: entry.materialConsequence ?? false,
      displayPatch: patchResult.success ? patchResult.data : undefined,
      dateLabel: chronicle.scenarioClock === undefined
        ? `Step ${entry.atStep}`
        : projectDateLabel(entry.atStep, chronicle.scenarioClock),
    };
  });

  return NewsViewModelSchema.parse({
    gameId: meta.gameId,
    turnIndex: chronicle.turnIndex,
    phase: chronicle.gameStatus === "finished" ? "finished" : "news",
    entries,
    readyPlayers: meta.readyPlayers,
    totalPlayers: meta.totalPlayers,
    currentPlayerReady: meta.currentPlayerReady,
    ...(meta.chronicleReadSequence === undefined ? {} : { chronicleReadSequence: meta.chronicleReadSequence }),
  } satisfies NewsViewModel);
}

