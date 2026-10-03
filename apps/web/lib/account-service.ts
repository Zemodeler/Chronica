import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { formatCoins, MICRO_UNITS_PER_COIN } from "@chronica/billing";
import {
  attachGuestSeatToAccount,
  bootstrapDeveloperAccount,
  createDatabase,
  createDeveloperGiftCode,
  getAccountProfile,
  getCoinWalletSnapshot,
  listDeveloperGiftCodes,
  listHostedGames,
  listJoinedGames,
  listPaymentPausedGames,
  redeemDeveloperGiftCode,
  revokeDeveloperGiftCode,
  updateAccountProfile,
} from "@chronica/db";
import type { AccountDashboardViewModel, DeveloperGiftCreate, ProfileUpdate } from "@chronica/shared";
import { prepareHandCodex, selectLocalAiConfiguration, validateLocalAiConfiguration, type LocalAiProvider } from "@chronica/ai";
import { getAuthentication, isAuthenticationConfigured } from "./authentication";

export async function resolveAccount(requestHeaders: Headers) {
  if (!isAuthenticationConfigured()) return null;
  const session = await getAuthentication().api.getSession({ headers: requestHeaders });
  if (session === null) return null;
  const database = createDatabase(requiredDatabaseUrl());
  try {
    const profile = await getAccountProfile(database.db, session.user.id);
    if (profile === null) return null;
    return { ...profile, sessionCreatedAt: new Date(session.session.createdAt) };
  } finally {
    await database.close();
  }
}

export async function resolveVerifiedAccount(requestHeaders: Headers) {
  const account = await resolveAccount(requestHeaders);
  if (account === null || !account.emailVerified) return null;
  const database = createDatabase(requiredDatabaseUrl());
  try {
    await bootstrapDeveloperAccount(database.db, account.id);
    const profile = await getAccountProfile(database.db, account.id);
    return profile === null || !profile.emailVerified ? null : { ...profile, sessionCreatedAt: account.sessionCreatedAt };
  } finally {
    await database.close();
  }
}

export async function loadAccountDashboard(requestHeaders: Headers): Promise<AccountDashboardViewModel | null> {
  const account = await resolveAccount(requestHeaders);
  if (account === null) return null;
  const database = createDatabase(requiredDatabaseUrl());
  try {
    const [wallet, hostedSaves, joinedSaves, pausedGames] = await Promise.all([
      getCoinWalletSnapshot(database.db, account.id),
      listHostedGames(database.db, account.id),
      listJoinedGames(database.db, account.id),
      listPaymentPausedGames(database.db, account.id),
    ]);
    return {
      displayName: account.displayName,
      email: account.email,
      emailVerified: account.emailVerified,
      username: account.username,
      avatarKey: account.avatarKey,
      role: account.role,
      availableCoins: formatCoins(wallet.availableMicroUnits),
      heldCoins: formatCoins(wallet.heldMicroUnits),
      debtCoins: formatCoins(wallet.debtMicroUnits),
      lots: wallet.lots.map((lot) => ({
        id: lot.id,
        sourceLabel: lot.sourceKind === "gift" ? "Developer gift" : lot.sourceKind,
        remainingCoins: formatCoins(lot.remainingMicroUnits),
        heldCoins: formatCoins(lot.heldMicroUnits),
        expiresLabel: lot.expiresAt?.toISOString() ?? "Does not expire",
      })),
      history: wallet.history.map((entry) => ({
        id: entry.id,
        whenLabel: entry.createdAt.toISOString(),
        kind: entry.kind,
        amountLabel: `${entry.signedMicroUnits >= 0n ? "+" : ""}${formatCoins(entry.signedMicroUnits)} coins`,
        reason: entry.reason,
      })),
      pausedGames: pausedGames.map((game) => ({ ...game, requiredCoins: "0" })),
      hostedSaves,
      joinedSaves,
    };
  } finally {
    await database.close();
  }
}

export async function saveAccountProfile(requestHeaders: Headers, profile: ProfileUpdate) {
  // A user must be able to set a public identity before adding a recovery email.
  const account = await resolveAccount(requestHeaders);
  if (account === null) return "unauthorized" as const;
  const database = createDatabase(requiredDatabaseUrl());
  try {
    return await updateAccountProfile(database.db, account.id, profile);
  } finally {
    await database.close();
  }
}

export async function createGift(requestHeaders: Headers, input: DeveloperGiftCreate): Promise<{ code: string } | null | "unavailable"> {
  const account = await resolveFreshDeveloper(requestHeaders);
  if (account === null) return null;
  if (!isGiftCodeConfigurationAvailable()) return "unavailable";
  const rawCode = `CHR-${randomBytes(18).toString("base64url").toUpperCase()}`;
  const database = createDatabase(requiredDatabaseUrl());
  try {
    await createDeveloperGiftCode(database.db, {
      developerUserId: account.id,
      codeHash: hashGiftCode(rawCode),
      grantMicroUnits: parseCoins(input.grantCoins),
      codeExpiresAt: input.codeExpiresAt ? new Date(input.codeExpiresAt) : null,
      grantedCoinsExpireAt: input.grantedCoinsExpireAt ? new Date(input.grantedCoinsExpireAt) : null,
      // Gift codes are intentionally single-use. A successful redemption
      // changes their state to "redeemed" in the same database transaction.
      maxRedemptions: 1,
      perAccountLimit: 1,
      auditNote: input.auditNote,
    });
    return { code: rawCode };
  } finally {
    await database.close();
  }
}

export async function redeemGift(requestHeaders: Headers, rawCode: string) {
  const account = await resolveAccount(requestHeaders);
  if (account === null) return "unauthorized" as const;
  if (!isGiftCodeConfigurationAvailable()) return "unavailable" as const;
  const database = createDatabase(requiredDatabaseUrl());
  try {
    return await redeemDeveloperGiftCode(database.db, { userId: account.id, codeHash: hashGiftCode(rawCode), redeemedAt: new Date() });
  } finally {
    await database.close();
  }
}

function canManageGifts(role: string | undefined): boolean {
  return role === "developer" || role === "admin";
}

export async function developerGiftList(requestHeaders: Headers) {
  const account = await resolveAccount(requestHeaders);
  if (account === null || !canManageGifts(account.role)) return [];
  const database = createDatabase(requiredDatabaseUrl());
  try { return await listDeveloperGiftCodes(database.db, account.id); }
  finally { await database.close(); }
}

export async function revokeGift(requestHeaders: Headers, giftCodeId: string, auditReason: string): Promise<boolean> {
  const account = await resolveFreshDeveloper(requestHeaders);
  if (account === null) return false;
  const database = createDatabase(requiredDatabaseUrl());
  try { return await revokeDeveloperGiftCode(database.db, account.id, giftCodeId, auditReason); }
  finally { await database.close(); }
}

export async function selectDeveloperLocalAiConfiguration(requestHeaders: Headers, provider: LocalAiProvider, model: string): Promise<"updated" | "unauthorized" | "unavailable" | "connection_failed"> {
  const account = await resolveFreshDeveloper(requestHeaders);
  if (account === null) return "unauthorized";
  try { validateLocalAiConfiguration(provider, model); } catch { return "unavailable"; }
  if (provider === "codex") {
    try { await prepareHandCodex(); } catch { return "connection_failed"; }
  }
  try {
    selectLocalAiConfiguration(provider, model);
    return "updated";
  } catch {
    return "unavailable";
  }
}

export async function getAvailableCoins(requestHeaders: Headers): Promise<string | null> {
  const account = await resolveAccount(requestHeaders);
  if (account === null) return null;
  const database = createDatabase(requiredDatabaseUrl());
  try {
    const wallet = await getCoinWalletSnapshot(database.db, account.id);
    return formatCoins(wallet.availableMicroUnits);
  } catch {
    return null;
  } finally {
    await database.close();
  }
}

export async function claimGuestSeat(requestHeaders: Headers, guest: { gameId: string; playerId: string; guestSessionVersion: number }) {
  const account = await resolveAccount(requestHeaders);
  if (account === null) return "invalid" as const;
  const database = createDatabase(requiredDatabaseUrl());
  try { return await attachGuestSeatToAccount(database.db, { ...guest, userId: account.id }); }
  finally { await database.close(); }
}

function parseCoins(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * MICRO_UNITS_PER_COIN + BigInt(fraction.padEnd(6, "0"));
}

function hashGiftCode(rawCode: string): string {
  const pepper = process.env.CHRONICA_GIFT_CODE_PEPPER?.trim();
  if (!pepper) throw new Error("CHRONICA_GIFT_CODE_PEPPER is required for gift codes.");
  return createHmac("sha256", pepper).update(rawCode.trim().toUpperCase()).digest("hex");
}

function isGiftCodeConfigurationAvailable(): boolean {
  return Boolean(process.env.CHRONICA_GIFT_CODE_PEPPER?.trim());
}

async function resolveFreshDeveloper(headers: Headers) {
  const account = await resolveAccount(headers);
  if (account === null || !canManageGifts(account.role)) return null;
  if (Date.now() - account.sessionCreatedAt.getTime() > 4 * 60 * 60 * 1_000) return null;
  return account;
}

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required.");
  return value;
}
