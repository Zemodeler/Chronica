import { z } from "zod";
import { ContinuityConfigSchema } from "./continuity/index";
import { DialogueChannelSchema, DialogueMessageSchema } from "./dialogue/index";
import { EntityIdSchema } from "./material-state";
import { DifficultySchema } from "./world/pushback";
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
    coinCap: CoinAmountStringSchema,
    /** How hard the world pushes back, and how much the player starts with (`world/pushback.ts`). */
    difficulty: DifficultySchema.default("normal"),
  })
  .strict();
export type GameCreation = z.infer<typeof GameCreationSchema>;

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
    kind: z.enum(["payment_changed", "dialogue_ready"]),
    announcement: z.string().trim().min(1),
    revision: z.number().int().nonnegative().optional(),
    changedSlices: z.array(z.string()).optional(),
  })
  .strict();
export type LiveGameEvent = z.infer<typeof LiveGameEventSchema>;
