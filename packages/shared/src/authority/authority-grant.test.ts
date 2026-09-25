import { describe, expect, it } from "vitest";
import type { Office } from "../characters/character";
import type { Force, ForcePersonnelCategory, OfficeSeat } from "../material-state";
import {
  AuthorityGrantSchema,
  buildAuthorityIndex,
  checkAuthority,
  deriveCommandGrants,
  deriveOfficeGrants,
  type AuthorityGrant,
} from "./authority-grant";

const kingOffice: Office = {
  id: "office-king",
  label: "King",
  polityId: "nation",
  authorisedActionIds: ["force_modify"], // a military delta op -- command power over the office's polity
  sponsorableCategories: [],
  treasuryAccountId: "national-treasury",
  treasuryPermissions: ["spend_without_vote"],
  incomeSourceId: null,
  expectedBlocId: null,
  successionRuleId: "rule-hereditary",
  eligibilityRequirementIds: [],
};

const governorOffice: Office = {
  id: "office-governor",
  label: "Governor",
  polityId: "nation",
  authorisedActionIds: ["force_modify"], // military command power, but no treasury at all
  sponsorableCategories: [],
  treasuryAccountId: null,
  treasuryPermissions: [],
  incomeSourceId: null,
  expectedBlocId: null,
  successionRuleId: "rule-appointment",
  eligibilityRequirementIds: [],
};

function seat(overrides: Partial<OfficeSeat> = {}): OfficeSeat {
  return {
    id: "seat-1",
    officeId: "office-king",
    seatIndex: 0,
    holderCharacterId: "char-king",
    status: "held",
    vacancyCause: "none",
    termStartedAtStep: 0,
    termExpiresAtStep: null,
    appointmentProcedureId: null,
    removalProcedureId: null,
    eligibilityRequirementIds: [],
    ...overrides,
  };
}

const personnel: ForcePersonnelCategory[] = [{ categoryId: "infantry", label: "Infantry", fit: 1000, unavailable: [] }];

function force(overrides: Partial<Force> = {}): Force {
  return {
    id: "force-1",
    name: "First Legion",
    polityId: "nation",
    commanderCharacterId: "char-commander",
    controllerCharacterId: "char-commander",
    locationId: "province-1",
    positionId: null,
    authorizedStrength: 1000,
    personnel,
    moraleBps: 8_000,
    cohesionBps: 8_000,
    fatigueBps: 0,
    provisionStatus: "provisioned" as const,
    provisionedThroughStep: 10,
    payObligationId: null,
    payArrearsPeriods: 0,
    history: [],
    memberCharacterIds: [],
    ...overrides,
  };
}

describe("deriveOfficeGrants (docs/32, Phase 7)", () => {
  it("grants fiscal spend power scoped to the office's own treasury account, not the whole polity", () => {
    const grants = deriveOfficeGrants([seat()], [kingOffice], 1);
    const fiscal = grants.find((g) => g.domain === "fiscal");
    expect(fiscal).toBeDefined();
    expect(fiscal?.scope).toEqual({ kind: "account", id: "national-treasury" });
    expect(fiscal?.powers).toContain("spend");
  });

  it("grants no fiscal authority for an office with no treasury account -- the governor case", () => {
    const grants = deriveOfficeGrants([seat({ id: "seat-2", officeId: "office-governor", holderCharacterId: "char-governor" })], [governorOffice], 1);
    expect(grants.some((g) => g.domain === "fiscal")).toBe(false);
  });

  it("grants a military authorised action as command power, scoped to the office's polity", () => {
    const grants = deriveOfficeGrants([seat()], [kingOffice], 1);
    const military = grants.find((g) => g.domain === "military");
    expect(military?.scope).toEqual({ kind: "polity", id: "nation" });
    expect(military?.powers).toContain("command");
  });

  it("derives nothing for a vacant seat", () => {
    expect(deriveOfficeGrants([seat({ status: "vacant", holderCharacterId: null, vacancyCause: "death" })], [kingOffice], 1)).toEqual([]);
  });
});

describe("deriveCommandGrants", () => {
  it("grants command power over the force to its commander", () => {
    const grants = deriveCommandGrants([force()], 1);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ holder: { kind: "character", id: "char-commander" }, domain: "military", scope: { kind: "force", id: "force-1" }, powers: ["command"] });
  });
});

describe("checkAuthority: king vs governor over the national treasury (docs/32 test plan)", () => {
  it("authorizes the king to spend the national treasury", () => {
    const index = buildAuthorityIndex({ officeSeats: [seat()], forces: [] }, [], [kingOffice], 1);
    const result = checkAuthority(index, {
      holder: { kind: "character", id: "char-king" },
      domain: "fiscal",
      scope: { kind: "account", id: "national-treasury" },
      power: "spend",
    });
    expect(result.authorized).toBe(true);
    expect(result.standing).toBe("lawful");
  });

  it("refuses a governor spending the national treasury without fiscal authority", () => {
    const index = buildAuthorityIndex(
      { officeSeats: [seat({ id: "seat-2", officeId: "office-governor", holderCharacterId: "char-governor" })], forces: [] },
      [],
      [governorOffice],
      1,
    );
    const result = checkAuthority(index, {
      holder: { kind: "character", id: "char-governor" },
      domain: "fiscal",
      scope: { kind: "account", id: "national-treasury" },
      power: "spend",
    });
    expect(result.authorized).toBe(false);
    expect(result.grant).toBeNull();
  });

  it("refuses a governor's polity-wide military grant from satisfying a fiscal check", () => {
    const index = buildAuthorityIndex(
      { officeSeats: [seat({ id: "seat-2", officeId: "office-governor", holderCharacterId: "char-governor" })], forces: [] },
      [],
      [governorOffice],
      1,
    );
    const result = checkAuthority(index, {
      holder: { kind: "character", id: "char-governor" },
      domain: "military",
      scope: { kind: "polity", id: "nation" },
      power: "command",
    });
    expect(result.authorized).toBe(true); // the governor DOES hold military command power, just not fiscal
  });
});

describe("checkAuthority: garrison command (docs/32 test plan -- unlawful order groundwork)", () => {
  it("authorizes the force's commander to command it", () => {
    const index = buildAuthorityIndex({ officeSeats: [], forces: [force()] }, [], [], 1);
    const result = checkAuthority(index, { holder: { kind: "character", id: "char-commander" }, domain: "military", scope: { kind: "force", id: "force-1" }, power: "command" });
    expect(result.authorized).toBe(true);
  });

  it("refuses a soldier with no grant from commanding a force they do not command", () => {
    const index = buildAuthorityIndex({ officeSeats: [], forces: [force()] }, [], [], 1);
    const result = checkAuthority(index, { holder: { kind: "character", id: "char-random-soldier" }, domain: "military", scope: { kind: "force", id: "force-1" }, power: "command" });
    expect(result.authorized).toBe(false);
  });
});

describe("checkAuthority: scope-hierarchy walk", () => {
  it("lets a broader scope satisfy a narrower check via an injected containment predicate", () => {
    const index = buildAuthorityIndex({ officeSeats: [seat()], forces: [] }, [], [kingOffice], 1);
    const containsProvinceInPolity = (broader: { kind: string; id: string }, narrower: { kind: string; id: string }) =>
      broader.kind === "polity" && broader.id === "nation" && narrower.kind === "province";
    const result = checkAuthority(
      index,
      { holder: { kind: "character", id: "char-king" }, domain: "military", scope: { kind: "province", id: "some-province" }, power: "command" },
      containsProvinceInPolity,
    );
    expect(result.authorized).toBe(true);
  });

  it("does not let an unrelated scope satisfy a check with the default exact-match predicate", () => {
    const index = buildAuthorityIndex({ officeSeats: [seat()], forces: [] }, [], [kingOffice], 1);
    const result = checkAuthority(index, { holder: { kind: "character", id: "char-king" }, domain: "military", scope: { kind: "province", id: "some-province" }, power: "command" });
    expect(result.authorized).toBe(false);
  });
});

describe("buildAuthorityIndex: persisted grants (delegation/custom/conquest/emergency)", () => {
  const delegatedGrant: AuthorityGrant = AuthorityGrantSchema.parse({
    id: "grant-1",
    holder: { kind: "character", id: "char-delegate" },
    source: "delegation",
    domain: "diplomatic",
    scope: { kind: "polity", id: "nation" },
    powers: ["negotiate"],
    standing: "delegated",
    grantedAtStep: 1,
    expiresAtStep: 10,
  });

  it("includes an active persisted grant", () => {
    const index = buildAuthorityIndex({ officeSeats: [], forces: [] }, [delegatedGrant], [], 5);
    expect(checkAuthority(index, { holder: { kind: "character", id: "char-delegate" }, domain: "diplomatic", scope: { kind: "polity", id: "nation" }, power: "negotiate" }).authorized).toBe(true);
  });

  it("excludes a persisted grant once past its expiry", () => {
    const index = buildAuthorityIndex({ officeSeats: [], forces: [] }, [delegatedGrant], [], 11);
    expect(checkAuthority(index, { holder: { kind: "character", id: "char-delegate" }, domain: "diplomatic", scope: { kind: "polity", id: "nation" }, power: "negotiate" }).authorized).toBe(false);
  });

  it("excludes a revoked persisted grant even before its natural expiry", () => {
    const revoked = { ...delegatedGrant, revokedAtStep: 3 };
    const index = buildAuthorityIndex({ officeSeats: [], forces: [] }, [revoked], [], 5);
    expect(checkAuthority(index, { holder: { kind: "character", id: "char-delegate" }, domain: "diplomatic", scope: { kind: "polity", id: "nation" }, power: "negotiate" }).authorized).toBe(false);
  });
});
