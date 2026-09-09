import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema } from "../../world/world-state";
import { findWorldReferenceViolations } from "../../world/references";
import { executeWorkflow } from "../executor";

// `create_world_character` used to be reachable only through World Director
// chronicle casting. With the Game Master it is an ordinary action tool, so
// its determinism is worth pinning on its own rather than through the
// orchestration that happened to call it.

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("create_world_character", () => {
  it("creates a complete, schema-valid character in one step", () => {
    const outcome = executeWorkflow({
      actionId: "create_world_character",
      actorId: "marcus-atilius",
      parameters: {
        characterId: "char-cast-publius",
        name: "Publius Cornelius",
        polityId: "rome",
        locationProvinceId: "ita-local-23120603B86473916475875",
        officeId: null,
        provenance: {
          reason: "A named opponent gives the Senate debate a human stake.",
          storylineId: null,
          createdByDirector: true,
        },
      },
    }, world(), 1);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const created = outcome.world.characters.find((character) => character.id === "char-cast-publius");
    expect(created?.name).toBe("Publius Cornelius");
    expect(outcome.result.summary).toContain("char-cast-publius");
    expect(created?.alive).toBe(true);
    // A created character is immediately whole: named, located, funded, valid.
    expect(created?.locationProvinceId).toBe("ita-local-23120603B86473916475875");
    expect(WorldStateSchema.safeParse(outcome.world).success).toBe(true);
    expect(findWorldReferenceViolations(outcome.world)).toEqual([]);
  });

  it("biases a new character's martial/learning skills and cites the academy in their provenance when one stands in their province (docs/32 corrective pass, requirement 5)", () => {
    const provinceId = "ita-local-23120603B86473916475875";
    const withAcademy = { ...world(), structures: [{
      id: "academy-1", kind: "academy_building" as const, name: "Collegium of Latium", provinceId, settlementId: null,
      ownerPolityId: "rome", garrisonCapacity: 0, defensiveEffectsBps: 0, supplyRadius: 0, builtAtStep: 0, provenanceProjectId: null,
    }] };

    const withoutAcademyOutcome = executeWorkflow({
      actionId: "create_world_character",
      actorId: "marcus-atilius",
      parameters: {
        characterId: "char-control", name: "Control Recruit", polityId: "rome", locationProvinceId: provinceId, officeId: null,
        provenance: { reason: "A control case with no academy.", storylineId: null, createdByDirector: true },
      },
    }, world(), 1);
    const withAcademyOutcome = executeWorkflow({
      actionId: "create_world_character",
      actorId: "marcus-atilius",
      parameters: {
        characterId: "char-trained", name: "Academy Recruit", polityId: "rome", locationProvinceId: provinceId, officeId: null,
        provenance: { reason: "A veteran officer's protégé.", storylineId: null, createdByDirector: true },
      },
    }, withAcademy, 1);

    expect(withoutAcademyOutcome.ok).toBe(true);
    expect(withAcademyOutcome.ok).toBe(true);
    if (!withoutAcademyOutcome.ok || !withAcademyOutcome.ok) return;

    const control = withoutAcademyOutcome.world.characters.find((c) => c.id === "char-control")!;
    const trained = withAcademyOutcome.world.characters.find((c) => c.id === "char-trained")!;

    expect(trained.skills.martial).toBeGreaterThan(control.skills.martial);
    expect(trained.skills.learning).toBeGreaterThan(control.skills.learning);
    expect(trained.creationReason).toContain("Collegium of Latium");
  });

  it("opens the purse it names, so the reference is not left dangling", () => {
    const outcome = executeWorkflow({
      actionId: "create_world_character",
      actorId: "marcus-atilius",
      parameters: {
        characterId: "char-cast-publius",
        name: "Publius Cornelius",
        polityId: "rome",
        locationProvinceId: "ita-local-23120603B86473916475875",
        officeId: null,
        provenance: { reason: "A named opponent gives the Senate debate a human stake.", storylineId: null, createdByDirector: true },
      },
    }, world(), 1);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const created = outcome.world.characters.find((character) => character.id === "char-cast-publius");
    const account = outcome.world.material.accounts.find((candidate) => candidate.id === created?.personalAccountId);

    expect(account).toBeDefined();
    expect(account?.owner).toEqual({ kind: "character", id: "char-cast-publius" });
    expect(account?.currencyId).toBe(outcome.world.material.currency.id);
    expect(account?.balance).toBe(0);
    expect(account?.status).toBe("active");
    expect(account?.visibility).toBe("private");

    // And they can actually reach it, the way a scenario-authored purse is reachable.
    const access = outcome.world.material.accountAccess.find(
      (candidate) => candidate.characterId === "char-cast-publius" && candidate.accountId === account?.id,
    );
    expect(access?.sourceKind).toBe("ownership");
    expect(access?.permissions).toEqual(expect.arrayContaining(["view", "spend_without_vote"]));
  });

  it("is refused when it names a province that does not exist", () => {
    const outcome = executeWorkflow({
      actionId: "create_world_character",
      actorId: "marcus-atilius",
      parameters: {
        characterId: "char-nowhere",
        name: "Nemo",
        polityId: "rome",
        locationProvinceId: "no-such-province",
        officeId: null,
        provenance: { reason: "Testing a bad reference.", storylineId: null, createdByDirector: true },
      },
    }, world(), 1);

    expect(outcome.ok).toBe(false);
  });
});

describe("an unregistered action id", () => {
  it("has no execution path at all, however plausible it looks", () => {
    const before = world();
    const outcome = executeWorkflow(
      { actionId: "levy_sacred_band", actorId: "marcus-atilius", parameters: { polityId: "rome" } },
      before,
      1,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("not_found");
    expect(JSON.stringify(before)).toBe(JSON.stringify(world()));
  });
});
