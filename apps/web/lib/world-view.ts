import "server-only";

import type {
  ChronicleEntryView,
  ConversationsViewModel,
  ConversationThreadView,
  DialogueChannel,
  GamePhase,
  MaterialWorldViewModel,
  NewsViewModel,
  ProvinceView,
  ScenarioClock,
  WorldState,
  WorldViewModel,
} from "@chronica/shared";
import {
  ConversationsViewModelSchema,
  DialogueMessageSchema,
  DisplayPatchSchema,
  NewsViewModelSchema,
  WorldViewModelSchema,
} from "@chronica/shared";
import type { ChronicleView, ContactRow, MessageRow } from "@chronica/db";

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

export function projectDateLabel(elapsedStep: number, clock: ScenarioClock): string {
  const epoch = clock.epoch;
  if (epoch === undefined) return `Step ${elapsedStep}`;
  const epochDoy = MONTH_DAYS.slice(0, epoch.month - 1).reduce((a, b) => a + b, 0) + epoch.day;
  const daysElapsed = Math.floor(elapsedStep * (365 / clock.stepsPerYear));
  const totalDoy = epochDoy + daysElapsed;
  const yearsElapsed = Math.floor((totalDoy - 1) / 365);
  const doy = ((totalDoy - 1) % 365) + 1;
  const { month, day } = dayOfYearToDate(doy);
  const signedYear = (epoch.era ?? "CE") === "BCE"
    ? 1 - epoch.year + yearsElapsed
    : epoch.year + yearsElapsed;
  const yearLabel = signedYear <= 0 ? `${1 - signedYear} BCE` : `${signedYear}`;
  return `${ordinal(day)} of ${MONTH_NAMES[month - 1]} ${yearLabel}`;
}

export function projectWorldView(world: WorldState, meta: WorldViewMeta, viewerCharacterId: string): WorldViewModel {
  const polityNames = new Map(world.map.polities.map((polity) => [polity.id, polity.name]));

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
      polities: world.map.polities.map((polity) => ({ polityId: polity.id, name: polity.name })),
      provinces: world.map.provinces.map((province) => ({
        provinceId: province.id,
        controllerPolityId: province.controllerPolityId,
        controlFirmnessBps: province.controlFirmnessBps,
        terrainId: province.terrainId,
        tier: province.tier,
      })),
      settlements: world.map.provinces.flatMap((province) => province.settlements.map((settlement) => {
        const capitalPolity = world.map.polities.find((polity) => polity.capitalSettlementId === settlement.id);
        return {
          settlementId: settlement.id,
          provinceId: province.id,
          anchorFeatureId: settlement.id,
          name: settlement.name,
          kind: settlement.kind,
          controllerPolityId: province.controllerPolityId,
          capitalPolityId: capitalPolity?.id ?? null,
          importance: settlement.size,
          underSiege: false,
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
      conflicts: world.conflicts,
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
        .filter((transaction) => transaction.destinationAccountId === personalAccount?.id)
        .map((transaction) => ({
          id: transaction.id,
          label: transaction.cause.explanation,
          amount: transaction.amount,
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

const CHANNEL_LABELS: Record<DialogueChannel, string> = {
  in_person_private: "private conversation in person",
  in_person_public: "public conversation in person",
  audience: "formal audience",
  messenger: "message carried by a messenger",
  correspondence: "written correspondence",
};

/** Maps durable worker failure categories to safe, useful player copy. */
export function dialogueFailureMessage(acts: unknown): string {
  const reason = typeof acts === "object" && acts !== null && "failureReason" in acts
    ? (acts as { failureReason?: unknown }).failureReason
    : undefined;
  if (typeof reason !== "string") return "The reply service could not deliver a response. You may try again.";

  if (/no longer collecting|turn is resolving|session closed|earlier turn|no longer in the world/iu.test(reason)) {
    return "This conversation belonged to an earlier turn and cannot receive a reply. Open the contact again in this turn.";
  }
  if (/payment|credit/iu.test(reason)) {
    return "Replies are paused until the host adds funds to this match.";
  }
  return "The reply service could not deliver a response. You may try again.";
}

export function projectConversationsView(
  gameId: string,
  playerCharacterId: string,
  contacts: readonly ContactRow[],
  active: { readonly threadId: string; readonly npcName: string; readonly roleLabel: string; readonly channel: DialogueChannel; readonly messages: readonly MessageRow[] } | null,
  /**
   * Real name/role per npcCharacterId, when known -- from the generated cast
   * or the current world's characters. A contact whose npcCharacterId isn't
   * in here (e.g. a stale/legacy thread) falls back to the raw id, same as
   * before this lookup existed.
   */
  identity?: ReadonlyMap<string, { readonly name: string; readonly roleLabel: string }>,
): ConversationsViewModel {
  const replyInFlight = active?.messages.some(
    (message) => message.speakerCharacterId === playerCharacterId && (message.status === "pending" || message.status === "claimed"),
  ) ?? false;
  // Only the most recent message matters here: the server (sendPlayerDialogueMessage)
  // never blocks a new send on a past failure, only on a reply still in flight, so
  // an old failure must not linger as a notice once a later message went through.
  const lastMessage = active?.messages.at(-1);
  const failedMessage = lastMessage?.speakerCharacterId === playerCharacterId && lastMessage.status === "failed"
    ? lastMessage
    : undefined;
  const activeThread: ConversationThreadView | null = active === null ? null : {
    threadId: active.threadId,
    knownName: active.npcName,
    roleLabel: active.roleLabel,
    channelLabel: CHANNEL_LABELS[active.channel],
    elapsedStepLabel: "This turn",
    pending: replyInFlight,
    // Informational, not a lock: the composer stays open so retrying is just
    // sending a new message, matching what the server actually enforces.
    readOnlyReason: failedMessage === undefined ? null : dialogueFailureMessage(failedMessage.acts),
    messages: active.messages.map((message) => {
      const parsed = DialogueMessageSchema.safeParse({
        id: message.id,
        sessionId: message.sessionId,
        sequence: message.sequence,
        speakerCharacterId: message.speakerCharacterId,
        body: message.body,
        acts: message.acts,
        disclosedFactIds: message.disclosedFactIds,
      });
      // A malformed legacy payload must not make the conversation unreadable.
      // It contributes no structured claims until a canonical worker reply does.
      return parsed.success
        ? parsed.data
        : { id: message.id, sessionId: message.sessionId, sequence: message.sequence, speakerCharacterId: message.speakerCharacterId, body: message.body, acts: [], disclosedFactIds: [] };
    }),
  };

  return ConversationsViewModelSchema.parse({
    gameId,
    playerCharacterId,
    // A failed message is terminal, so it never blocks a retry. For a prior
    // turn the send transaction creates a fresh turn-scoped session first.
    canSend: activeThread !== null && !replyInFlight,
    contacts: contacts.map((contact) => {
      const known = contact.npcCharacterId === null ? undefined : identity?.get(contact.npcCharacterId);
      const isResolving = contact.status === "resolving_contact";
      return {
        threadId: contact.threadId,
        // For resolving_contact sessions, show the original role query as the
        // contact name while the worker finds the real NPC.
        knownName: known?.name ?? (isResolving ? contact.roleQuery : null) ?? contact.npcCharacterId ?? "Unknown contact",
        roleLabel: isResolving
          ? "Searching..."
          : contact.status !== "open"
            ? (contact.status === "closed" ? "Conversation closed" : "Contact unavailable")
            : known?.roleLabel ?? "Contact",
        channel: contact.channel,
        unread: 0,
        pending: isResolving,
      };
    }),
    activeThread,
  } satisfies ConversationsViewModel);
}
