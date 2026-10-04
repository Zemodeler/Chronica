import { PolitySchema, ProvinceSchema, type WorldState } from "@chronica/shared";
import extension from "../../../scripts/map-gen/ireland-extension.json";
import { POLITY_META, PUNIC_WARS_GRAPH_EDGES, PUNIC_WARS_GRAPH_POLITIES, PUNIC_WARS_GRAPH_PROVINCES, PUNIC_WARS_GRAPH_SETTLEMENTS } from "./punic-wars-map-graph";

const provinceIds = new Set(extension.provinceIds);
const polityIds = new Set(PUNIC_WARS_GRAPH_PROVINCES.filter((province) => provinceIds.has(province.id)).map((province) => province.controllerPolityId));
const additions = PUNIC_WARS_GRAPH_PROVINCES.filter((province) => provinceIds.has(province.id)).map((province) => ProvinceSchema.parse({
  ...province, settlements: PUNIC_WARS_GRAPH_SETTLEMENTS.filter((city) => city.provinceId === province.id),
}));
const connections = PUNIC_WARS_GRAPH_EDGES.filter((edge) => provinceIds.has(edge.from) || provinceIds.has(edge.to));
const edgeKey = (edge: { from: string; to: string }) => [edge.from, edge.to].sort().join("|");

/** Add previously undrawn land to a campaign without resetting existing ownership. */
export function carryPunicWarsIreland(world: WorldState): WorldState {
  if (world.pins.scenarioId !== "00000000-0000-4000-8000-000000000102") return world;
  const existingIds = new Set(world.map.provinces.map((province) => province.id));
  const declared = new Set(world.map.polities.map((polity) => polity.id));
  const existingEdges = new Set(world.map.edges.map(edgeKey));
  const provinces = additions.filter((province) => !existingIds.has(province.id));
  const polities = PUNIC_WARS_GRAPH_POLITIES.filter((polity) => polityIds.has(polity.polityId) && !declared.has(polity.polityId)).map((polity) => PolitySchema.parse({
    id: polity.polityId, name: polity.name, capitalSettlementId: polity.capitalSettlementId,
    cohesionBps: POLITY_META[polity.polityId]?.cohesionBps ?? 3500,
    governmentForm: POLITY_META[polity.polityId]?.governmentForm ?? "tribal_confederation",
  }));
  const available = new Set([...existingIds, ...provinces.map((province) => province.id)]);
  const edges = connections.filter((edge) => !existingEdges.has(edgeKey(edge)) && available.has(edge.from) && available.has(edge.to));
  if (provinces.length === 0 && polities.length === 0 && edges.length === 0) return world;
  return { ...world, map: { ...world.map, provinces: [...world.map.provinces, ...structuredClone(provinces)],
    polities: [...world.map.polities, ...polities], edges: [...world.map.edges, ...edges] } };
}
