import type { GeoJsonMapFeature } from "@chronica/shared";

/** First Punic War demo settlement anchor, aligned with the Europe/North-Africa map. */
export const romeDemoSettlement: GeoJsonMapFeature = {
  type: "Feature",
  id: "settlement-rome",
  geometry: { type: "Point", coordinates: [12.4964, 41.9028] },
  properties: {
    kind: "settlement",
    name: "Rome",
    provinceId: "ita-72843720b863019116732",
    type: "capital",
  },
};

export const naplesDemoSettlement: GeoJsonMapFeature = {
  type: "Feature",
  id: "settlement-naples",
  geometry: { type: "Point", coordinates: [14.2681, 40.8518] },
  properties: {
    kind: "settlement",
    name: "Naples",
    provinceId: "ita-72843720b88210905209841",
    type: "city",
  },
};

export const syracuseDemoSettlement: GeoJsonMapFeature = {
  type: "Feature",
  id: "settlement-syracuse",
  geometry: { type: "Point", coordinates: [15.287, 37.075] },
  properties: {
    kind: "settlement",
    name: "Syracuse",
    provinceId: "ita-72843720b81376294924159-sicily-east",
    type: "city",
  },
};

export const agrigentumFortDemoSettlement: GeoJsonMapFeature = {
  type: "Feature",
  id: "settlement-agrigentum-fort",
  geometry: { type: "Point", coordinates: [13.5765, 37.311] },
  properties: {
    kind: "settlement",
    name: "Fort Agrigentum",
    provinceId: "ita-72843720b81376294924159-sicily-west",
    type: "fort",
  },
};
