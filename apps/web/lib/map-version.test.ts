import { afterEach, describe, expect, it, vi } from "vitest";
import { punicWarsScenario } from "@chronica/db";

/**
 * The client keeps the map for a year under its version, so whatever the provinces file
 * holds has to be in it: a rebuilt file with the old version would be shown stale for good.
 */

const world = punicWarsScenario.initialWorld;

async function versionWith(checksum?: string): Promise<string | undefined> {
  vi.resetModules();
  vi.doMock("@chronica/db", async (importOriginal) => {
    const original = await importOriginal<typeof import("@chronica/db")>();
    return { ...original, PUNIC_WARS_MAP_ASSET: { ...original.PUNIC_WARS_MAP_ASSET, checksum: checksum ?? original.PUNIC_WARS_MAP_ASSET.checksum } };
  });
  const maps = await import("./built-in-scenario-maps");
  return maps.mapVersion(maps.PUNIC_WARS_MAP_ASSET_ID, world);
}

describe("the version of the Punic Wars map", { timeout: 120_000 }, () => {
  afterEach(() => {
    vi.doUnmock("@chronica/db");
    vi.resetModules();
  });

  it("follows the file it is drawn from", async () => {
    const plain = await versionWith();
    expect(plain).toBeDefined();
    expect(await versionWith()).toBe(plain);
    expect(await versionWith("a-rebuilt-map")).not.toBe(plain);
  });
});
