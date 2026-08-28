import type { AvatarKey, ProfileUpdate } from "@chronica/shared";
import { and, count, eq, gt, lte, ne, sql } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { authRequestLimits, users } from "../schema/auth";
import { players } from "../schema/game";

export const ZEMODELER_EMAIL = "andrei.dodu@icloud.com";

export type AccountProfileRow = Readonly<{
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  username: string | null;
  avatarKey: AvatarKey;
  role: "user" | "developer" | "admin";
}>;

export async function bootstrapDeveloperAccount(db: ChronicaDatabase, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (user === undefined || !user.emailVerified) return;
    if (user.emailVerifiedAt === null || user.name.trim() === "" || user.name.toLowerCase() === user.email.toLowerCase()) {
      await tx.update(users).set({
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        name: user.name.trim() === "" || user.name.toLowerCase() === user.email.toLowerCase() ? (user.email.split("@")[0] || "Chronica player").slice(0, 80) : user.name,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
    }
    if (user.email.toLowerCase() !== ZEMODELER_EMAIL) return;
    const [collision] = await tx.select({ id: users.id }).from(users)
      .where(and(sql`lower(${users.username}) = 'zemodeler'`, ne(users.id, userId))).limit(1);
    if (collision !== undefined) throw new Error("The reserved Zemodeler username is already occupied.");
    await tx.update(users).set({
      name: "Zemodeler",
      username: "zemodeler",
      role: "admin",
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
  });
}

export async function getAccountProfile(db: ChronicaDatabase, userId: string): Promise<AccountProfileRow | null> {
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    emailVerified: users.emailVerified,
    displayName: users.name,
    username: users.username,
    avatarKey: users.avatarKey,
    role: users.role,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (user === undefined) return null;
  return { ...user, avatarKey: user.avatarKey as AvatarKey };
}

export async function updateAccountProfile(
  db: ChronicaDatabase,
  userId: string,
  profile: ProfileUpdate,
): Promise<"updated" | "username_taken" | "not_found"> {
  const username = profile.username === "" ? null : profile.username;
  if (username !== null) {
    const [collision] = await db.select({ id: users.id }).from(users)
      .where(and(sql`lower(${users.username}) = ${username}`, ne(users.id, userId))).limit(1);
    if (collision !== undefined) return "username_taken";
  }
  try {
    const updated = await db.update(users).set({
      name: profile.displayName,
      username,
      avatarKey: profile.avatarKey,
      updatedAt: new Date(),
    }).where(eq(users.id, userId)).returning({ id: users.id });
    return updated.length === 0 ? "not_found" : "updated";
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return "username_taken";
    throw error;
  }
}

/** Distributed fixed-window guard. Call with HMACs, never raw email/IP values. */
export async function consumeAuthRequestLimit(
  db: ChronicaDatabase,
  keyHashes: readonly string[],
  now: Date,
  maximum = 5,
  windowSeconds = 60,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1_000);
  return db.transaction(async (tx) => {
    for (const keyHash of keyHashes) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${keyHash}))`);
      await tx.delete(authRequestLimits).where(and(eq(authRequestLimits.keyHash, keyHash), lte(authRequestLimits.requestedAt, cutoff)));
      const [result] = await tx.select({ value: count(authRequestLimits.id) })
        .from(authRequestLimits)
        .where(and(eq(authRequestLimits.keyHash, keyHash), gt(authRequestLimits.requestedAt, cutoff)));
      if ((result?.value ?? 0) >= maximum) return false;
    }
    await tx.insert(authRequestLimits).values(keyHashes.map((keyHash) => ({ keyHash, requestedAt: now })));
    return true;
  });
}

export async function attachGuestSeatToAccount(
  db: ChronicaDatabase,
  input: Readonly<{ gameId: string; playerId: string; guestSessionVersion: number; userId: string }>,
): Promise<"attached" | "already_joined" | "invalid"> {
  return db.transaction(async (tx) => {
    const [guest] = await tx.select().from(players).where(and(
      eq(players.id, input.playerId),
      eq(players.gameId, input.gameId),
      eq(players.guestSessionVersion, input.guestSessionVersion),
      eq(players.status, "active"),
    )).for("update").limit(1);
    if (guest === undefined || guest.userId !== null) return "invalid";
    const [existing] = await tx.select({ id: players.id }).from(players).where(and(
      eq(players.gameId, input.gameId), eq(players.userId, input.userId), eq(players.status, "active"),
    )).limit(1);
    if (existing !== undefined) return "already_joined";
    await tx.update(players).set({ userId: input.userId, guestSessionVersion: input.guestSessionVersion + 1 })
      .where(eq(players.id, input.playerId));
    return "attached";
  });
}
