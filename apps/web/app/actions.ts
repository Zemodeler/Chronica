"use server";

import {
  DeveloperGiftCreateSchema,
  CredentialLoginSchema,
  CredentialRegistrationSchema,
  EmailAttachmentSchema,
  GameCreationSchema,
  GiftRedemptionSchema,
  PasswordResetRequestSchema,
  ProductSelectionSchema,
  ProfileUpdateSchema,
} from "@chronica/shared";
import { SlotCapError } from "@chronica/db";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { getAuthentication, isAuthenticationConfigured } from "../lib/authentication";
import { gameRepository } from "../lib/game-repository";
import { createGift, redeemGift as redeemAccountGift, revokeGift, saveAccountProfile, selectDeveloperLocalAiConfiguration } from "../lib/account-service";
import { confirmDeclaredCharacter, declareCharacter, reviseDeclaredCharacter } from "../lib/character-service";

const textValue = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

const gamePath = (gameId: string, suffix = ""): string =>
  `/games/${encodeURIComponent(gameId)}${suffix}`;

export async function registerCredentials(formData: FormData): Promise<never> {
  const username = textValue(formData, "username");
  const parsed = CredentialRegistrationSchema.safeParse({ username, password: textValue(formData, "password"), passwordConfirmation: textValue(formData, "passwordConfirmation") });
  const signUpError = (status: string): never => redirect(`/sign-up?status=${status}&username=${encodeURIComponent(username)}#status`);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    return signUpError(path === "username" ? "invalid_username" : path === "passwordConfirmation" ? "password_mismatch" : "invalid_password");
  }
  if (!isAuthenticationConfigured()) redirect("/sign-up?status=unavailable#status");
  try {
    await getAuthentication().api.signUpEmail({ body: { username: parsed.data.username, name: parsed.data.username, password: parsed.data.password, email: `account-${randomUUID()}@identity.chronica.invalid`, callbackURL: "/account" }, headers: await headers() });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "USERNAME_IS_ALREADY_TAKEN") signUpError("username_taken");
    redirect("/sign-up?status=unavailable#status");
  }
  redirect("/account");
}

export async function loginWithCredentials(formData: FormData): Promise<never> {
  const parsed = CredentialLoginSchema.safeParse({ username: textValue(formData, "username"), password: textValue(formData, "password") });
  if (!parsed.success || !isAuthenticationConfigured()) redirect("/login?status=invalid#status");
  try {
    await getAuthentication().api.signInUsername({ body: { ...parsed.data, callbackURL: "/account" }, headers: await headers() });
  } catch {
    redirect("/login?status=invalid#status");
  }
  redirect("/account");
}

export async function beginGoogleSignIn(): Promise<never> {
  if (!isAuthenticationConfigured()) redirect("/login?status=invalid#status");
  try {
    const result = await getAuthentication().api.signInSocial({ body: { provider: "google", callbackURL: "/account" }, headers: await headers() });
    if (result.url) redirect(result.url);
  } catch { /* Configuration and provider failures return to the login screen. */ }
  redirect("/login?status=invalid#status");
}

export async function attachEmail(formData: FormData): Promise<never> {
  const parsed = EmailAttachmentSchema.safeParse({ email: textValue(formData, "email") });
  if (!parsed.success || !isAuthenticationConfigured()) redirect("/account?email=invalid#email-status");
  try {
    await getAuthentication().api.changeEmail({ body: { newEmail: parsed.data.email, callbackURL: "/account?email=verified#email-status" }, headers: await headers() });
  } catch {
    redirect("/account?email=invalid#email-status");
  }
  redirect("/account?email=sent#email-status");
}

export async function requestPasswordReset(formData: FormData): Promise<never> {
  const parsed = PasswordResetRequestSchema.safeParse({ email: textValue(formData, "email") });
  if (parsed.success && isAuthenticationConfigured()) {
    try { await getAuthentication().api.requestPasswordReset({ body: { email: parsed.data.email, redirectTo: "/login?status=password-reset" }, headers: await headers() }); } catch { /* Keep a generic response. */ }
  }
  redirect("/forgot-password?status=sent#status");
}

export async function createGame(formData: FormData): Promise<never> {
  const parsed = GameCreationSchema.safeParse({
    title: textValue(formData, "title"),
    scenarioId: textValue(formData, "scenarioId"),
    continuity: {
      startingSeatCount: 1,
      extraPrincipalsPerPlayer: 0,
    },
    newsTimeoutSeconds: 60,
    coinCap: textValue(formData, "coinCap"),
  });
  if (!parsed.success) redirect("/games/new?status=invalid#status");
  let gameId: string;
  try {
    gameId = await gameRepository.createGame(parsed.data);
  } catch (error) {
    if (error instanceof SlotCapError) {
      redirect(`/games/new?scenario=${encodeURIComponent(parsed.data.scenarioId)}&status=save-limit#status`);
    }
    redirect(`/games/new?scenario=${encodeURIComponent(parsed.data.scenarioId)}&status=unavailable#status`);
  }
  redirect(gamePath(gameId, "?status=created"));
}

export async function acknowledgeNews(formData: FormData): Promise<never> {
  const gameId = textValue(formData, "gameId");
  await gameRepository.acknowledgeNews(gameId);
  redirect(gamePath(gameId, "?status=ready#status"));
}

export async function requestGameEnd(formData: FormData): Promise<never> {
  const gameId = textValue(formData, "gameId");
  await gameRepository.endGame(gameId);
  redirect(gamePath(gameId, "?status=end-requested#status"));
}

/**
 * A save slot is a host's active game. Deleting it finishes the game and frees
 * the slot, while preserving the match record needed for replay and audit.
 */
export async function deleteSaveSlot(formData: FormData): Promise<never> {
  const gameId = textValue(formData, "gameId");
  await gameRepository.endGame(gameId);
  redirect("/?status=deleted#status");
}

export async function redeemGift(formData: FormData): Promise<never> {
  const parsed = GiftRedemptionSchema.safeParse({ code: textValue(formData, "code") });
  const result = parsed.success
    ? isAuthenticationConfigured() ? await redeemAccountGift(await headers(), parsed.data.code) : await gameRepository.redeemGift(parsed.data.code)
    : "invalid";
  redirect(`/account?gift=${result}#gift-status`);
}

export async function beginCheckout(formData: FormData): Promise<never> {
  const parsed = ProductSelectionSchema.safeParse({ productSlug: textValue(formData, "productSlug") });
  if (!parsed.success) redirect("/account?checkout=invalid#checkout-status");
  await Promise.resolve();
  redirect("/account?checkout=unavailable#checkout-status");
}

export async function openCustomerPortal(): Promise<never> {
  await Promise.resolve();
  redirect("/account?checkout=unavailable#checkout-status");
}

export async function resumeGame(formData: FormData): Promise<never> {
  const gameId = textValue(formData, "gameId");
  const resumed = await gameRepository.resumeGame(gameId);
  redirect(`/account?resume=${resumed ? "resumed" : "unavailable"}#resume-status`);
}

export async function createAdminGift(formData: FormData): Promise<never> {
  const parsed = DeveloperGiftCreateSchema.safeParse({
    grantCoins: textValue(formData, "grantCoins"),
    codeExpiresAt: textValue(formData, "codeExpiresAt"),
    grantedCoinsExpireAt: textValue(formData, "grantedCoinsExpireAt"),
    auditNote: textValue(formData, "auditNote"),
  });
  if (!parsed.success) redirect("/admin?developer=invalid#developer-status");
  const code = await createGift(await headers(), parsed.data);
  if (code === "unavailable") redirect("/admin?developer=unavailable#developer-status");
  if (code === null) redirect("/admin?developer=reauth#developer-status");
  (await cookies()).set("chronica_created_gift", code.code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 300, path: "/account" });
  redirect("/account/gift-created");
}

export async function updateProfile(formData: FormData): Promise<never> {
  const parsed = ProfileUpdateSchema.safeParse({ displayName: textValue(formData, "displayName"), username: textValue(formData, "username"), avatarKey: textValue(formData, "avatarKey") });
  if (!parsed.success) redirect("/account?profile=invalid#profile-status");
  const result = await saveAccountProfile(await headers(), parsed.data);
  redirect(`/account?profile=${result}#profile-status`);
}

export async function createDeveloperGift(formData: FormData): Promise<never> {
  const parsed = DeveloperGiftCreateSchema.safeParse({
    grantCoins: textValue(formData, "grantCoins"),
    codeExpiresAt: textValue(formData, "codeExpiresAt"),
    grantedCoinsExpireAt: textValue(formData, "grantedCoinsExpireAt"),
    auditNote: textValue(formData, "auditNote"),
  });
  if (!parsed.success) redirect("/account?developer=invalid#developer-status");
  const code = await createGift(await headers(), parsed.data);
  if (code === "unavailable") redirect("/account?developer=unavailable#developer-status");
  if (code === null) redirect("/account?developer=reauth#developer-status");
  (await cookies()).set("chronica_created_gift", code.code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 300, path: "/account" });
  redirect("/account/gift-created");
}

export async function revokeDeveloperGift(formData: FormData): Promise<never> {
  const changed = await revokeGift(await headers(), textValue(formData, "giftCodeId"), textValue(formData, "auditReason"));
  redirect(`/account?developer=${changed ? "revoked" : "reauth"}#developer-status`);
}

export async function selectLocalAiProvider(formData: FormData): Promise<never> {
  const value = textValue(formData, "provider");
  if (value !== "openai" && value !== "anthropic") redirect("/account?aiProvider=invalid#ai-provider-status");
  const result = await selectDeveloperLocalAiConfiguration(await headers(), value, textValue(formData, "model"));
  redirect(`/account?aiProvider=${result}#ai-provider-status`);
}

export async function signOut(): Promise<never> {
  if (isAuthenticationConfigured()) await getAuthentication().api.signOut({ headers: await headers() });
  redirect("/login?status=signed-out#status");
}

export async function submitCharacterDeclaration(formData: FormData): Promise<{ status: string; confirmationDraft?: string; canonicalName?: string; origin?: string; startingMoney?: number; currencyName?: string; error?: string }> {
  const gameId = textValue(formData, "gameId");
  const playerInput = textValue(formData, "playerInput");
  if (gameId === "" || playerInput.trim().length < 2) return { status: "invalid" };
  const result = await declareCharacter(gameId, playerInput);
  if (result.status === "draft") {
    return { status: "draft", confirmationDraft: result.draft.confirmationDraft, canonicalName: result.draft.canonicalName, origin: result.draft.origin, startingMoney: result.draft.startingMoney, currencyName: result.draft.currencyName };
  }
  if (result.status === "error") return { status: result.status, error: result.message };
  return { status: result.status };
}

export async function reviseCharacterDeclaration(formData: FormData): Promise<{ status: string; confirmationDraft?: string; canonicalName?: string; origin?: string; startingMoney?: number; currencyName?: string; error?: string }> {
  const gameId = textValue(formData, "gameId");
  const revision = textValue(formData, "revision");
  if (gameId === "") return { status: "invalid" };
  const result = await reviseDeclaredCharacter(gameId, revision);
  if (result.status === "draft") {
    return { status: "draft", confirmationDraft: result.draft.confirmationDraft, canonicalName: result.draft.canonicalName, origin: result.draft.origin, startingMoney: result.draft.startingMoney, currencyName: result.draft.currencyName };
  }
  if (result.status === "error") return { status: result.status, error: result.message };
  return { status: result.status };
}

export async function confirmCharacterDeclaration(formData: FormData): Promise<never> {
  const gameId = textValue(formData, "gameId");
  if (gameId !== "") await confirmDeclaredCharacter(gameId);
  redirect(`/games/${encodeURIComponent(gameId)}`);
}
