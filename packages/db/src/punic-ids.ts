import { PUNIC_EXTRA_IDS } from "./punic-extra-ids";
import { PUNIC_ANCHORS } from "./punic-wars-map-graph";

/**
 * Named handles on the provinces the Punic Wars scenario, its tests and its
 * scripts refer to. Nothing outside this file spells a province id, so a new
 * map is one edit here (each value is the province holding the named place).
 * The ids are the map builder's own anchors, so they follow every regeneration.
 */
const anchor = (place: string): string => {
  const id = PUNIC_ANCHORS[place];
  if (id === undefined) throw new Error(`The map has no anchor for ${place}`);
  return id;
};

export const PUNIC_IDS = {
  // The places the story is about.
  rome: anchor("rome"),
  capua: anchor("capua"),
  volsinii: anchor("volsinii"),
  iguvium: anchor("iguvium"),
  asculum: anchor("asculum"),
  corfinium: anchor("corfinium"),
  bovianum: anchor("bovianum"),
  tarentum: anchor("tarentum"),
  grumentum: anchor("grumentum"),
  rhegium: anchor("rhegium"),
  brundisium: anchor("brundisium"),
  genua: anchor("genua"),
  mediolanum: anchor("mediolanum"),
  felsina: anchor("bononia"),
  patavium: anchor("patavium"),
  carthage: anchor("carthage"),
  lilybaeum: anchor("lilybaeum"),
  panormus: anchor("panormus"),
  agrigentum: anchor("agrigentum"),
  syracuse: anchor("syracuse"),
  messana: anchor("messana"),
  // Where the Hellenistic kings' field armies stand on the first day (v42).
  pella: anchor("pella"),
  apamea: anchor("apamea-orontes"),
  alexandria: anchor("alexandria"),
  // Ground with no settlement to name it, found by coordinates (`scripts/map-gen/resolve-extra-anchors.ts`).
  ...PUNIC_EXTRA_IDS,
} as const;

export type PunicPlace = keyof typeof PUNIC_IDS;
