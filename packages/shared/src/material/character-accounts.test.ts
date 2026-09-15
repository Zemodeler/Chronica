import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { findWorldReferenceViolations } from "../world/references";
import { characterPurseId, ensureCharacterAccounts, openCharacterAccount } from "./character-accounts";

const world = (): WorldState => structuredClone(firstPunicWarScenario.initialWorld);

describe("openCharacterAccount", () => {
  it("opens an active, private, owner-accessible purse in the scenario currency", () => {
    const opened = openCharacterAccount(world().material, "newcomer");
    expect(opened).not.toBeNull();
    if (opened === null) return;

    const account = opened.material.accounts.find((candidate) => candidate.id === opened.accountId);
    expect(opened.accountId).toBe(characterPurseId("newcomer"));
    expect(account?.balance).toBe(0);
    expect(account?.status).toBe("active");
    expect(account?.visibility).toBe("private");
    expect(account?.currencyId).toBe(world().material.currency.id);
    expect(opened.material.accountAccess.some((access) => access.characterId === "newcomer" && access.accountId === opened.accountId)).toBe(true);
  });

  it("is idempotent: a character who already owns a purse keeps exactly that one", () => {
    const base = world().material;
    const existing = base.accounts.find((account) => account.owner.kind === "character")!;
    const opened = openCharacterAccount(base, existing.owner.id);

    expect(opened?.accountId).toBe(existing.id);
    expect(opened?.material.accounts).toHaveLength(base.accounts.length);
  });

  it("refuses rather than colliding when the derived id belongs to somebody else", () => {
    const base = world().material;
    const squatted = {
      ...base,
      accounts: [...base.accounts, {
        id: characterPurseId("newcomer"),
        owner: { kind: "polity" as const, id: "rome" },
        currencyId: base.currency.id,
        balance: 10,
        status: "active" as const,
        visibility: "private" as const,
      }],
    };

    expect(openCharacterAccount(squatted, "newcomer")).toBeNull();
  });
});

describe("ensureCharacterAccounts", () => {
  it("leaves a healthy snapshot untouched", () => {
    const healthy = world();
    expect(ensureCharacterAccounts(healthy)).toBe(healthy);
  });

  it("opens the purse a legacy character was declared to own", () => {
    // Exactly the shape a game carries if it ran create_world_character before
    // that workflow opened the account it named.
    const base = world();
    const legacy = WorldStateSchema.parse({
      ...base,
      characters: [...base.characters, {
        ...structuredClone(base.characters[0]!),
        id: "char-wd-legacy",
        name: "Legacy Figure",
        heirCharacterId: null,
        personalAccountId: "account-char-wd-legacy",
      }],
    });
    expect(findWorldReferenceViolations(legacy)).toContain("Character char-wd-legacy references a missing account.");

    const healed = ensureCharacterAccounts(legacy);
    const character = healed.characters.find((candidate) => candidate.id === "char-wd-legacy");
    const account = healed.material.accounts.find((candidate) => candidate.id === character?.personalAccountId);

    expect(character?.personalAccountId).toBe("account-char-wd-legacy");
    expect(account?.owner).toEqual({ kind: "character", id: "char-wd-legacy" });
    expect(account?.balance).toBe(0);
    expect(findWorldReferenceViolations(healed)).toEqual([]);
    expect(WorldStateSchema.safeParse(healed).success).toBe(true);
  });

  it("repoints a character at the purse they already own rather than giving them a second", () => {
    // The material schema allows one account per owner, so healing must not
    // mint another for someone who already has one under a different id.
    const base = world();
    const owner = base.characters[0]!;
    const ownedId = base.material.accounts.find((account) => account.owner.kind === "character" && account.owner.id === owner.id)!.id;
    const drifted = WorldStateSchema.parse({
      ...base,
      characters: base.characters.map((character) => character.id === owner.id ? { ...character, personalAccountId: "account-that-never-existed" } : character),
    });

    const healed = ensureCharacterAccounts(drifted);
    expect(healed.characters.find((character) => character.id === owner.id)?.personalAccountId).toBe(ownedId);
    expect(healed.material.accounts.filter((account) => account.owner.kind === "character" && account.owner.id === owner.id)).toHaveLength(1);
    expect(WorldStateSchema.safeParse(healed).success).toBe(true);
  });
});
