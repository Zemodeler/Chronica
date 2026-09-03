import { z } from "zod";
import { OrderBatchSchema, OngoingActionSchema } from "./actions/index";
import { ContinuityConfigSchema } from "./continuity/index";
import { DialogueChannelSchema, DialogueMessageSchema } from "./dialogue/index";
import { EntityIdSchema } from "./material-state";
import { MaterialWorldViewModelSchema } from "./material-view";
import { CrossingTypeSchema, DetailTierSchema, DynamicMapOverlaySchema, GeoJsonMapSchema } from "./world/index";
import { AccountRoleSchema, AvatarKeySchema, CoinAmountStringSchema } from "./coins";

export const EmailAddressSchema = z.string().trim().email().max(254);

export const UsernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/);
export const PasswordSchema = z.string().min(8).max(128);

export const CredentialLoginSchema = z.object({ username: UsernameSchema, password: PasswordSchema }).strict();
export type CredentialLogin = z.infer<typeof CredentialLoginSchema>;

export const CredentialRegistrationSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  passwordConfirmation: PasswordSchema,
}).strict().refine((value) => value.password === value.passwordConfirmation, {
  path: ["passwordConfirmation"],
  message: "Passwords must match.",
});
export type CredentialRegistration = z.infer<typeof CredentialRegistrationSchema>;

export const EmailAttachmentSchema = z.object({ email: EmailAddressSchema }).strict();
export type EmailAttachment = z.infer<typeof EmailAttachmentSchema>;

export const PasswordResetRequestSchema = z.object({ email: EmailAddressSchema }).strict();
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const GameCreationSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    scenarioId: EntityIdSchema,
    continuity: ContinuityConfigSchema,
    newsTimeoutSeconds: z.number().int().min(15).max(600).default(60),
    coinCap: CoinAmountStringSchema,
  })
  .strict();
export type GameCreation = z.infer<typeof GameCreationSchema>;

export const GamePhaseSchema = z.enum([
  "lobby",
  "collecting",
  "queued",
  "resolving",
  "news",
  "resolved",
  "finished",
  "failed",
  "payment_paused",
]);
export type GamePhase = z.infer<typeof GamePhaseSchema>;

export const CharacterChoiceSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(160),
    pitch: z.string().trim().min(1).max(500),
    station: z.string().trim().min(1).max(160),
    location: z.string().trim().min(1).max(160),
    claimedByPlayerId: EntityIdSchema.nullable(),
  })
  .strict();
export type CharacterChoice = z.infer<typeof CharacterChoiceSchema>;

export const CharacterClaimSchema = z.discriminatedUnion("origin", [
  z.object({ origin: z.literal("suggested"), characterId: EntityIdSchema }).strict(),
  z.object({ origin: z.literal("declared"), declaration: z.string().trim().min(3).max(500) }).strict(),
]);
export type CharacterClaim = z.infer<typeof CharacterClaimSchema>;

export const LobbyViewModelSchema = z
  .object({
    gameId: EntityIdSchema,
    title: z.string().trim().min(1),
    hostName: z.string().trim().min(1),
    startingSeatCount: z.number().int().positive(),
    occupiedSeatCount: z.number().int().nonnegative(),
    extraPrincipalsPerPlayer: z.number().int().min(0).max(3),
    principalCapacity: z.number().int().positive().max(32),
    inviteUrl: z.string().trim().min(1),
    characters: z.array(CharacterChoiceSchema),
  })
  .strict();
export type LobbyViewModel = z.infer<typeof LobbyViewModelSchema>;

export const ProvinceActionSchema = z
  .object({
    id: EntityIdSchema,
    label: z.string().trim().min(1).max(120),
    href: z.string().trim().min(1),
  })
  .strict();
export type ProvinceAction = z.infer<typeof ProvinceActionSchema>;

export const ProvinceViewSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1),
    controller: z.string().trim().min(1),
    terrain: z.string().trim().min(1),
    tier: DetailTierSchema,
    controlLabel: z.string().trim().min(1),
    garrisonLabel: z.string().trim().min(1),
    unrestLabel: z.string().trim().min(1),
    knowledgeLabel: z.string().trim().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    water: z.boolean().optional(),
    neighbours: z.array(
      z
        .object({
          provinceId: EntityIdSchema,
          provinceName: z.string().trim().min(1),
          crossing: CrossingTypeSchema,
        })
        .strict(),
    ),
    actions: z.array(ProvinceActionSchema),
  })
  .strict();
export type ProvinceView = z.infer<typeof ProvinceViewSchema>;

export const ArmyViewSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1),
    location: z.string().trim().min(1),
    commander: z.string().trim().min(1),
    strengthLabel: z.string().trim().min(1),
    currentOrder: z.string().trim().min(1),
  })
  .strict();
export type ArmyView = z.infer<typeof ArmyViewSchema>;

/** Minimal display update to apply when a Chronicle entry is revealed. Pure view data: no model may emit this directly. */
export const DisplayPatchSchema = z
  .object({
    provincesChanged: z
      .array(
        z.object({ id: EntityIdSchema, controller: z.string().optional(), controlLabel: z.string().optional() }).strict(),
      )
      .optional(),
    armiesAdded: z.array(ArmyViewSchema).optional(),
    armiesRemoved: z.array(EntityIdSchema).optional(),
    armiesMoved: z.array(z.object({ id: EntityIdSchema, location: z.string() }).strict()).optional(),
  })
  .strict();
export type DisplayPatch = z.infer<typeof DisplayPatchSchema>;

export const WorldViewModelSchema = z
  .object({
    gameId: EntityIdSchema,
    gameTitle: z.string().trim().min(1),
    phase: GamePhaseSchema,
    turnIndex: z.number().int().nonnegative(),
    elapsedStepLabel: z.string().trim().min(1),
    submittedPlayers: z.number().int().nonnegative(),
    totalPlayers: z.number().int().positive(),
    lowBandwidth: z.boolean(),
    /** GeoJSON is the map contract for authored and developer-private worlds. */
    mapGeoJson: GeoJsonMapSchema.optional(),
    /** Player-scoped mutable control, settlement and force state keyed to the static map asset. */
    mapOverlay: DynamicMapOverlaySchema.optional(),
    provinces: z.array(ProvinceViewSchema),
    armies: z.array(ArmyViewSchema),
    material: MaterialWorldViewModelSchema,
    ongoingActions: z.array(OngoingActionSchema),
  })
  .strict();
export type WorldViewModel = z.infer<typeof WorldViewModelSchema>;

export const OrderReviewSchema = z
  .object({
    gameId: EntityIdSchema,
    batch: OrderBatchSchema,
    payingAccount: z.string().trim().min(1),
    fullCostLabel: z.string().trim().min(1),
    approvalLabel: z.string().trim().min(1),
    progressReadbacks: z.array(z.string().trim().min(1)),
  })
  .strict();
export type OrderReview = z.infer<typeof OrderReviewSchema>;

export const ChronicleEntryViewSchema = z
  .object({
    id: EntityIdSchema,
    sequence: z.number().int().nonnegative(),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    knowledgeStatus: z.enum(["confirmed", "report", "rumour", "suspicion"]).optional(),
    audience: z.enum(["all_players", "knowledge_scoped"]),
    characterKnows: z.boolean(),
    involvementLabel: z.string().trim().min(1),
    /** True when this entry corresponds to a material world change (force, province, etc.). */
    materialConsequence: z.boolean(),
    /** Display update to apply to the staged world when this entry is revealed. Absent for purely narrative entries. */
    displayPatch: DisplayPatchSchema.optional(),
    /** Calendar date projected from the event's deterministic elapsed step. Never includes wall-clock time. */
    dateLabel: z.string().trim().min(1),
  })
  .strict();
export type ChronicleEntryView = z.infer<typeof ChronicleEntryViewSchema>;

export const NewsViewModelSchema = z
  .object({
    gameId: EntityIdSchema,
    turnIndex: z.number().int().nonnegative(),
    phase: GamePhaseSchema,
    entries: z.array(ChronicleEntryViewSchema),
    readyPlayers: z.number().int().nonnegative(),
    totalPlayers: z.number().int().positive(),
    currentPlayerReady: z.boolean(),
    /**
     * Durable read position (`player_game_ui_state.chronicle_read_sequence`);
     * absent for older/fixture data. -1 is the deliberate "nothing read yet"
     * sentinel (matching that column's DB default), not an error case --
     * chronicle sequences themselves start at 0, so -1 never collides with a
     * real entry.
     */
    chronicleReadSequence: z.number().int().min(-1).optional(),
  })
  .strict();
export type NewsViewModel = z.infer<typeof NewsViewModelSchema>;

export const ContactViewSchema = z
  .object({
    sessionId: EntityIdSchema,
    npcCharacterId: z.string(),
    knownName: z.string().trim().min(1),
    roleLabel: z.string().trim().min(1),
    channel: DialogueChannelSchema,
    unread: z.number().int().nonnegative(),
    isGroup: z.boolean(),
  })
  .strict();
export type ContactView = z.infer<typeof ContactViewSchema>;

export const ConversationThreadViewSchema = z
  .object({
    sessionId: EntityIdSchema,
    knownName: z.string().trim().min(1),
    roleLabel: z.string().trim().min(1),
    channelLabel: z.string().trim().min(1),
    messages: z.array(DialogueMessageSchema),
  })
  .strict();
export type ConversationThreadView = z.infer<typeof ConversationThreadViewSchema>;

export const ConversationsViewModelSchema = z
  .object({
    gameId: EntityIdSchema,
    playerCharacterId: z.string(),
    contacts: z.array(ContactViewSchema),
    activeThread: ConversationThreadViewSchema.nullable(),
  })
  .strict();
export type ConversationsViewModel = z.infer<typeof ConversationsViewModelSchema>;

export const ContactDiscoveryResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), sessionId: EntityIdSchema, knownName: z.string().trim().min(1) }).strict(),
  z.object({ status: z.literal("choice"), candidates: z.array(z.object({ characterId: z.string(), name: z.string(), roleLabel: z.string() }).strict()).min(2).max(8) }).strict(),
  z.object({ status: z.literal("unavailable"), explanation: z.string().trim().min(1).max(400) }).strict(),
]);
export type ContactDiscoveryResult = z.infer<typeof ContactDiscoveryResultSchema>;

export const DiscoverContactRequestSchema = z
  .object({ query: z.string().trim().min(1).max(200), characterId: z.string().trim().min(1).optional() })
  .strict();
export type DiscoverContactRequest = z.infer<typeof DiscoverContactRequestSchema>;

export const SendChatMessageRequestSchema = z
  .object({ body: z.string().trim().min(1).max(2_000) })
  .strict();
export type SendChatMessageRequest = z.infer<typeof SendChatMessageRequestSchema>;

export const SendChatMessageResponseSchema = z
  .object({
    playerMessage: DialogueMessageSchema,
    npcReply: DialogueMessageSchema.nullable(),
  })
  .strict();
export type SendChatMessageResponse = z.infer<typeof SendChatMessageResponseSchema>;

export const PatchUiStateRequestSchema = z
  .object({
    selectedThreadId: EntityIdSchema.nullable().optional(),
    chronicleReadSequence: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((value) => value.selectedThreadId !== undefined || value.chronicleReadSequence !== undefined, {
    message: "At least one field must be set.",
  });
export type PatchUiStateRequest = z.infer<typeof PatchUiStateRequestSchema>;

export const PatchUiStateResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type PatchUiStateResponse = z.infer<typeof PatchUiStateResponseSchema>;

export const OrdersStatusResponseSchema = z
  .object({
    gameId: EntityIdSchema,
    turnIndex: z.number().int().nonnegative(),
    submitted: z.boolean(),
    batch: OrderBatchSchema.nullable(),
    ongoingActions: z.array(OngoingActionSchema),
  })
  .strict();
export type OrdersStatusResponse = z.infer<typeof OrdersStatusResponseSchema>;

/** @deprecated Use CoinAmountStringSchema. */
export const CreditAmountStringSchema = CoinAmountStringSchema;

export const CreditLotViewSchema = z
  .object({
    id: EntityIdSchema,
    sourceLabel: z.string().trim().min(1),
    remainingCoins: CoinAmountStringSchema,
    heldCoins: CoinAmountStringSchema,
    expiresLabel: z.string().trim().min(1),
  })
  .strict();

export const AccountDashboardViewModelSchema = z
  .object({
    displayName: z.string().trim().min(1),
    email: EmailAddressSchema,
    emailVerified: z.boolean(),
    username: z.string().nullable(),
    avatarKey: AvatarKeySchema,
    role: AccountRoleSchema,
    availableCoins: CoinAmountStringSchema,
    heldCoins: CoinAmountStringSchema,
    debtCoins: CoinAmountStringSchema,
    lots: z.array(CreditLotViewSchema),
    history: z.array(
      z.object({ id: EntityIdSchema, whenLabel: z.string().min(1), kind: z.string().min(1), amountLabel: z.string().min(1), reason: z.string().min(1) }).strict(),
    ),
    pausedGames: z.array(
      z.object({ gameId: EntityIdSchema, title: z.string().min(1), requiredCoins: CoinAmountStringSchema }).strict(),
    ),
    hostedSaves: z.array(z.object({ gameId: EntityIdSchema, title: z.string().min(1), status: z.string().min(1) }).strict()),
    joinedSaves: z.array(z.object({ gameId: EntityIdSchema, title: z.string().min(1), status: z.string().min(1) }).strict()),
  })
  .strict();
export type AccountDashboardViewModel = z.infer<typeof AccountDashboardViewModelSchema>;

export const GiftRedemptionSchema = z.object({ code: z.string().trim().min(4).max(80) }).strict();
export const ProductSelectionSchema = z.object({ productSlug: EntityIdSchema }).strict();

export const AdminGiftCreationSchema = z
  .object({
    grantCoins: CoinAmountStringSchema,
    maxRedemptions: z.number().int().positive().max(100_000),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

export const LiveGameEventSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(["submission_count", "phase_changed", "turn_opened", "payment_changed", "dialogue_ready"]),
    announcement: z.string().trim().min(1),
    revision: z.number().int().nonnegative().optional(),
    changedSlices: z.array(z.string()).optional(),
    /** Provinces whose controller/firmness changed this turn, so a client can patch just the map overlay. */
    changedRegionIds: z.array(EntityIdSchema).optional(),
  })
  .strict();
export type LiveGameEvent = z.infer<typeof LiveGameEventSchema>;
