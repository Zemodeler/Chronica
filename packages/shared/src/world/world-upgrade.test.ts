import { describe, expect, it } from "vitest";
import { WORLD_SCHEMA_VERSION } from "./world-state";
import { WORLD_UPGRADES, WorldDocumentUnreadableError, readWorldDocument, upgradeWorldDocument, type WorldUpgradeStep } from "./world-upgrade";
import { firstPunicWarScenario } from "@chronica/db";

const opening = (): Record<string, unknown> => structuredClone(firstPunicWarScenario.initialWorld);

describe("a save opened by a later build", () => {
  it("reads a world written at the current version without changing it", () => {
    const { world, applied } = readWorldDocument(opening());
    expect(applied).toEqual([]);
    expect(world.schemaVersion).toBe(WORLD_SCHEMA_VERSION);
    expect(JSON.stringify(world)).toBe(JSON.stringify(readWorldDocument(opening()).world));
  });

  it("has a chain with no gap from the oldest carried version to the current one", () => {
    // Every step the chain holds starts where the one before it ended, so an
    // old save walks all the way up or is refused by name -- never parsed
    // half-upgraded.
    let at = WORLD_UPGRADES[0]?.from ?? WORLD_SCHEMA_VERSION;
    for (const step of WORLD_UPGRADES) {
      expect(step.from).toBe(at);
      expect(step.to).toBeGreaterThan(step.from);
      at = step.to;
    }
    expect(at).toBe(WORLD_SCHEMA_VERSION);
  });

  // The pattern every future step follows: feed it the document as the old
  // code wrote it, and read the result with the current schema.
  it("carries an old document through a step before the strict parse", () => {
    const renamedLedger: WorldUpgradeStep = {
      from: WORLD_SCHEMA_VERSION - 1,
      to: WORLD_SCHEMA_VERSION,
      describe: "the narrator's ledger was called narratorBook",
      upgrade: (document) => {
        const { narratorBook, ...rest } = document;
        return { ...rest, narrator: narratorBook };
      },
    };
    const ledger = { lastSeedDay: 4, seedCount: 1, lastSeedKey: "a-seed", consumed: false, spentPressureIds: [] };
    const { narrator: _current, ...rest } = opening();
    const written = { ...rest, narratorBook: ledger, schemaVersion: WORLD_SCHEMA_VERSION - 1 };

    expect(() => readWorldDocument(written)).toThrow(/older than the oldest/);
    const { world, applied } = readWorldDocument(written, { steps: [renamedLedger], oldest: WORLD_SCHEMA_VERSION - 1 });
    expect(applied).toEqual([`${WORLD_SCHEMA_VERSION - 1} -> ${WORLD_SCHEMA_VERSION}: the narrator's ledger was called narratorBook`]);
    expect(world.narrator).toEqual(ledger);
    // The step worked on a copy: the stored document is untouched.
    expect(written.narratorBook).toBe(ledger);
    expect("narrator" in written).toBe(false);
  });

  it("walks several steps in order", () => {
    const steps: WorldUpgradeStep[] = [
      { from: 1, to: 2, describe: "a", upgrade: (document) => ({ ...document, trail: ["a"] }) },
      { from: 2, to: 3, describe: "b", upgrade: (document) => ({ ...document, trail: [...(document.trail as string[]), "b"] }) },
    ];
    const { document, applied } = upgradeWorldDocument({ schemaVersion: 1 }, steps, 3, 1);
    expect(document).toEqual({ schemaVersion: 3, trail: ["a", "b"] });
    expect(applied).toHaveLength(2);
    expect(() => upgradeWorldDocument({ schemaVersion: 1 }, steps.slice(1), 3, 1)).toThrow(/No upgrade exists from world schema 1/);
  });

  it("refuses a world from a newer build rather than dropping what it added", () => {
    expect(() => readWorldDocument({ ...opening(), schemaVersion: WORLD_SCHEMA_VERSION + 1 })).toThrow(/newer than this build/);
  });

  it("names the path the schema refused, and never hands back a half-world", () => {
    const broken = opening();
    (broken.instant as { day: unknown }).day = "the ides";
    let caught: unknown;
    try {
      readWorldDocument(broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorldDocumentUnreadableError);
    const unreadable = caught as WorldDocumentUnreadableError;
    expect(unreadable.issues.some((issue) => issue.startsWith("instant.day:"))).toBe(true);
    expect(unreadable.message).toContain("instant.day");
  });

  it("refuses a document with no version at all", () => {
    const { schemaVersion: _dropped, ...unversioned } = opening();
    expect(() => readWorldDocument(unversioned)).toThrow(/carries no schema version/);
    expect(() => readWorldDocument(null)).toThrow(/not a document/);
  });
});
