import "server-only";

/* eslint-disable @typescript-eslint/require-await -- the fixture preserves the asynchronous packages/db contract while resolving in memory */

import {
  AccountDashboardViewModelSchema,
  CharacterClaimSchema,
  GameCreationSchema,
  LobbyViewModelSchema,
  NewsViewModelSchema,
  OrderBatchSchema,
  OrdersStatusResponseSchema,
  ResolvedRoleSchema,
  WorldViewModelSchema,
  type AccountDashboardViewModel,
  type CharacterClaim,
  type DynamicMapOverlay,
  type GameCreation,
  type LobbyViewModel,
  type NewsViewModel,
  type OrderBatch,
  type OrdersStatusResponse,
  type PatchUiStateRequest,
  type WorldViewModel,
} from "@chronica/shared";
import { MICRO_UNITS_PER_COIN } from "@chronica/billing";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import {
  acknowledgeTurnNews,
  claimCharacter as claimCharacterQuery,
  countActiveHostedGames,
  createDatabase,
  createGame as createGameQuery,
  deleteOwnedGame,
  ensureBuiltInScenarios,
  FIRST_PUNIC_WAR_SCENARIO_ID as PERSISTED_FIRST_PUNIC_WAR_SCENARIO_ID,
  findPublicScenario,
  getAccountProfile,
  getActiveCharacterClaimForPlayer,
  getGameRevision as getGameRevisionQuery,
  getSharedDatabase,
  getChronicleForLatestTurn,
  getLatestTurnEventMeta as getLatestTurnEventMetaQuery,
  getPlayerGameUiState,
  getPlayerOrderForOpenTurn,
  getWorldView,
  listHostedGames as listHostedGamesQuery,
  listJoinedGames as listJoinedGamesQuery,
  listPublicScenarios as listPublicScenariosQuery,
  requestGameEnd,
  resumePaymentPausedGame,
  schema,
  SlotCapError,
  submitPlayerOrder,
  upsertPlayerGameUiState,
  type GameSummaryRow,
  type PublicScenarioSummary,
} from "@chronica/db";
import { demoMaterialView } from "./demo-material-view";
import { builtInScenarioMap } from "./built-in-scenario-maps";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { projectNewsView, projectWorldView } from "./world-view";
import { punicWarsGeoJson } from "./punic-wars-geojson";
import { punicWarsOpeningOverlay } from "./punic-wars-map-territory";

/**
 * The preserved, resettable product demo.  This is deliberately distinct from
 * the First Punic War scenario below: the latter can be hosted as a game,
 * while this remains a stable place for trying the interface.
 */
export const DEMO_GAME_ID = "DEMO";
export const DEMO_PLAYER_ID = "player-host";
export const FIRST_PUNIC_WAR_SCENARIO_ID = PERSISTED_FIRST_PUNIC_WAR_SCENARIO_ID;

export type Viewer = Readonly<{
  userId: string;
  playerId: string;
  displayName: string;
  email: string;
  role: "user" | "developer" | "admin";
}>;

const fixtureViewer: Viewer = {
  userId: "user-host",
  playerId: DEMO_PLAYER_ID,
  displayName: "Alex Morgan",
  email: "host@example.test",
  role: "admin",
};

const initialWorld = WorldViewModelSchema.parse({
  gameId: DEMO_GAME_ID,
  gameTitle: "DEMO",
  phase: "collecting",
  turnIndex: 1,
  elapsedStepLabel: "spring, 264 BCE",
  submittedPlayers: 0,
  totalPlayers: 1,
  lowBandwidth: false,
  provinces: [
    {
      id: "drepanum",
      name: "Drepanum",
      controller: "Roman Republic",
      terrain: "Coastal plain",
      tier: "focus",
      controlLabel: "Contested Roman control",
      garrisonLabel: "Roman army: 4,310 people",
      unrestLabel: "High unrest along the western road",
      knowledgeLabel: "Current report from your own station",
      x: 110,
      y: 90,
      neighbours: [
        { provinceId: "palermo", provinceName: "Palermo", crossing: "land" },
        { provinceId: "agrigentum", provinceName: "Agrigentum", crossing: "land" },
      ],
      actions: [
        { id: "inspect-drepanum", label: "Inspect Drepanum", href: `#province-drepanum` },
        { id: "order-drepanum", label: "Write an order concerning Drepanum", href: `/${"games"}/${DEMO_GAME_ID}/orders?province=drepanum` },
      ],
    },
    {
      id: "palermo",
      name: "Palermo",
      controller: "Roman Republic",
      terrain: "Hills and harbour",
      tier: "focus",
      controlLabel: "Firm Roman control",
      garrisonLabel: "City watch and harbour guard",
      unrestLabel: "Low unrest",
      knowledgeLabel: "Current parliamentary reports",
      x: 250,
      y: 55,
      neighbours: [
        { provinceId: "drepanum", provinceName: "Drepanum", crossing: "land" },
        { provinceId: "messina", provinceName: "Messina", crossing: "land" },
      ],
      actions: [
        { id: "inspect-palermo", label: "Inspect Palermo", href: "#province-palermo" },
        { id: "order-palermo", label: "Write an order concerning Palermo", href: `/${"games"}/${DEMO_GAME_ID}/orders?province=palermo` },
      ],
    },
    {
      id: "agrigentum",
      name: "Agrigentum",
      controller: "Carthage",
      terrain: "Dry uplands",
      tier: "near",
      controlLabel: "Reported Carthaginian control",
      garrisonLabel: "Strength uncertain",
      unrestLabel: "Reports of requisitioning",
      knowledgeLabel: "Report is one step old",
      x: 230,
      y: 190,
      neighbours: [
        { provinceId: "drepanum", provinceName: "Drepanum", crossing: "land" },
        { provinceId: "messina", provinceName: "Messina", crossing: "pass" },
      ],
      actions: [
        { id: "inspect-agrigentum", label: "Inspect Agrigentum", href: "#province-agrigentum" },
        { id: "order-agrigentum", label: "Write an order concerning Agrigentum", href: `/${"games"}/${DEMO_GAME_ID}/orders?province=agrigentum` },
      ],
    },
    {
      id: "messina",
      name: "Messina",
      controller: "Roman Republic",
      terrain: "Mountain strait",
      tier: "far",
      controlLabel: "Last known Roman control",
      garrisonLabel: "No current strength report",
      unrestLabel: "Unknown",
      knowledgeLabel: "Last confirmed three steps ago",
      x: 390,
      y: 115,
      neighbours: [
        { provinceId: "palermo", provinceName: "Palermo", crossing: "land" },
        { provinceId: "agrigentum", provinceName: "Agrigentum", crossing: "pass" },
      ],
      actions: [
        { id: "inspect-messina", label: "Inspect Messina", href: "#province-messina" },
        { id: "order-messina", label: "Write an order concerning Messina", href: `/${"games"}/${DEMO_GAME_ID}/orders?province=messina` },
      ],
    },
  ],
  armies: [
    {
      id: "force-royal-host",
      name: "Roman expeditionary force",
      location: "Messina",
      commander: "Marcus Atilius",
      strengthLabel: "3,200 total; 3,200 fit",
      currentOrder: "Holding the strait, awaiting orders",
    },
  ],
  material: demoMaterialView,
  ongoingActions: [],
});

const initialLobby = LobbyViewModelSchema.parse({
  gameId: DEMO_GAME_ID,
  title: "DEMO",
  hostName: fixtureViewer.displayName,
  startingSeatCount: 5,
  occupiedSeatCount: 0,
  extraPrincipalsPerPlayer: 1,
  principalCapacity: 9,
  inviteUrl: `/join/invite-sicily-demo`,
  characters: [
    {
      id: "marcus-atilius",
      name: "Marcus Atilius",
      pitch: "A count and marshal trying to hold a divided kingdom together.",
      station: "Count and royal marshal",
      location: "Messina",
      claimedByPlayerId: null,
    },
    {
      id: "bianca-palermo",
      name: "Bianca of Palermo",
      pitch: "A chartered merchant with ships, creditors and influence in parliament.",
      station: "Guild elder",
      location: "Palermo",
      claimedByPlayerId: null,
    },
    {
      id: "yusuf-trapani",
      name: "Yusuf al-Trabunishi",
      pitch: "An interpreter whose correspondence reaches both sides of the strait.",
      station: "Court interpreter",
      location: "Drepanum",
      claimedByPlayerId: null,
    },
    {
      id: "agata-agrigentum",
      name: "Agata of Agrigentum",
      pitch: "A landholder caught between royal demands and the rebel league.",
      station: "Rural landholder",
      location: "Agrigentum",
      claimedByPlayerId: null,
    },
  ],
});

const initialNews = NewsViewModelSchema.parse({
  gameId: DEMO_GAME_ID,
  turnIndex: 0,
  phase: "news",
  readyPlayers: 0,
  totalPlayers: 1,
  currentPlayerReady: false,
  entries: [
    {
      id: "news-opening",
      sequence: 0,
      title: "The crisis in the strait begins",
      body: "Spring, 264 BCE. Roman forces stand at the northern tip of Italy; Carthaginian ships patrol the western sea. The Mamertines hold Messana by treaty and force, and every power with an interest watches the strait. Your orders will determine what happens next.",
      audience: "all_players",
      characterKnows: true,
      involvementLabel: "You are present in Sicily from the first day.",
      materialConsequence: false,
      dateLabel: "1st of March 264 BCE",
    },
  ],
});


const initialAccount = AccountDashboardViewModelSchema.parse({
  displayName: fixtureViewer.displayName,
  email: fixtureViewer.email,
  emailVerified: true,
  username: null,
  avatarKey: "laurel",
  role: fixtureViewer.role,
  availableCoins: "2400",
  heldCoins: "180",
  debtCoins: "0",
  lots: [
    {
      id: "lot-playtest",
      sourceLabel: "Playtest gift",
      remainingCoins: "900",
      heldCoins: "180",
      expiresLabel: "31 August 2027",
    },
    {
      id: "lot-pack",
      sourceLabel: "Credit pack",
      remainingCoins: "1500",
      heldCoins: "0",
      expiresLabel: "Does not expire",
    },
  ],
  history: [
    { id: "ledger-gift", whenLabel: "18 August 2026", kind: "Grant", amountLabel: "+900 credits", reason: "Playtest gift redeemed" },
    { id: "ledger-hold", whenLabel: "19 August 2026", kind: "Hold", amountLabel: "−180 available", reason: "The Sicilian Crisis, pending work" },
  ],
  pausedGames: [
    { gameId: "paused-demo", title: "The Baltic Succession", requiredCoins: "320" },
  ],
  hostedSaves: [],
  joinedSaves: [],
});

type StoreState = {
  world: WorldViewModel;
  lobby: LobbyViewModel;
  news: NewsViewModel;
  account: AccountDashboardViewModel;
  createdGift: string | null;
  hostedDemo: boolean;
  revision: number;
  /** In-memory analogue of `player_game_ui_state` -- durable only for the process lifetime. */
  uiState: { selectedThreadId: string | null; chronicleReadSequence: number };
  /** The last order batch submitted for the currently-open turn, cleared when a new turn opens. */
  submittedBatch: OrderBatch | null;
  characterDeclaration: CharacterDeclarationStatus;
  scenarioId: string;
};

const createState = (): StoreState => ({
  world: structuredClone(initialWorld),
  lobby: structuredClone(initialLobby),
  news: structuredClone(initialNews),
  account: structuredClone(initialAccount),
  createdGift: null,
  hostedDemo: false,
  revision: initialWorld.turnIndex,
  uiState: { selectedThreadId: null, chronicleReadSequence: -1 },
  submittedBatch: null,
  characterDeclaration: { status: "none" },
  scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID,
});

const storeHolder = globalThis as typeof globalThis & { chronicaFixtureStore?: StoreState };
const state = storeHolder.chronicaFixtureStore ?? createState();
storeHolder.chronicaFixtureStore = state;

function fixtureConnectedPlayerCount(): number {
  // Hosting creates the host's active seat before their free-text declaration.
  return Math.max(1, state.lobby.characters.filter((character) => character.claimedByPlayerId !== null).length);
}

function demoMapOverlay(revision: number): DynamicMapOverlay {
  const opening = punicWarsOpeningOverlay(revision);
  return {
    revision,
    polities: opening.polities,
    politicalRelations: opening.politicalRelations,
    provinces: opening.provinces,
    settlements: opening.settlements,
    forces: [
      {
        forceId: demoMaterialView.forces[0]!.id,
        provinceId: "ita-72843720b81376294924159-sicily-west",
        coordinate: [14.1, 37.45],
        ownerPolityId: "rome",
        name: demoMaterialView.forces[0]!.name,
        commanderLabel: "Roman commander",
        strengthLabel: `${demoMaterialView.forces[0]!.totalHeadcount.toLocaleString()} total; ${demoMaterialView.forces[0]!.fitStrength.toLocaleString()} fit`,
        relation: "friendly",
        flagAssetId: "legio-i-adiutrix",
        selected: false,
        movement: null,
      },
      {
        forceId: "carthaginian-army-sicily",
        provinceId: "ita-72843720b81376294924159-sicily-west",
        coordinate: [14.28, 37.38],
        ownerPolityId: "carthage",
        name: "Carthaginian Army of Sicily",
        commanderLabel: "Hanno",
        strengthLabel: "3,000 total; 2,850 fit",
        relation: "hostile",
        selected: false,
        movement: null,
      },
      {
        forceId: demoMaterialView.forces[1]!.id,
        provinceId: "ita-72843720b81376294924159",
        coordinate: [9.18, 39.28],
        ownerPolityId: "rome",
        name: demoMaterialView.forces[1]!.name,
        commanderLabel: "Roman siege commander",
        strengthLabel: `${demoMaterialView.forces[1]!.totalHeadcount.toLocaleString()} total; ${demoMaterialView.forces[1]!.fitStrength.toLocaleString()} fit`,
        relation: "friendly",
        flagAssetId: "eagle",
        selected: false,
        movement: null,
      },
    ],
    conflicts: {
      battles: [{
        battleId: "first-punic-battle-in-sicily",
        participantForceIds: [demoMaterialView.forces[0]!.id, "carthaginian-army-sicily"],
        attackerForceIds: [demoMaterialView.forces[0]!.id],
      }],
      sieges: [{ settlementId: "settlement-caralis", invadingForceIds: [demoMaterialView.forces[1]!.id], defendingForceIds: [] }],
      wars: [{ polityAId: "carthage", polityBId: "rome" }],
    },
  };
}

export type { GameSummaryRow };
export type { PublicScenarioSummary };

/**
 * Built-in scenarios are the production-facing copies of fixture material.
 * They must not carry the demo name or identifier: a hosted game is a real
 * scenario run, even when this local adapter is used without Postgres.
 */
const BUILT_IN_SCENARIOS: readonly PublicScenarioSummary[] = [
  {
    scenarioId: FIRST_PUNIC_WAR_SCENARIO_ID,
    version: 1,
    title: "The Numidian Decision",
    period: "264 BCE · First Punic War",
    authorName: "Chronica",
    recommendedPlayers: 1,
  },
];

function findBuiltInScenario(scenarioId: string): PublicScenarioSummary | null {
  return BUILT_IN_SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId) ?? null;
}

/**
 * Status of a player's character declaration -- defined locally rather than in
 * `packages/shared` because that package is locked for this phase. `"failed"`
 * has no trigger path from a well-formed worker write today (there is no
 * failure-marker column on `character_claims`); it is included only so a
 * malformed `resolvedRole` payload (defensive `ResolvedRoleSchema.safeParse`
 * failure) and any future real failure path have somewhere to land.
 */
export type CharacterDeclarationStatus =
  | { readonly status: "none" }
  | { readonly status: "pending" }
  | {
      readonly status: "ready";
      readonly cast: readonly { readonly npcCharacterId: string; readonly knownName: string; readonly roleLabel: string }[];
      readonly openingEvent: { readonly title: string; readonly body: string };
    }
  | { readonly status: "failed"; readonly reason: string };

/** A short title derived from a generated opening event's summary: the first sentence, capped at 60 characters. */
function deriveOpeningTitle(summary: string): string {
  const firstSentenceMatch = /^[^.!?]*[.!?]/.exec(summary);
  const firstSentence = (firstSentenceMatch?.[0] ?? summary).trim();
  return firstSentence.length > 60 ? `${firstSentence.slice(0, 57).trimEnd()}...` : firstSentence;
}

export interface GameRepository {
  getViewer(): Promise<Viewer>;
  listGames(): Promise<{ hosted: GameSummaryRow[]; joined: GameSummaryRow[]; activeHostedCount: number }>;
  listPublicScenarios(): Promise<readonly PublicScenarioSummary[]>;
  getPublicScenario(scenarioId: string): Promise<PublicScenarioSummary | null>;
  createGame(input: GameCreation): Promise<string>;
  needsCharacterDeclaration(gameId: string): Promise<boolean>;
  getLobby(gameId: string): Promise<LobbyViewModel | null>;
  claimCharacter(gameId: string, playerId: string, claim: CharacterClaim): Promise<"claimed" | "already_claimed">;
  requestCharacterDeclaration(gameId: string, declaration: string): Promise<{ status: "pending" }>;
  getCharacterDeclarationStatus(gameId: string): Promise<CharacterDeclarationStatus>;
  getWorld(gameId: string, lowBandwidth?: boolean, omitGeo?: boolean): Promise<WorldViewModel | null>;
  /** Cheap change token used by the live stream before loading any world data. */
  getGameRevision(gameId: string): Promise<number>;
  /** Narrow, cheap read of the latest resolved turn's map-affecting region changes, for live-event patching. */
  getLatestTurnEventMeta(gameId: string): Promise<{ changedRegionIds: readonly string[] } | null>;
  submitOrders(gameId: string, batch: OrderBatch): Promise<void>;
  getOrdersStatus(gameId: string): Promise<OrdersStatusResponse | null>;
  getNews(gameId: string): Promise<NewsViewModel | null>;
  acknowledgeNews(gameId: string): Promise<void>;
  patchUiState(gameId: string, patch: PatchUiStateRequest): Promise<void>;
  getAccount(): Promise<AccountDashboardViewModel>;
  redeemGift(code: string): Promise<"redeemed" | "invalid">;
  checkout(productSlug: string): Promise<string | null>;
  resumeGame(gameId: string): Promise<boolean>;
  createGift(grantCredits: number, maxRedemptions: number, note: string): Promise<string>;
  consumeCreatedGift(): Promise<string | null>;
  endGame(gameId: string): Promise<void>;
  deleteSave(gameId: string): Promise<boolean>;
}

export const fixtureGameRepository: GameRepository = {
  async getViewer() {
    return fixtureViewer;
  },
  async listGames() {
    return {
      hosted: state.hostedDemo ? [{ gameId: DEMO_GAME_ID, title: state.world.gameTitle, status: "active" }] : [],
      joined: [],
      activeHostedCount: state.hostedDemo ? 1 : 0,
    };
  },
  async listPublicScenarios() {
    return BUILT_IN_SCENARIOS;
  },
  async getPublicScenario(scenarioId) {
    return findBuiltInScenario(scenarioId);
  },
  async createGame(input) {
    const parsed = GameCreationSchema.parse(input);
    if (findBuiltInScenario(parsed.scenarioId) === null) throw new Error("Unknown built-in scenario.");
    state.lobby = LobbyViewModelSchema.parse({
      ...state.lobby,
      title: parsed.title,
      occupiedSeatCount: 1,
      characters: state.lobby.characters.map((character, index) => index === 0 ? { ...character, claimedByPlayerId: null } : character),
      extraPrincipalsPerPlayer: parsed.continuity.extraPrincipalsPerPlayer,
      principalCapacity: Math.min(32, 4 + parsed.continuity.extraPrincipalsPerPlayer * 5),
    });
    state.world = WorldViewModelSchema.parse({ ...state.world, gameTitle: parsed.title, phase: "collecting", submittedPlayers: 0, totalPlayers: 1 });
    state.scenarioId = parsed.scenarioId;
    state.hostedDemo = true;
    state.revision += 1;
    return DEMO_GAME_ID;
  },
  async needsCharacterDeclaration(gameId) {
    return gameId === DEMO_GAME_ID && state.hostedDemo && !state.lobby.characters.some((character) => character.claimedByPlayerId === DEMO_PLAYER_ID);
  },
  async getLobby(gameId) {
    return gameId === DEMO_GAME_ID ? structuredClone(state.lobby) : null;
  },
  async claimCharacter(gameId, playerId, claim) {
    void playerId;
    if (gameId !== DEMO_GAME_ID) return "already_claimed";
    if (claim.origin === "declared") {
      const stableId = `declared-${playerId}`;
      state.lobby.characters.push({
        id: stableId,
        name: claim.declaration,
        pitch: "A declared character awaiting deterministic role resolution.",
        station: "Role declaration pending",
        location: "Scenario focus",
        claimedByPlayerId: playerId,
      });
      state.lobby.occupiedSeatCount = Math.min(state.lobby.startingSeatCount, state.lobby.occupiedSeatCount + 1);
      state.revision += 1;
      return "claimed";
    }
    const character = state.lobby.characters.find((candidate) => candidate.id === claim.characterId);
    if (character === undefined || character.claimedByPlayerId !== null) return "already_claimed";
    character.claimedByPlayerId = playerId;
    state.lobby.occupiedSeatCount = Math.min(state.lobby.startingSeatCount, state.lobby.occupiedSeatCount + 1);
    state.revision += 1;
    return "claimed";
  },
  async requestCharacterDeclaration(gameId, declaration) {
    if (gameId !== DEMO_GAME_ID) return { status: "pending" };
    state.characterDeclaration = { status: "pending" };
    state.revision += 1;
    setTimeout(() => {
      if (state.characterDeclaration.status !== "pending") return;
      const summary = `Word of your arrival spreads: "${declaration.trim().slice(0, 200)}"`;
      state.characterDeclaration = {
        status: "ready",
        cast: [],
        openingEvent: { title: deriveOpeningTitle(summary), body: summary },
      };
      state.revision += 1;
    }, 400);
    return { status: "pending" };
  },
  async getCharacterDeclarationStatus(gameId) {
    if (gameId !== DEMO_GAME_ID) return { status: "none" };
    return structuredClone(state.characterDeclaration);
  },
  async getWorld(gameId, lowBandwidth = false, omitGeo = false) {
    if (gameId !== DEMO_GAME_ID) return null;
    const connectedPlayers = fixtureConnectedPlayerCount();
    const world = {
      ...structuredClone(state.world),
      lowBandwidth,
      totalPlayers: connectedPlayers,
      submittedPlayers: Math.min(state.world.submittedPlayers, connectedPlayers),
    };
    const mapGeoJson = punicWarsGeoJson;
    const mapOverlay = demoMapOverlay(state.revision);
    return omitGeo ? { ...world, mapOverlay } : { ...world, mapGeoJson, mapOverlay };
  },
  async getGameRevision(gameId) {
    return gameId === DEMO_GAME_ID ? state.revision : 0;
  },
  async getLatestTurnEventMeta() {
    // The fixture has no turn-resolution pipeline that ever populates changed
    // region IDs -- nothing to report, ever.
    return null;
  },
  async submitOrders(gameId, batch) {
    const parsed = OrderBatchSchema.parse(batch);
    if (gameId === DEMO_GAME_ID) {
      const totalPlayers = fixtureConnectedPlayerCount();
      const submittedPlayers = Math.min(totalPlayers, state.world.submittedPlayers + 1);
      state.world = WorldViewModelSchema.parse({
        ...state.world,
        totalPlayers,
        submittedPlayers,
        phase: totalPlayers > 0 && submittedPlayers === totalPlayers ? "news" : "collecting",
      });
      state.submittedBatch = parsed;
      if (state.world.phase === "news") {
        state.news = NewsViewModelSchema.parse({
          ...state.news,
          turnIndex: state.world.turnIndex,
          totalPlayers,
          readyPlayers: 0,
          currentPlayerReady: false,
          phase: "news",
        });
      }
      state.revision += 1;
    }
  },
  async getOrdersStatus(gameId) {
    if (gameId !== DEMO_GAME_ID) return null;
    return OrdersStatusResponseSchema.parse({
      gameId,
      turnIndex: state.world.turnIndex,
      submitted: state.submittedBatch !== null,
      batch: state.submittedBatch,
      ongoingActions: state.world.ongoingActions,
    });
  },
  async getNews(gameId) {
    if (gameId !== DEMO_GAME_ID) return null;
    const totalPlayers = fixtureConnectedPlayerCount();
    return NewsViewModelSchema.parse({
      ...structuredClone(state.news),
      totalPlayers,
      readyPlayers: Math.min(state.news.readyPlayers, totalPlayers),
    });
  },
  async acknowledgeNews(gameId) {
    if (gameId === DEMO_GAME_ID && !state.news.currentPlayerReady) {
      state.news.currentPlayerReady = true;
      state.news.readyPlayers = Math.min(state.news.totalPlayers, state.news.readyPlayers + 1);
      if (state.news.readyPlayers === state.news.totalPlayers) {
        state.world = WorldViewModelSchema.parse({
          ...state.world,
          phase: "collecting",
          turnIndex: state.world.turnIndex + 1,
          submittedPlayers: 0,
          totalPlayers: fixtureConnectedPlayerCount(),
        });
        state.submittedBatch = null;
      }
      state.revision += 1;
    }
  },
  async patchUiState(gameId, patch) {
    if (gameId !== DEMO_GAME_ID) return;
    if (patch.selectedThreadId !== undefined) state.uiState.selectedThreadId = patch.selectedThreadId;
    if (patch.chronicleReadSequence !== undefined) state.uiState.chronicleReadSequence = patch.chronicleReadSequence;
  },
  async getAccount() {
    return structuredClone(state.account);
  },
  async redeemGift(code) {
    if (code.toUpperCase() !== "PLAY-TEST-2026") return "invalid";
    state.account.availableCoins = String(Number(state.account.availableCoins) + 500);
    return "redeemed";
  },
  async checkout(productSlug) {
    void productSlug;
    return null;
  },
  async resumeGame(gameId) {
    const index = state.account.pausedGames.findIndex((game) => game.gameId === gameId);
    if (index < 0) return false;
    state.account.pausedGames.splice(index, 1);
    return true;
  },
  async createGift(grantCredits, maxRedemptions, note) {
    void grantCredits;
    void maxRedemptions;
    void note;
    state.createdGift = "GIFT-7VQ9-M1WEB-2026";
    return state.createdGift;
  },
  async consumeCreatedGift() {
    const code = state.createdGift;
    state.createdGift = null;
    return code;
  },
  async endGame(gameId) {
    if (gameId === DEMO_GAME_ID) Object.assign(state, createState());
  },
  async deleteSave(gameId) {
    if (gameId !== DEMO_GAME_ID) return false;
    Object.assign(state, createState());
    return true;
  },
};

// A single-player-per-game Postgres implementation (docs/03, docs/04, docs/14).
//
// Real persistence, real turn resolution by apps/worker's poll loop, real
// dialogue replies from its leased queue -- scoped to one active player per
// game, which is what lets order submission decide "everyone has submitted"
// with a row lock instead of apps/worker's advisory lock (see
// packages/db/src/queries/turns.ts). Account, billing and gift methods stay on
// the fixture: they are a separate, already-real system (packages/billing,
// apps/web/lib/payments.ts) that this repository never owned in the first
// place, and reimplementing them here would be a second, competing path to the
// same ledger.

async function resolveViewerUserId(): Promise<string | null> {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

/** Resolves the signed-in player to their active player row. */
async function resolvePlayer(gameId: string): Promise<{ db: ReturnType<typeof createDatabase>["db"]; close: () => Promise<void>; playerId: string; characterId?: string } | null> {
  const userId = await resolveViewerUserId();
  if (userId === null) return null;
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [player] = await db.select({ id: schema.players.id, characterId: schema.players.characterId }).from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active"))).limit(1);
    if (player === undefined) { await close(); return null; }
    const characterId = player.characterId.startsWith("pending:") || player.characterId.startsWith("declared-") ? undefined : player.characterId;
    return { db, close, playerId: player.id, ...(characterId !== undefined ? { characterId } : {}) };
  } catch (error) {
    await close();
    throw error;
  }
}

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (value === undefined || value === "") throw new Error("DATABASE_URL is required.");
  return value;
}

export const postgresGameRepository: GameRepository = {
  async getViewer() {
    const userId = await resolveViewerUserId();
    if (userId === null) throw new Error("An account is required.");
    const session = await getAuthentication().api.getSession({ headers: await headers() });
    const user = session?.user;
    if (user === undefined) throw new Error("An account is required.");
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      const profile = await getAccountProfile(db, user.id);
      return {
        userId: user.id,
        playerId: DEMO_PLAYER_ID,
        displayName: user.name ?? user.email,
        email: user.email,
        role: profile?.role ?? "user",
      };
    } finally {
      await close();
    }
  },
  async listGames() {
    const userId = await resolveViewerUserId();
    if (userId === null) throw new Error("An account is required to list saves.");
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      const [hosted, joined, activeHostedCount] = await Promise.all([
        listHostedGamesQuery(db, userId),
        listJoinedGamesQuery(db, userId),
        countActiveHostedGames(db, userId),
      ]);
      return { hosted, joined, activeHostedCount };
    } finally {
      await close();
    }
  },
  async listPublicScenarios() {
    const userId = await resolveViewerUserId();
    if (userId === null) return [];
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      await ensureBuiltInScenarios(db);
      return await listPublicScenariosQuery(db, userId);
    } finally {
      await close();
    }
  },
  async getPublicScenario(scenarioId) {
    const userId = await resolveViewerUserId();
    if (userId === null) return null;
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      await ensureBuiltInScenarios(db);
      return await findPublicScenario(db, scenarioId, userId) ?? null;
    } finally {
      await close();
    }
  },
  async createGame(input) {
    const parsed = GameCreationSchema.parse(input);
    const userId = await resolveViewerUserId();
    if (userId === null) throw new Error("An account is required to host a saved game.");
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      await ensureBuiltInScenarios(db);
      const activeCount = await countActiveHostedGames(db, userId);
      if (activeCount >= 3) throw new SlotCapError(userId);
      return await createGameQuery(db, {
        title: parsed.title,
        scenarioId: parsed.scenarioId,
        startingSeatCount: parsed.continuity.startingSeatCount,
        extraPrincipalsPerPlayer: parsed.continuity.extraPrincipalsPerPlayer,
        newsTimeoutSeconds: parsed.newsTimeoutSeconds,
        hostUserId: userId,
        coinBudgetMicroUnits: parseCoinAmount(parsed.coinCap),
      });
    } finally {
      await close();
    }
  },
  async needsCharacterDeclaration(gameId) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.needsCharacterDeclaration(gameId);
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId } = resolved;
    try {
      const [player] = await db
        .select({ characterId: schema.players.characterId })
        .from(schema.players)
        .where(and(
          eq(schema.players.gameId, gameId),
          eq(schema.players.id, playerId),
          eq(schema.players.status, "active"),
        ))
        .limit(1);
      if (player === undefined || player.characterId.startsWith("pending:")) return true;
      if (!player.characterId.startsWith("declared-")) return false;
      const claim = await getActiveCharacterClaimForPlayer(db, gameId, playerId);
      return claim?.resolvedRole === null || claim?.resolvedRole === undefined;
    } finally {
      await close();
    }
  },
  async getLobby(gameId) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.getLobby(gameId);
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close } = resolved;
    const view = await getWorldView(db, gameId);
    await close();
    if (view === undefined) return null;
    const suggestable = view.world.characters.map((character) => ({
      id: character.id,
      name: character.name,
      pitch: `Play ${character.name} in ${view.gameTitle}.`,
      station: character.officeId ?? "No office held",
      location: view.world.material.forces.find((force) => force.commanderCharacterId === character.id)?.locationId ?? "Unknown",
      claimedByPlayerId: null,
    }));
    return LobbyViewModelSchema.parse({
      gameId,
      title: view.gameTitle,
      hostName: "The host",
      startingSeatCount: Math.max(1, view.totalPlayers),
      occupiedSeatCount: view.totalPlayers,
      extraPrincipalsPerPlayer: 1,
      principalCapacity: 9,
      inviteUrl: `/join/${encodeURIComponent(gameId)}`,
      characters: suggestable,
    } satisfies LobbyViewModel);
  },
  async claimCharacter(gameId, playerId, claim) {
    const resolved = await resolvePlayer(gameId);
    void playerId;
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close } = resolved;
    try {
      const characterId = claim.origin === "suggested" ? claim.characterId : `declared-${resolved.playerId}`;
      const result = await claimCharacterQuery(db, { gameId, playerId: resolved.playerId, claim, characterId });
      return result === "claimed" ? "claimed" : "already_claimed";
    } finally {
      await close();
    }
  },
  async requestCharacterDeclaration(gameId, declaration) {
    if (gameId === DEMO_GAME_ID) {
      return fixtureGameRepository.requestCharacterDeclaration(gameId, declaration);
    }
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId } = resolved;
    try {
      const claim = CharacterClaimSchema.parse({ origin: "declared", declaration });
      // Same characterId derivation `claimCharacter` above uses -- the "pending:"
      // placeholder `findOrCreatePlayer` seeds is replaced by this stable id, and
      // apps/worker's role queue later resolves the role behind it.
      await claimCharacterQuery(db, { gameId, playerId, claim, characterId: `declared-${playerId}` });
      return { status: "pending" };
    } finally {
      await close();
    }
  },
  async getCharacterDeclarationStatus(gameId) {
    if (gameId === DEMO_GAME_ID) {
      return fixtureGameRepository.getCharacterDeclarationStatus(gameId);
    }
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId } = resolved;
    try {
      const claim = await getActiveCharacterClaimForPlayer(db, gameId, playerId);
      if (claim === undefined) return { status: "none" };
      if (claim.resolvedRole === null || claim.resolvedRole === undefined) return { status: "pending" };
      const parsedRole = ResolvedRoleSchema.safeParse(claim.resolvedRole);
      if (!parsedRole.success) return { status: "failed", reason: "The generated cast could not be read." };
      const cast = parsedRole.data.contacts.map((contact) => ({
        npcCharacterId: contact.characterId,
        knownName: contact.name,
        roleLabel: contact.roleLabel,
      }));
      const summary = parsedRole.data.immediateEvent.summary;
      return { status: "ready", cast, openingEvent: { title: deriveOpeningTitle(summary), body: summary } };
    } finally {
      await close();
    }
  },
  async getWorld(gameId, lowBandwidth = false, omitGeo = false) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.getWorld(gameId, lowBandwidth, omitGeo);
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId } = resolved;
    try {
      const view = await getWorldView(db, gameId);
      if (view === undefined) return null;
      const [player] = await db
        .select({ characterId: schema.players.characterId })
        .from(schema.players)
        .where(eq(schema.players.id, playerId))
        .limit(1);
      const characterId = player?.characterId ?? view.world.characters[0]?.id ?? "";
      const world = projectWorldView(view.world, {
        gameId: view.gameId,
        gameTitle: view.gameTitle,
        turnIndex: view.turnIndex,
        turnStatus: view.turnStatus,
        submittedPlayers: view.submittedPlayers,
        totalPlayers: view.totalPlayers,
        lowBandwidth,
        ...(view.scenarioClock === undefined ? {} : { clock: view.scenarioClock }),
      }, characterId);
      const mapGeoJson = omitGeo ? undefined : builtInScenarioMap(view.mapAssetId);
      return mapGeoJson === undefined ? world : { ...world, mapGeoJson };
    } finally {
      await close();
    }
  },
  async getGameRevision(gameId) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.getGameRevision(gameId);
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl === undefined || databaseUrl === "") return fixtureGameRepository.getGameRevision(gameId);
    return getGameRevisionQuery(getSharedDatabase(databaseUrl), gameId);
  },
  async getLatestTurnEventMeta(gameId) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.getLatestTurnEventMeta(gameId);
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (databaseUrl === undefined || databaseUrl === "") return fixtureGameRepository.getLatestTurnEventMeta(gameId);
    const meta = await getLatestTurnEventMetaQuery(getSharedDatabase(databaseUrl), gameId);
    return meta ?? null;
  },
  async submitOrders(gameId, batch) {
    if (gameId === DEMO_GAME_ID) {
      await fixtureGameRepository.submitOrders(gameId, batch);
      return;
    }
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId } = resolved;
    try {
      const parsed = OrderBatchSchema.parse(batch);
      const result = await submitPlayerOrder(db, {
        gameId,
        playerId,
        rawText: parsed.directives.map((directive) => ("text" in directive ? directive.text : directive.actionId)).join("\n"),
        batch: parsed,
      });
      if (!result.accepted) throw new Error(result.reason ?? "Orders cannot be submitted right now.");
    } finally {
      await close();
    }
  },
  async getOrdersStatus(gameId) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.getOrdersStatus(gameId);
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId } = resolved;
    try {
      const [view, order] = await Promise.all([
        getWorldView(db, gameId),
        getPlayerOrderForOpenTurn(db, gameId, playerId),
      ]);
      if (view === undefined) return null;
      return OrdersStatusResponseSchema.parse({
        gameId,
        turnIndex: order?.turnIndex ?? view.turnIndex,
        submitted: order !== undefined,
        batch: order?.batch ?? null,
        ongoingActions: view.world.actions,
      });
    } finally {
      await close();
    }
  },
  async getNews(gameId) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.getNews(gameId);
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId, characterId } = resolved;
    try {
      const [chronicle, uiState] = await Promise.all([
        getChronicleForLatestTurn(db, gameId, characterId),
        getPlayerGameUiState(db, gameId, playerId),
      ]);
      if (chronicle === undefined) return null;
      return projectNewsView(chronicle, {
        gameId,
        readyPlayers: 0,
        totalPlayers: 1,
        currentPlayerReady: false,
        chronicleReadSequence: uiState?.chronicleReadSequence ?? -1,
      });
    } finally {
      await close();
    }
  },
  async acknowledgeNews(gameId) {
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId, characterId } = resolved;
    try {
      // Persist the durable chronicle read position so a browser closed
      // right after acknowledging still resumes past what was just read.
      const chronicle = await getChronicleForLatestTurn(db, gameId, characterId);
      const lastSequence = chronicle?.entries.at(-1)?.sequence;
      if (lastSequence !== undefined) {
        await upsertPlayerGameUiState(db, { gameId, playerId, chronicleReadSequence: lastSequence });
      }

      // Mark this player ready in the turn_news_readiness roster so the worker's
      // next closeNewsBarrier poll sees them as done rather than waiting for the
      // news timeout.  Without this, the worker only marks a player ready when
      // the news deadline fires — players who click "Finished reading" would
      // wait up to newsTimeoutSeconds before the next turn opened.
      const newsTurn = await db
        .select({ id: schema.turns.id })
        .from(schema.turns)
        .where(and(eq(schema.turns.gameId, gameId), eq(schema.turns.status, "news")))
        .orderBy(schema.turns.index)
        .limit(1);
      if (newsTurn[0] !== undefined) {
        await acknowledgeTurnNews(db, {
          gameId,
          turnId: newsTurn[0].id,
          playerId,
          readyAt: new Date(),
        });
      }
    } finally {
      await close();
    }
  },
  async patchUiState(gameId, patch) {
    const resolved = await resolvePlayer(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId } = resolved;
    try {
      await upsertPlayerGameUiState(db, {
        gameId,
        playerId,
        ...(patch.selectedThreadId !== undefined ? { selectedThreadId: patch.selectedThreadId } : {}),
        ...(patch.chronicleReadSequence !== undefined ? { chronicleReadSequence: patch.chronicleReadSequence } : {}),
      });
    } finally {
      await close();
    }
  },
  async getAccount() {
    return fixtureGameRepository.getAccount();
  },
  async redeemGift(code) {
    return fixtureGameRepository.redeemGift(code);
  },
  async checkout(productSlug) {
    return fixtureGameRepository.checkout(productSlug);
  },
  async resumeGame(gameId) {
    const userId = await resolveViewerUserId();
    if (userId === null) throw new Error("A payer account is required.");
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try { return await resumePaymentPausedGame(db, userId, gameId); }
    finally { await close(); }
  },
  async createGift(grantCredits, maxRedemptions, note) {
    return fixtureGameRepository.createGift(grantCredits, maxRedemptions, note);
  },
  async consumeCreatedGift() {
    return fixtureGameRepository.consumeCreatedGift();
  },
  async endGame(gameId) {
    const userId = await resolveViewerUserId();
    if (userId === null) throw new Error("A host account is required.");
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      await requestGameEnd(db, gameId, userId);
    } finally {
      await close();
    }
  },
  async deleteSave(gameId) {
    const userId = await resolveViewerUserId();
    if (userId === null) throw new Error("A save owner account is required.");
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      return await deleteOwnedGame(db, gameId, userId);
    } finally {
      await close();
    }
  },
};

/** The signed-in viewer's player row and claimed character for one game, or null in fixture/demo mode. */
/**
 * The web layer depends on this interface, never a Drizzle client directly --
 * `postgresGameRepository` is itself the Drizzle-backed implementation, chosen
 * over the fixture whenever DATABASE_URL is configured.
 */
export const gameRepository: GameRepository = isAuthenticationConfigured() ? postgresGameRepository : fixtureGameRepository;

function parseCoinAmount(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * MICRO_UNITS_PER_COIN + BigInt(fraction.padEnd(6, "0"));
}

export function resetFixtureRepository(): void {
  Object.assign(state, createState());
}
