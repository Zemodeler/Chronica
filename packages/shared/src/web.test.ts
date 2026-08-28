import { describe, expect, it } from "vitest";
import {
  GameCreationSchema,
  InviteAcceptanceSchema,
  LiveGameEventSchema,
  CredentialLoginSchema,
  CredentialRegistrationSchema,
  EmailAttachmentSchema,
  OrderBatchSchema,
  ProfileUpdateSchema,
} from "./index";

describe("web boundary contracts", () => {
  it("accepts the full 1–32 player range while keeping continuity bounded", () => {
    const valid = GameCreationSchema.safeParse({
      title: "The Sicilian Crisis",
      scenarioId: "sicily-m1",
      continuity: { startingSeatCount: 5, extraPrincipalsPerPlayer: 1 },
      newsTimeoutSeconds: 60,
      coinCap: "10",
    });
    const invalid = GameCreationSchema.safeParse({
      title: "The Sicilian Crisis",
      scenarioId: "sicily-m1",
      continuity: { startingSeatCount: 5, extraPrincipalsPerPlayer: 4 },
      newsTimeoutSeconds: 60,
      coinCap: "10",
    });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
    for (const startingSeatCount of [1, 6, 32]) {
      expect(GameCreationSchema.safeParse({
        title: "A shared world",
        scenarioId: "shared-world",
        continuity: { startingSeatCount, extraPrincipalsPerPlayer: 1 },
        newsTimeoutSeconds: 60,
        coinCap: "10",
      }).success).toBe(true);
    }
    expect(GameCreationSchema.safeParse({
      title: "Too many players",
      scenarioId: "shared-world",
      continuity: { startingSeatCount: 33, extraPrincipalsPerPlayer: 1 },
      newsTimeoutSeconds: 60,
      coinCap: "10",
    }).success).toBe(false);
  });

  it("keeps exact OrderBatch limits as the form submission authority", () => {
    expect(OrderBatchSchema.safeParse({ directives: [{ kind: "new", text: "Hold the road" }] }).success).toBe(true);
    // Raised from 8 to 32 in M1.5 (ADR-0039): chat-style composer has no fixed slot count.
    expect(OrderBatchSchema.safeParse({ directives: Array.from({ length: 32 }, () => ({ kind: "new", text: "Wait" })) }).success).toBe(true);
    expect(OrderBatchSchema.safeParse({ directives: Array.from({ length: 33 }, () => ({ kind: "new", text: "Wait" })) }).success).toBe(false);
  });

  it("validates credential and email-attachment input at the boundary", () => {
    expect(CredentialLoginSchema.safeParse({ username: "host_player", password: "a-long-password" }).success).toBe(true);
    expect(CredentialRegistrationSchema.safeParse({ username: "host_player", password: "a-long-password", passwordConfirmation: "a-long-password" }).success).toBe(true);
    expect(CredentialRegistrationSchema.safeParse({ username: "host player", password: "a-long-password", passwordConfirmation: "different-password" }).success).toBe(false);
    const normalizedRegistration = CredentialRegistrationSchema.safeParse({ username: "Host_Player", password: "a-long-password", passwordConfirmation: "a-long-password" });
    expect(normalizedRegistration.success).toBe(true);
    if (normalizedRegistration.success) expect(normalizedRegistration.data.username).toBe("host_player");
    expect(EmailAttachmentSchema.safeParse({ email: "host@example.test" }).success).toBe(true);
    expect(EmailAttachmentSchema.safeParse({ email: "not-an-address" }).success).toBe(false);
    expect(LiveGameEventSchema.safeParse({ id: "13:collecting:2", kind: "submission_count", announcement: "2 of 5 players submitted." }).success).toBe(true);
  });

  it("bounds invitation tokens before database lookup", () => {
    expect(InviteAcceptanceSchema.safeParse({ token: "a-secure-token-value" }).success).toBe(true);
    expect(InviteAcceptanceSchema.safeParse({ token: "short" }).success).toBe(false);
  });

  it("accepts only bundled avatars and normalized profile usernames", () => {
    const valid = ProfileUpdateSchema.safeParse({ displayName: "Zemodeler", username: "ZEMODELER", avatarKey: "owl" });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.username).toBe("zemodeler");
    expect(ProfileUpdateSchema.safeParse({ displayName: "A", username: "bad name", avatarKey: "https://example.test/a.png" }).success).toBe(false);
  });
});
