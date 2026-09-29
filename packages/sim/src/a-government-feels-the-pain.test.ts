import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, type WorldState } from "@chronica/shared";
import { ensureConstitutions } from "./constitutions";
import { grumbleAtOfficers } from "./grumbling";
import { aimsFromState } from "./outlooks";
import { createIdFactory } from "./ports";
import { reviewSociety } from "./society";

/**
 * A government that has been struck at, or whose people are hungry, comes to
 * want somebody put over the watch or the grain; an officer who runs his work
 * badly is a mark for everybody who dislikes him; and a power's aims follow
 * its condition -- an empty chest is what it worries about.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government, toDay: 0 });
const monthLater = (world: WorldState, day = 60): WorldState =>
  reviewSociety({ world: { ...world, elapsedStep: day, instant: { ...world.instant, day }, society: { ...world.society, lastReviewStep: day - 40 } }, government, warfare: definition.warfare, toDay: day, ids: createIdFactory("society") }).world;
const ruler = (world: WorldState) => readDepartments(world).rulers("carthage")[0]!;

describe("a government that feels the pain", () => {
  it("wants a watch once a plot against its own men is found out", () => {
    const world = opening();
    const mark = world.characters.find((character) => character.alive && character.polityId === "carthage" && character.id !== ruler(world).id)!;
    const struck: WorldState = {
      ...world,
      covertPlots: [{
        id: "plot-1", kind: "assassination", targetCharacterId: mark.id, sponsorCharacterId: "hieron-ii", agentCharacterId: null, spend: 0, cover: "A fever.",
        successOddsBps: 3_000, secrecyBps: 5_000, openedAtStep: 0, resolvesAtStep: 50, storylineId: null, outcome: "discovered", resolvedAtStep: 50,
      } as WorldState["covertPlots"][number]],
    };
    const after = monthLater(struck);
    expect(ruler(after).ambitions.map((ambition) => ambition.id)).toContain("watch-carthage");
    expect(ruler(monthLater(world)).ambitions.map((ambition) => ambition.id)).not.toContain("watch-carthage");
  });

  it("wants somebody over the grain when its people are hungry and restless", () => {
    const world = opening();
    const home = world.map.provinces.find((province) => province.controllerPolityId === "carthage")!;
    const hungry: WorldState = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((entry) => (entry.provinceId === home.id ? { ...entry, foodSecurityBps: 2_000, stabilityBps: 3_000 } : entry)) },
    };
    expect(ruler(monthLater(hungry)).ambitions.map((ambition) => ambition.id)).toContain("grain-carthage");
  });

  it("makes an officer caught with his hand in the chest a mark for those who dislike him", () => {
    const opened = opening();
    // The accounts' college names nobody; a man is put in it.
    const accounts = opened.departments.find((department) => department.id === "carthage-accounts")!;
    const clerk = opened.characters.find((character) => character.alive && character.polityId === "carthage" && character.id !== ruler(opened).id)!;
    const world: WorldState = {
      ...opened,
      material: { ...opened.material, officeSeats: [...opened.material.officeSeats, {
        id: "accounts-seat", officeId: accounts.headOfficeId ?? accounts.officeIds[0]!, seatIndex: 0, holderCharacterId: clerk.id, status: "held", vacancyCause: "none",
        termStartedAtStep: 0, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [],
      }] },
    };
    const officer = readDepartments(world).holding({ kind: "polity", id: "carthage" }, "tax_roll").people[0];
    expect(officer?.id).toBe(clerk.id);
    const enemy = world.characters.find((character) => character.alive && character.polityId === "carthage" && character.id !== officer!.id
      && world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held"))!;
    const caught: WorldState = {
      ...world,
      diversions: [{ id: "d", byCharacterId: officer!.id, scope: { kind: "polity", id: "carthage" }, departmentId: "carthage-accounts", amount: 500, toAccountId: officer!.personalAccountId, firstAtStep: 0, lastAtStep: 0, foundAtStep: 20 }],
      characters: world.characters.map((character) => (character.id === enemy.id
        ? { ...character, relations: [...character.relations, { subjectCharacterId: officer!.id, causes: [{ id: "g", label: "An old quarrel.", score: -40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
        : character)),
    };
    const grumbled = grumbleAtOfficers(caught, 30);
    const want = grumbled.characters.find((character) => character.id === enemy.id)!.ambitions.find((ambition) => ambition.targetId === officer!.id);
    expect(want?.label).toContain("his hand was found in the chest");
    // Asked again, the same want, not a second one.
    expect(grumbleAtOfficers(grumbled, 31).characters.find((character) => character.id === enemy.id)!.ambitions.filter((ambition) => ambition.targetId === officer!.id)).toHaveLength(1);
  });

  it("worries about an empty chest, and means to put its finances in order", () => {
    const world = opening();
    const broke: WorldState = {
      ...world,
      material: { ...world.material, accounts: world.material.accounts.map((account) => (account.owner.kind === "polity" && account.owner.id === "carthage" ? { ...account, balance: -500 } : account)) },
    };
    const carthage = aimsFromState(broke, 60).find((outlook) => outlook.polityId === "carthage")!;
    expect(carthage.primaryObjective).toBe("Put its finances in order");
    expect(carthage.concerns.map((concern) => concern.label)).toContain("the empty treasury");
    // Paid off, the worry goes and the model's own aims are left as written.
    const paid = aimsFromState({ ...broke, polityOutlooks: aimsFromState(broke, 60) }, 90).find((outlook) => outlook.polityId === "carthage")!;
    expect(paid.concerns.map((concern) => concern.label)).toContain("the empty treasury");
    const solvent = aimsFromState({ ...world, polityOutlooks: aimsFromState(broke, 60) }, 90).find((outlook) => outlook.polityId === "carthage")!;
    expect(solvent.concerns.map((concern) => concern.label)).not.toContain("the empty treasury");
  });

  it("gives aims to a power that had none only once it has something to want", () => {
    const world = opening();
    const quiet = world.map.polities.find((polity) => !world.polityOutlooks.some((outlook) => outlook.polityId === polity.id)
      && world.map.provinces.some((province) => province.controllerPolityId === polity.id)
      && aimsFromState(world, 30).every((outlook) => outlook.polityId !== polity.id))!;
    const other = world.map.polities.find((polity) => polity.id !== quiet.id)!;
    const atWar: WorldState = {
      ...world,
      polityAgreements: [...world.polityAgreements, {
        id: "war-quiet", kind: "war", polityId: other.id, otherPolityId: quiet.id, terms: "War.", sinceStep: 20, untilStep: null,
        sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public",
      }],
    };
    const aims = aimsFromState(atWar, 30).find((outlook) => outlook.polityId === quiet.id);
    expect(aims?.primaryObjective).toMatch(/^(Keep what it has|Hold what it has, and grow where it can)$/);
  });
});
