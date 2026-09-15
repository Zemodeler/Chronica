import { describe, expect, it } from "vitest";
import {
  GameCreationSchema,
  LiveGameEventSchema,
  CredentialLoginSchema,
  CredentialRegistrationSchema,
  DeveloperGiftCreateSchema,
  EmailAttachmentSchema,
  ProfileUpdateSchema,
} from "./index";

describe("web boundary contracts", () => {
  it("accepts the full 1–32 player range while keeping continuity bounded", () => {
    const valid = GameCreationSchema.safeParse({
      title: "The Sicilian Crisis",
      scenarioId: "sicily-m1",
      continuity: { startingSeatCount: 5, extraPrincipalsPerPlayer: 1 },
      coinCap: "10",
    });
    const invalid = GameCreationSchema.safeParse({
      title: "The Sicilian Crisis",
      scenarioId: "sicily-m1",
      continuity: { startingSeatCount: 5, extraPrincipalsPerPlayer: 4 },
      coinCap: "10",
    });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
    for (const startingSeatCount of [1, 6, 32]) {
      expect(GameCreationSchema.safeParse({
        title: "A shared world",
        scenarioId: "shared-world",
        continuity: { startingSeatCount, extraPrincipalsPerPlayer: 1 },
        coinCap: "10",
      }).success).toBe(true);
    }
    expect(GameCreationSchema.safeParse({
      title: "Too many players",
      scenarioId: "shared-world",
      continuity: { startingSeatCount: 33, extraPrincipalsPerPlayer: 1 },
      coinCap: "10",
    }).success).toBe(false);
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
    expect(LiveGameEventSchema.safeParse({ id: "13:dialogue:2", kind: "dialogue_ready", announcement: "A character wants to speak with you." }).success).toBe(true);
  });

  it("accepts only bundled avatars and normalized profile usernames", () => {
    const valid = ProfileUpdateSchema.safeParse({ displayName: "Zemodeler", username: "ZEMODELER", avatarKey: "owl" });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.username).toBe("zemodeler");
    expect(ProfileUpdateSchema.safeParse({ displayName: "A", username: "bad name", avatarKey: "https://example.test/a.png" }).success).toBe(false);
  });

  it("accepts only single-use gift-code creation inputs", () => {
    expect(DeveloperGiftCreateSchema.safeParse({
      grantCoins: "10",
      codeExpiresAt: "",
      grantedCoinsExpireAt: "",
      auditNote: "Developer grant",
    }).success).toBe(true);
    expect(DeveloperGiftCreateSchema.safeParse({
      grantCoins: "10",
      maxRedemptions: "2",
      codeExpiresAt: "",
      grantedCoinsExpireAt: "",
      auditNote: "Developer grant",
    }).success).toBe(false);
  });
});
