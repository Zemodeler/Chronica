import type { GeoJsonMapFeature } from "@chronica/shared";

/** Temporary settlement anchor used to calibrate city-label scale and placement. */
export const romeCalibrationSettlement: GeoJsonMapFeature = {
  type: "Feature",
  id: "settlement-rome",
  geometry: { type: "Point", coordinates: [12.4964, 41.9028] },
  properties: {
    kind: "settlement",
    name: "Rome",
    provinceId: "ita-72843720b863019116732",
    type: "city",
  },
};
