import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { GeoJsonMapSchema, type GeoJsonMap } from "@chronica/shared";

export const PRIVATE_DEMO_SCENARIO_ID = "private-demo-world";
export const PRIVATE_ITALIAN_WAR_DEMO_SCENARIO_ID = "private-italian-war-1494";

const privateDemoScenarioPaths: Readonly<Record<string, readonly string[]>> = {
  [PRIVATE_DEMO_SCENARIO_ID]: ["punic-wars-264bce.geojson"],
  [PRIVATE_ITALIAN_WAR_DEMO_SCENARIO_ID]: ["italian-war-1494", "scenario.geojson"],
};

export function privateHostingEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.CHRONICA_ENABLE_PRIVATE_HOSTING === "1";
}

// The DEMO map is committed to the repo and validated at build time, so it is
// loaded directly rather than converted from an external NUTS fixture.
const cachedPrivateMaps = new Map<string, GeoJsonMap>();
const loadingPrivateMaps = new Map<string, Promise<GeoJsonMap>>();

/** Loads a committed local demo map from the isolated DEMO directory. */
export async function loadPrivateScenarioMap(scenarioId: string): Promise<GeoJsonMap> {
  const mapPath = privateDemoScenarioPaths[scenarioId];
  if (mapPath === undefined) throw new Error(`Unknown local demo scenario: ${scenarioId}`);
  const cached = cachedPrivateMaps.get(scenarioId);
  if (cached !== undefined) return cached;
  const loading = loadingPrivateMaps.get(scenarioId);
  if (loading !== undefined) return loading;

  // Next may run with either the repository root or apps/web as its cwd. The
  // committed fixture lives at the repository root, so try both workspace
  // layouts and only fall through when the candidate itself is absent.
  const rootSourcePath = path.resolve(process.cwd(), "DEMO", ...mapPath);
  const workspaceSourcePath = path.resolve(process.cwd(), "..", "..", "DEMO", ...mapPath);
  const pending = readFile(rootSourcePath, "utf8")
    .catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return readFile(workspaceSourcePath, "utf8");
    })
    .then((contents) => GeoJsonMapSchema.parse(JSON.parse(contents) as unknown))
    .then((map) => {
      cachedPrivateMaps.set(scenarioId, map);
      loadingPrivateMaps.delete(scenarioId);
      return map;
    }, (error: unknown) => {
      loadingPrivateMaps.delete(scenarioId);
      throw error;
    });
  loadingPrivateMaps.set(scenarioId, pending);
  return pending;
}

/** Backward-compatible convenience loader for the original Punic Wars fixture. */
export function loadPrivateDemoMap(): Promise<GeoJsonMap> {
  return loadPrivateScenarioMap(PRIVATE_DEMO_SCENARIO_ID);
}
