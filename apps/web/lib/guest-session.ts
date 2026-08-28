import { createHmac, timingSafeEqual } from "node:crypto";

export const GUEST_COOKIE_NAME = "chronica_guest";
const GUEST_SESSION_SECONDS = 30 * 24 * 60 * 60;

export type GuestIdentity = Readonly<{
  gameId: string;
  playerId: string;
  guestSessionVersion: number;
  expiresAt: number;
}>;

export function createGuestSessionValue(
  identity: Omit<GuestIdentity, "expiresAt">,
  secret: string,
  issuedAt: Date,
): string {
  if (secret.length < 32) throw new TypeError("Guest session secret must be at least 32 characters.");
  const payload = Buffer.from(JSON.stringify({
    ...identity,
    expiresAt: Math.floor(issuedAt.getTime() / 1000) + GUEST_SESSION_SECONDS,
  }), "utf8").toString("base64url");
  return `${payload}.${signatureFor(payload, secret)}`;
}

export function readGuestSessionValue(value: string, secret: string, now: Date): GuestIdentity | null {
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra !== undefined || secret.length < 32) return null;
  const expectedSignature = signatureFor(payload, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!isGuestIdentity(parsed) || parsed.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function signatureFor(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function isGuestIdentity(value: unknown): value is GuestIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.gameId === "string"
    && typeof candidate.playerId === "string"
    && Number.isInteger(candidate.guestSessionVersion)
    && typeof candidate.expiresAt === "number"
    && Number.isInteger(candidate.expiresAt);
}
