// What the dense Punic Wars map costs, measured: the opening world's size, the passes every burst makes over it,
// the journeys that make its distances real, one tick of the clock, and the map document the client downloads.
//
// Usage: cd apps/web && npx tsx --tsconfig ../../scripts/load-check-tsconfig.json ../../scripts/load-check-map.mts
//   (from apps/web, where the map files are served from; the tsconfig stands in for Next's `server-only` marker, as vitest does)
import { performance } from "node:perf_hooks";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ensureProvinceMaterial, kmBetween, landKmBetween, liveProvinceIds, marchDaysFor, sailDaysFor,
  ScenarioDefinitionSchema, WorldStateSchema, type Fact, type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "@chronica/sim";
import { runDeterministicTick } from "../packages/sim/src/tick";
import { PUNIC_WARS_MAP_ASSET_ID, mapWireDocument } from "../apps/web/lib/built-in-scenario-maps";
import { projectWorldView } from "../apps/web/lib/world-view";

const megabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(2)} MB`;
const timed = <T,>(label: string, work: () => T): T => {
  const started = performance.now();
  const result = work();
  console.log(`${label.padEnd(44)} ${(performance.now() - started).toFixed(1).padStart(9)} ms`);
  return result;
};

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const initial = punicWarsScenario.initialWorld;
const provinces = initial.map.provinces;

console.log(`provinces ${provinces.length}, edges ${initial.map.edges.length}, polities ${initial.map.polities.length}, characters ${initial.characters.length}`);
console.log(`${"world JSON".padEnd(44)} ${megabytes(Buffer.byteLength(JSON.stringify(initial))).padStart(12)}`);

const plain = JSON.parse(JSON.stringify(initial)) as unknown;
const parsed = timed("WorldStateSchema.safeParse", () => {
  const result = WorldStateSchema.safeParse(plain);
  if (!result.success) throw new Error(result.error.message);
  return result.data;
});
const material: WorldState = timed("ensureProvinceMaterial", () => ensureProvinceMaterial(parsed, 0));
timed("liveProvinceIds", () => liveProvinceIds(material));
console.log(`${"live provinces".padEnd(44)} ${String(liveProvinceIds(material).size).padStart(12)}`);

const facts: Fact[] = [];
timed("projectWorldView", () => projectWorldView(material, { gameId: "load-check", gameTitle: "Load check", clock: definition.clock, offices: definition.government.offices, facts, warfare: definition.warfare }, "gaius-genucius"));

const journey = (label: string, from: string, to: string): void => {
  const km = kmBetween(material, from, to);
  const onFoot = landKmBetween(material, from, to);
  const days = km === null ? "no route" : `march ${marchDaysFor(km).toFixed(1)} d / sail ${sailDaysFor(km)} d`;
  console.log(`${label.padEnd(44)} ${String(km).padStart(9)} km  (on foot ${onFoot === null ? "never" : `${onFoot} km`})  ${days}`);
};
timed("kmBetween Rome -> Messana", () => kmBetween(material, PUNIC_IDS.rome, PUNIC_IDS.messana));
journey("Rome -> Messana", PUNIC_IDS.rome, PUNIC_IDS.messana);
journey("Carthage -> Rome (by sea)", PUNIC_IDS.carthage, PUNIC_IDS.rome);
journey("Carthage -> Lilybaeum", PUNIC_IDS.carthage, PUNIC_IDS.lilybaeum);
journey("Rome -> Syracuse", PUNIC_IDS.rome, PUNIC_IDS.syracuse);

const tickOnce = () => runDeterministicTick({
  world: material, toDay: 30, ids: createIdFactory("load-check"), warfare: definition.warfare, life: definition.life, clock: definition.clock, government: definition.government,
});
const ticked = timed("runDeterministicTick (30 days, cold)", tickOnce);
timed("runDeterministicTick (30 days, warm)", tickOnce);
console.log(`${"  facts / notes".padEnd(44)} ${String(ticked.factProposals.length).padStart(5)} / ${ticked.notes.length}`);

const wire = timed("map wire document (first build)", () => mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, material)!);
console.log(`${"map wire document".padEnd(44)} ${megabytes(Buffer.byteLength(wire.body)).padStart(12)}`);
timed("map wire document (kept)", () => mapWireDocument(PUNIC_WARS_MAP_ASSET_ID, material));
