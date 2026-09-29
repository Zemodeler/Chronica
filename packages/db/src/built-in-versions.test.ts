import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { firstPunicWarScenario } from "./built-in-scenarios";
import { FIRST_PUNIC_WAR_VERSIONS, PUNIC_WARS_VERSIONS, currentBuiltInVersion } from "./built-in-versions";
import { punicWarsScenario } from "./punic-wars-scenario";

describe("a built-in scenario's versions", () => {
  for (const [name, versions] of [["The Numidian Decision", FIRST_PUNIC_WAR_VERSIONS], ["Punic Wars", PUNIC_WARS_VERSIONS]] as const) {
    it(`${name}: numbered in order, each with a note`, () => {
      for (let index = 1; index < versions.length; index += 1) expect(versions[index]!.version).toBeGreaterThan(versions[index - 1]!.version);
      for (const entry of versions) expect(entry.notes.trim().length).toBeGreaterThan(0);
    });
  }

  it("seed the version their own opening world says it is", () => {
    // A world pinned to one number and written into the row of another is the
    // thing this file exists to stop.
    expect(firstPunicWarScenario.initialWorld.pins.scenarioVersion).toBe(currentBuiltInVersion(FIRST_PUNIC_WAR_VERSIONS).version);
    expect(punicWarsScenario.initialWorld.pins.scenarioVersion).toBe(currentBuiltInVersion(PUNIC_WARS_VERSIONS).version);
  });

  it("write only the current version from code", () => {
    // Every earlier version used to be inserted with today's definition under
    // its old number. Two inserts, one per scenario, is the whole of it now.
    const source = readFileSync(fileURLToPath(new URL("./queries/games.ts", import.meta.url)), "utf8");
    expect(source.match(/insert\(scenarioVersions\)/g)).toHaveLength(2);
    expect(source).toContain("currentBuiltInVersion(FIRST_PUNIC_WAR_VERSIONS)");
    expect(source).toContain("currentBuiltInVersion(PUNIC_WARS_VERSIONS)");
  });
});
