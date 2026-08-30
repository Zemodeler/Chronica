import "server-only";

/* eslint-disable @typescript-eslint/require-await -- the fixture preserves the asynchronous packages/db contract while resolving in memory */

import {
  AccountDashboardViewModelSchema,
  ChatOverviewResponseSchema,
  CharacterClaimSchema,
  ConversationsViewModelSchema,
  GameCreationSchema,
  LobbyViewModelSchema,
  NewsViewModelSchema,
  OrderBatchSchema,
  OrdersStatusResponseSchema,
  ResolvedRoleSchema,
  WorldViewModelSchema,
  type AccountDashboardViewModel,
  type ChatOverviewResponse,
  type CharacterClaim,
  type ContactDiscoveryResult,
  type ConversationsViewModel,
  type DialogueMessage,
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
  findOrOpenDialogueThread,
  openProvisionalContactThread,
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
  listDialogueThreads,
  listHostedGames as listHostedGamesQuery,
  listJoinedGames as listJoinedGamesQuery,
  listPublicScenarios as listPublicScenariosQuery,
  listThreadMessages,
  requestGameEnd,
  resumePaymentPausedGame,
  schema,
  sendPlayerDialogueMessage,
  SlotCapError,
  submitPlayerOrder,
  upsertPlayerGameUiState,
  type GameSummaryRow,
  type PublicScenarioSummary,
} from "@chronica/db";
import { demoMaterialView } from "./demo-material-view";
import { europeNorthAfricaGeoJson } from "./europe-north-africa-geojson";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";
import { projectConversationsView, projectNewsView, projectWorldView } from "./world-view";

export const DEMO_GAME_ID = "demo-game";
export const DEMO_PLAYER_ID = "player-host";

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
  gameTitle: "The Numidian Decision",
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
  title: "The Numidian Decision",
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

const initialConversations = ConversationsViewModelSchema.parse({
  gameId: DEMO_GAME_ID,
  playerCharacterId: "marcus-atilius",
  canSend: true,
  contacts: [
    {
      threadId: "thread-captain",
      knownName: "Captain Lucia Ferrante",
      roleLabel: "Captain of the Drepanum gate",
      channel: "in_person_private",
      unread: 1,
      pending: false,
    },
    {
      threadId: "thread-chancellor",
      knownName: "Chancellor Ruggero",
      roleLabel: "Royal chancellor",
      channel: "correspondence",
      unread: 0,
      pending: false,
    },
  ],
  activeThread: {
    threadId: "thread-captain",
    knownName: "Captain Lucia Ferrante",
    roleLabel: "Captain of the Drepanum gate",
    channelLabel: "Private conversation in person",
    elapsedStepLabel: "Step 13",
    pending: false,
    readOnlyReason: null,
    messages: [
      {
        id: "message-1",
        sessionId: "session-captain-13",
        sequence: 0,
        speakerCharacterId: "marcus-atilius",
        body: "Which road is the least exposed after dusk?",
        acts: [],
        disclosedFactIds: [],
      },
      {
        id: "message-2",
        sessionId: "session-captain-13",
        sequence: 1,
        speakerCharacterId: "captain-lucia",
        body: "The salt road is watched, my lord. The vineyard track is slower, but my patrol returned from it before dawn.",
        acts: [],
        disclosedFactIds: ["fact-vineyard-patrol"],
      },
    ],
  },
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
  conversations: ConversationsViewModel;
  /**
   * Per-thread message history, keyed by threadId. `conversations.activeThread`
   * is only ever a snapshot of whichever thread was last requested -- storing
   * messages there and nowhere else meant selecting a different contact threw
   * away the one just left, since there was only one slot for all of them.
   */
  messagesByThreadId: Record<string, DialogueMessage[]>;
  account: AccountDashboardViewModel;
  createdGift: string | null;
  hostedDemo: boolean;
  revision: number;
  dialogueRequestIds: string[];
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
  conversations: structuredClone(initialConversations),
  messagesByThreadId: initialConversations.activeThread === null ? {} : {
    [initialConversations.activeThread.threadId]: structuredClone(initialConversations.activeThread.messages),
  },
  account: structuredClone(initialAccount),
  createdGift: null,
  hostedDemo: false,
  revision: initialWorld.turnIndex,
  dialogueRequestIds: [],
  uiState: { selectedThreadId: null, chronicleReadSequence: -1 },
  submittedBatch: null,
  characterDeclaration: { status: "none" },
  scenarioId: "first-punic-war-demo",
});

const storeHolder = globalThis as typeof globalThis & { chronicaFixtureStore?: StoreState };
const state = storeHolder.chronicaFixtureStore ?? createState();
storeHolder.chronicaFixtureStore = state;

function fixtureConnectedPlayerCount(): number {
  // Hosting creates the host's active seat before their free-text declaration.
  return Math.max(1, state.lobby.characters.filter((character) => character.claimedByPlayerId !== null).length);
}

const DEMO_POLITY_NAMES: Readonly<Record<string, string>> = {
  rome: "Roman Republic",
  carthage: "Carthaginian Empire",
  syracuse: "Kingdom of Syracuse",
  gauls: "Gallic Tribes",
  macedonia: "Kingdom of Macedonia",
  "greek-states": "Greek City-States",
  illyrians: "Illyrian Tribes",
  iberians: "Iberian Peoples",
  germanic: "Germanic Tribes",
  nordic: "Nordic Peoples",
  "eastern-tribes": "Eastern Tribes",
  baltic: "Baltic Peoples",
  celtic: "Celtic Tribes",
  "local-tribes": "Local Tribes",
  savoy: "Duchy of Savoy",
  milan: "Duchy of Milan",
  venice: "Republic of Venice",
  genoa: "Republic of Genoa",
  florence: "Florentine Republic",
  papacy: "Papal States",
  naples: "Kingdom of Naples",
};

const DEMO_OVERLAY_PROVINCES: DynamicMapOverlay["provinces"] = [
  { provinceId: "ita-72843720b99597932318450", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "calibration", tier: "far" },
  { provinceId: "ita-72843720b59566147937015", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "calibration", tier: "far" },
  { provinceId: "ita-72843720b863019116732", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "calibration", tier: "focus" },
  { provinceId: "ita-72843720b88210905209841", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "calibration", tier: "far" },
  { provinceId: "ita-72843720b81376294924159", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "calibration", tier: "far" },
  { provinceId: "fra-19338628b22604203385446", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "mountain", tier: "far" },
  // Deliberately disconnected holding used to exercise multi-component polity labels.
  { provinceId: "esp-25490228b88831207743232", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "calibration", tier: "far" },
  { provinceId: "drepanum", controllerPolityId: "rome", controlFirmnessBps: 6000, terrainId: "coastal-plain", tier: "focus" },
  { provinceId: "palermo", controllerPolityId: "rome", controlFirmnessBps: 8500, terrainId: "hills", tier: "focus" },
  { provinceId: "agrigentum", controllerPolityId: "carthage", controlFirmnessBps: 4000, terrainId: "dry-uplands", tier: "near" },
  { provinceId: "messina", controllerPolityId: "rome", controlFirmnessBps: 5000, terrainId: "mountain-strait", tier: "far" },
];

function demoMapOverlay(revision: number): DynamicMapOverlay {
  const polityIds = new Set(DEMO_OVERLAY_PROVINCES.flatMap((p) => p.controllerPolityId === null ? [] : [p.controllerPolityId]));
  return {
    revision,
    polities: [...polityIds].map((polityId) => ({ polityId, name: DEMO_POLITY_NAMES[polityId] ?? polityId })),
    provinces: DEMO_OVERLAY_PROVINCES,
    settlements: [
      {
        settlementId: "settlement-rome",
        provinceId: "ita-72843720b863019116732",
        anchorFeatureId: "settlement-rome",
        name: "Rome",
        kind: "city",
        controllerPolityId: "rome",
        capitalPolityId: "rome",
        importance: 100,
        underSiege: false,
        damaged: false,
      },
      {
        settlementId: "settlement-naples",
        provinceId: "ita-72843720b88210905209841",
        anchorFeatureId: "settlement-naples",
        name: "Naples",
        kind: "city",
        controllerPolityId: "rome",
        capitalPolityId: null,
        importance: 80,
        underSiege: false,
        damaged: false,
      },
      {
        settlementId: "settlement-syracuse",
        provinceId: "ita-72843720b81376294924159-sicily",
        anchorFeatureId: "settlement-syracuse",
        name: "Syracuse",
        kind: "city",
        controllerPolityId: "rome",
        capitalPolityId: null,
        importance: 80,
        underSiege: false,
        damaged: false,
      },
      {
        settlementId: "settlement-agrigentum-fort",
        provinceId: "ita-72843720b81376294924159-sicily",
        anchorFeatureId: "settlement-agrigentum-fort",
        name: "Fort Agrigentum",
        kind: "fortress",
        controllerPolityId: "carthage",
        capitalPolityId: null,
        importance: 50,
        underSiege: false,
        damaged: false,
      },
    ],
    forces: [
      {
        forceId: demoMaterialView.forces[0]!.id,
        provinceId: "ita-72843720b88210905209841",
        coordinate: [14.25, 40.93],
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
        forceId: demoMaterialView.forces[1]!.id,
        provinceId: "fra-19338628b22604203385446",
        coordinate: [9.15, 42.15],
        ownerPolityId: "rome",
        name: demoMaterialView.forces[1]!.name,
        commanderLabel: "Corsican commander",
        strengthLabel: `${demoMaterialView.forces[1]!.totalHeadcount.toLocaleString()} total; ${demoMaterialView.forces[1]!.fitStrength.toLocaleString()} fit`,
        relation: "friendly",
        flagAssetId: "eagle",
        selected: false,
        movement: null,
      },
    ],
    presentationEvents: [{
      id: "first-punic-battle-off-sicily",
      kind: "battle",
      coordinate: [15.2, 38.1],
      participantForceIds: [demoMaterialView.forces[0]!.id],
    }],
  };
}

export type { GameSummaryRow };
export type { PublicScenarioSummary };

const LOCAL_DEMO_SCENARIOS: readonly PublicScenarioSummary[] = [
  {
    scenarioId: "first-punic-war-demo",
    version: 1,
    title: "The Numidian Decision",
    period: "264 BCE · First Punic War",
    authorName: "Chronica",
    recommendedPlayers: 1,
  },
];

function findTemporaryDemoScenario(scenarioId: string): PublicScenarioSummary | null {
  return LOCAL_DEMO_SCENARIOS.find((scenario) => scenario.scenarioId === scenarioId) ?? null;
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
      readonly cast: readonly { readonly threadId: string; readonly knownName: string; readonly roleLabel: string }[];
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
  listGames(): Promise<{ hosted: GameSummaryRow[]; joined: GameSummaryRow[] }>;
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
  getConversations(gameId: string, threadId?: string): Promise<ConversationsViewModel | null>;
  findContact(gameId: string, role: string): Promise<string>;
  sendDialogue(gameId: string, threadId: string, body: string, requestId?: string): Promise<void>;
  getChatOverview(gameId: string): Promise<ChatOverviewResponse | null>;
  discoverContact(gameId: string, role: string): Promise<ContactDiscoveryResult>;
  sendChatMessage(gameId: string, threadId: string, body: string, requestId?: string): Promise<"accepted" | "duplicate">;
  patchUiState(gameId: string, patch: PatchUiStateRequest): Promise<void>;
  getAccount(): Promise<AccountDashboardViewModel>;
  redeemGift(code: string): Promise<"redeemed" | "invalid">;
  checkout(productSlug: string): Promise<string | null>;
  resumeGame(gameId: string): Promise<boolean>;
  createGift(grantCredits: number, maxRedemptions: number, note: string): Promise<string>;
  consumeCreatedGift(): Promise<string | null>;
  endGame(gameId: string): Promise<void>;
}

export const fixtureGameRepository: GameRepository = {
  async getViewer() {
    return fixtureViewer;
  },
  async listGames() {
    return {
      hosted: state.hostedDemo ? [{ gameId: DEMO_GAME_ID, title: state.world.gameTitle, status: "active" }] : [],
      joined: [],
    };
  },
  async listPublicScenarios() {
    return LOCAL_DEMO_SCENARIOS;
  },
  async getPublicScenario(scenarioId) {
    return findTemporaryDemoScenario(scenarioId);
  },
  async createGame(input) {
    const parsed = GameCreationSchema.parse(input);
    if (findTemporaryDemoScenario(parsed.scenarioId) === null) throw new Error("Unknown local scenario.");
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
    // Mirrors the real worker's async role-resolution queue (§2c): the caller
    // polls GET .../character-declaration until this flips to "ready". The
    // fixture reuses the DEMO game's already-seeded contacts as the generated
    // cast rather than inventing new characters, since nothing here needs to
    // be materialized into world.characters the way the real cast does.
    setTimeout(() => {
      if (state.characterDeclaration.status !== "pending") return;
      const cast = state.conversations.contacts.map((contact) => ({
        threadId: contact.threadId,
        knownName: contact.knownName,
        roleLabel: contact.roleLabel,
      }));
      const summary = `Word of your arrival spreads: "${declaration.trim().slice(0, 200)}"`;
      state.characterDeclaration = {
        status: "ready",
        cast,
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
    const mapGeoJson = europeNorthAfricaGeoJson;
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
  async getConversations(gameId, threadId) {
    if (gameId !== DEMO_GAME_ID) return null;
    if (threadId !== undefined) {
      const contact = state.conversations.contacts.find((candidate) => candidate.threadId === threadId);
      if (contact === undefined) return null;
      // Every thread keeps its own message history in messagesByThreadId; this
      // just projects the requested one, so switching contacts never discards
      // whichever thread was open before.
      state.conversations.activeThread = {
        threadId,
        knownName: contact.knownName,
        roleLabel: contact.roleLabel,
        channelLabel: contact.channel.replaceAll("_", " "),
        elapsedStepLabel: state.world.elapsedStepLabel,
        pending: contact.pending,
        readOnlyReason: null,
        messages: state.messagesByThreadId[threadId] ?? [],
      };
    }
    const result = structuredClone(state.conversations);
    // A delivery failure is informational: the next send either retries this
    // session or reopens it against the current collecting turn.
    result.canSend = result.activeThread !== null && !result.activeThread.pending;
    return ConversationsViewModelSchema.parse(result);
  },
  async findContact(gameId, role) {
    if (gameId !== DEMO_GAME_ID) return "unavailable";
    const threadId = `thread-role-${state.conversations.contacts.length + 1}`;
    const knownName = /^the\s+/i.test(role) ? role : `The ${role}`;
    state.conversations.contacts.push({
      threadId,
      knownName,
      roleLabel: role,
      channel: "in_person_private",
      unread: 0,
      pending: false,
    });
    state.messagesByThreadId[threadId] = [];
    state.revision += 1;
    return threadId;
  },
  async sendDialogue(gameId, threadId, body, requestId) {
    if (gameId !== DEMO_GAME_ID) return;
    const contact = state.conversations.contacts.find((candidate) => candidate.threadId === threadId);
    if (contact === undefined) return;
    const requestKey = requestId === undefined ? null : `${threadId}:${requestId}`;
    if (requestKey !== null && state.dialogueRequestIds.includes(requestKey)) return;
    if (contact.pending) throw new Error("A reply to your previous message is still pending.");
    if (requestKey !== null) state.dialogueRequestIds.push(requestKey);
    const messages = state.messagesByThreadId[threadId] ?? (state.messagesByThreadId[threadId] = []);
    messages.push({
      id: `message-${threadId}-${messages.length + 1}`,
      sessionId: `session-${threadId}`,
      sequence: messages.length,
      speakerCharacterId: state.conversations.playerCharacterId,
      body,
      acts: [],
      disclosedFactIds: [],
    });
    // The fixture follows the real queue's visible contract: a player message
    // is first pending, then a worker reply arrives later. Keeping this
    // asynchronous catches UI code that accidentally keys pending state off a
    // message count rather than the lifecycle it represents. There is no CLI
    // in fixture mode -- this canned line is what stands in for one until a
    // real worker (with DATABASE_URL configured) is running.
    contact.pending = true;
    state.revision += 1;
    setTimeout(() => {
      const replyMessages = state.messagesByThreadId[threadId];
      if (replyMessages === undefined) return;
      replyMessages.push({
        id: `message-${threadId}-${replyMessages.length + 1}`,
        sessionId: `session-${threadId}`,
        sequence: replyMessages.length,
        speakerCharacterId: threadId,
        body: "I have heard you. If you want material action, include it among your ordinary orders.",
        acts: [],
        disclosedFactIds: [],
      });
      const pendingContact = state.conversations.contacts.find((candidate) => candidate.threadId === threadId);
      if (pendingContact !== undefined) pendingContact.pending = false;
      state.revision += 1;
    }, 250);
  },
  async getChatOverview(gameId) {
    if (gameId !== DEMO_GAME_ID) return null;
    return ChatOverviewResponseSchema.parse({
      gameId,
      playerCharacterId: state.conversations.playerCharacterId,
      contacts: state.conversations.contacts,
      selectedThreadId: state.uiState.selectedThreadId,
    });
  },
  async discoverContact(gameId, role) {
    const result = await fixtureGameRepository.findContact(gameId, role);
    return result === "unavailable"
      ? { status: "unavailable", explanation: `No one matching "${role}" could be found nearby.` }
      : { status: "found", threadId: result };
  },
  async sendChatMessage(gameId, threadId, body, requestId) {
    if (gameId === DEMO_GAME_ID && requestId !== undefined) {
      const requestKey = `${threadId}:${requestId}`;
      if (state.dialogueRequestIds.includes(requestKey)) return "duplicate";
    }
    await fixtureGameRepository.sendDialogue(gameId, threadId, body, requestId);
    return "accepted";
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
async function resolvePlayer(gameId: string): Promise<{ db: ReturnType<typeof createDatabase>["db"]; close: () => Promise<void>; playerId: string } | null> {
  const userId = await resolveViewerUserId();
  if (userId === null) return null;
  const { db, close } = createDatabase(requiredDatabaseUrl());
  try {
    const [player] = await db.select({ id: schema.players.id }).from(schema.players).where(and(eq(schema.players.gameId, gameId), eq(schema.players.userId, userId), eq(schema.players.status, "active"))).limit(1);
    if (player === undefined) { await close(); return null; }
    return { db, close, playerId: player.id };
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
      const [hosted, joined] = await Promise.all([
        listHostedGamesQuery(db, userId),
        listJoinedGamesQuery(db, userId),
      ]);
      return { hosted, joined };
    } finally {
      await close();
    }
  },
  async listPublicScenarios() {
    const userId = await resolveViewerUserId();
    if (userId === null) return [];
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      const scenarios = await listPublicScenariosQuery(db, userId);
    return [...LOCAL_DEMO_SCENARIOS, ...scenarios];
    } finally {
      await close();
    }
  },
  async getPublicScenario(scenarioId) {
    const temporaryScenario = findTemporaryDemoScenario(scenarioId);
    if (temporaryScenario !== null) return temporaryScenario;
    const userId = await resolveViewerUserId();
    if (userId === null) return null;
    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
      return await findPublicScenario(db, scenarioId, userId) ?? null;
    } finally {
      await close();
    }
  },
  async createGame(input) {
    const parsed = GameCreationSchema.parse(input);
    const userId = await resolveViewerUserId();
    if (userId === null) throw new Error("An account is required to host a saved game.");
    if (findTemporaryDemoScenario(parsed.scenarioId) !== null) return fixtureGameRepository.createGame(parsed);

    const { db, close } = createDatabase(requiredDatabaseUrl());
    try {
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
      // The threads for these contacts were already opened by the worker's role
      // queue (goal §2c step 6, findOrOpenDialogueThread) before resolvedRole was
      // persisted -- this only looks them up, it never opens one itself.
      const threads = await listDialogueThreads(db, gameId, playerId);
      const cast = parsedRole.data.contacts.map((contact) => {
        const thread = threads.find((candidate) => candidate.npcCharacterId === contact.characterId);
        return { threadId: thread?.threadId ?? contact.characterId, knownName: contact.name, roleLabel: contact.roleLabel };
      });
      const summary = parsedRole.data.immediateEvent.summary;
      return { status: "ready", cast, openingEvent: { title: deriveOpeningTitle(summary), body: summary } };
    } finally {
      await close();
    }
  },
  async getWorld(gameId, lowBandwidth = false, omitGeo = false) {
    if (gameId === DEMO_GAME_ID) return fixtureGameRepository.getWorld(gameId, lowBandwidth, omitGeo);
    const resolved = await currentViewerCharacter(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, characterId } = resolved;
    try {
      const view = await getWorldView(db, gameId);
      if (view === undefined) return null;
      return projectWorldView(view.world, {
        gameId: view.gameId,
        gameTitle: view.gameTitle,
        turnIndex: view.turnIndex,
        turnStatus: view.turnStatus,
        submittedPlayers: view.submittedPlayers,
        totalPlayers: view.totalPlayers,
        lowBandwidth,
        presentationEvents: view.presentationEvents,
        ...(view.scenarioClock === undefined ? {} : { clock: view.scenarioClock }),
      }, characterId);
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
      const view = await getWorldView(db, gameId);
      if (view === undefined) return null;
      const order = await getPlayerOrderForOpenTurn(db, gameId, playerId);
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
    const { db, close, playerId } = resolved;
    try {
      const chronicle = await getChronicleForLatestTurn(db, gameId);
      if (chronicle === undefined) return null;
      const uiState = await getPlayerGameUiState(db, gameId, playerId);
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
    const { db, close, playerId } = resolved;
    try {
      // Persist the durable chronicle read position so a browser closed
      // right after acknowledging still resumes past what was just read.
      const chronicle = await getChronicleForLatestTurn(db, gameId);
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
  async getConversations(gameId, threadId) {
    const resolved = await currentViewerCharacter(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId, characterId: playerCharacterId, world } = resolved;
    try {
      const contacts = await listDialogueThreads(db, gameId, playerId);
      const uiState = await getPlayerGameUiState(db, gameId, playerId);
      const identity = buildContactIdentity(world, uiState?.generatedCast);
      if (threadId === undefined) return projectConversationsView(gameId, playerCharacterId, contacts, null, identity);
      const contact = contacts.find((candidate) => candidate.threadId === threadId);
      if (contact === undefined) return null;
      const messages = await listThreadMessages(db, threadId);
      const known = contact.npcCharacterId === null ? undefined : identity.get(contact.npcCharacterId);
      return projectConversationsView(gameId, playerCharacterId, contacts, {
        threadId,
        npcName: known?.name ?? contact.npcCharacterId ?? "Unknown contact",
        roleLabel: known?.roleLabel ?? "Contact",
        channel: contact.channel,
        messages,
      }, identity);
    } finally {
      await close();
    }
  },
  async findContact(gameId, role) {
    const resolved = await currentViewerCharacter(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId, characterId, world } = resolved;
    try {
      const actor = world.characters.find((candidate) => candidate.id === characterId);
      if (actor === undefined || !actor.alive) return "unavailable";
      const terms = role.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      // This is a deliberately conservative deterministic first pass: only
      // people in the actor's current locality can be matched, so a role query
      // cannot become a world-wide character oracle. The M2 resolver can add
      // Focus/institution templates and the metered novel-role fallback once
      // the scenario projection is available to this repository.
      const matches = world.characters.filter((candidate) => {
        if (candidate.id === characterId || !candidate.alive || candidate.locationProvinceId !== actor.locationProvinceId) return false;
        const identity = `${candidate.name} ${candidate.officeId ?? ""}`.toLocaleLowerCase();
        return terms.length > 0 && terms.every((term) => identity.includes(term));
      });
      // Do not silently pick an ambiguous office-holder. Until the choice view
      // is persisted, the same non-revealing unavailable response is safer.
      if (matches.length !== 1) return "unavailable";
      const npc = matches[0];
      if (npc === undefined) return "unavailable";
      return await findOrOpenDialogueThread(db, { gameId, playerId, playerCharacterId: characterId, npcCharacterId: npc.id });
    } finally {
      await close();
    }
  },
  async sendDialogue(gameId, threadId, body, requestId) {
    const resolved = await currentViewerCharacter(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { close, characterId } = resolved;
    try {
      await sendPlayerDialogueMessage(resolved.db, {
        threadId,
        playerId: resolved.playerId,
        speakerCharacterId: characterId,
        body,
        ...(requestId === undefined ? {} : { requestId }),
      });
    } finally {
      await close();
    }
  },
  async getChatOverview(gameId) {
    const resolved = await currentViewerCharacter(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId, characterId: playerCharacterId, world } = resolved;
    try {
      const contacts = await listDialogueThreads(db, gameId, playerId);
      const uiState = await getPlayerGameUiState(db, gameId, playerId);
      const identity = buildContactIdentity(world, uiState?.generatedCast);
      // Reuses the same contact projection getConversations does, rather than
      // re-deriving ContactView fields from ContactRow a second time here.
      const view = projectConversationsView(gameId, playerCharacterId, contacts, null, identity);
      return ChatOverviewResponseSchema.parse({
        gameId,
        playerCharacterId,
        contacts: view.contacts,
        selectedThreadId: uiState?.selectedThreadId ?? null,
      });
    } finally {
      await close();
    }
  },
  async discoverContact(gameId, role) {
    const result = await postgresGameRepository.findContact(gameId, role);
    if (result !== "unavailable") return { status: "found", threadId: result };

    // No deterministic match: enqueue a worker-side resolve_contact AI operation
    // and return "resolving" immediately so the UI can show a pending state.
    const resolved = await currentViewerCharacter(gameId);
    if (resolved === null) {
      return { status: "unavailable", explanation: "This account cannot access the save." };
    }
    const { db, close, playerId, characterId } = resolved;
    try {
      const threadId = await openProvisionalContactThread(db, {
        gameId,
        playerId,
        playerCharacterId: characterId,
        roleQuery: role,
      });
      return { status: "resolving", threadId };
    } catch {
      return { status: "unavailable", explanation: `No one known as "${role}" could be found nearby.` };
    } finally {
      await close();
    }
  },
  async sendChatMessage(gameId, threadId, body, requestId) {
    const resolved = await currentViewerCharacter(gameId);
    if (resolved === null) throw new Error("This account or guest session cannot access the save.");
    const { db, close, playerId, characterId } = resolved;
    try {
      return await sendPlayerDialogueMessage(db, {
        threadId,
        playerId,
        speakerCharacterId: characterId,
        body,
        ...(requestId === undefined ? {} : { requestId }),
      });
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
};

/**
 * Real name/role per npcCharacterId, for chat contact display.
 *
 * `dialogue_sessions.npc_character_id` is just an id -- the readable name and
 * role live on the world's materialized Character (once applyCharacterIntroductions
 * has run) and, before that turn resolves, on the freshly generated cast
 * (player_game_ui_state.generatedCast). The generated cast wins when both are
 * present since its roleLabel is the specific one the player was shown at
 * declaration time, not a bare officeId.
 */
function buildContactIdentity(
  world: { readonly characters: readonly { readonly id: string; readonly name: string; readonly officeId: string | null }[] },
  generatedCast: unknown,
): ReadonlyMap<string, { readonly name: string; readonly roleLabel: string }> {
  const identity = new Map<string, { name: string; roleLabel: string }>();
  for (const character of world.characters) {
    identity.set(character.id, { name: character.name, roleLabel: character.officeId ?? "Contact" });
  }
  const parsed = ResolvedRoleSchema.safeParse(generatedCast);
  if (parsed.success) {
    for (const contact of parsed.data.contacts) {
      identity.set(contact.characterId, { name: contact.name, roleLabel: contact.roleLabel });
    }
  }
  return identity;
}

/** The signed-in viewer's player row and claimed character for one game, or null in fixture/demo mode. */
async function currentViewerCharacter(gameId: string) {
  const resolved = await resolvePlayer(gameId);
  if (resolved === null) return null;
  const { db, close, playerId } = resolved;
  const view = await getWorldView(db, gameId);
  if (view === undefined) {
    await close();
    return null;
  }
  const [player] = await db
    .select({ characterId: schema.players.characterId })
    .from(schema.players)
    .where(eq(schema.players.id, playerId))
    .limit(1);
  const characterId = player?.characterId ?? view.world.characters[0]?.id ?? "";
  return { db, close, playerId, characterId, world: view.world };
}

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
