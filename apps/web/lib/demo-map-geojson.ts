import type { GeoJsonMap } from "@chronica/shared";

/**
 * Minimal GeoJSON for the 4-province Sicilian Crisis demo scenario.
 * Simplified polygons around historical locations — enough to render
 * a recognizable map without requiring external DEMO/ assets.
 */
export const demoSicilyGeoJson: GeoJsonMap = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "drepanum",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [12.4, 38.2],
          [12.9, 38.2],
          [13.0, 38.0],
          [13.0, 37.7],
          [12.5, 37.7],
          [12.2, 37.9],
          [12.4, 38.2],
        ]],
      },
      properties: {
        kind: "province",
        name: "Drepanum",
        terrain: "Coastal plain",
      },
    },
    {
      type: "Feature",
      id: "palermo",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [12.9, 38.2],
          [13.5, 38.3],
          [14.0, 38.2],
          [14.0, 37.8],
          [13.0, 37.7],
          [13.0, 38.0],
          [12.9, 38.2],
        ]],
      },
      properties: {
        kind: "province",
        name: "Palermo",
        terrain: "Hills and harbour",
      },
    },
    {
      type: "Feature",
      id: "agrigentum",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [12.5, 37.7],
          [13.0, 37.7],
          [14.0, 37.8],
          [14.5, 37.5],
          [14.2, 37.0],
          [13.5, 36.8],
          [12.8, 37.0],
          [12.2, 37.3],
          [12.2, 37.6],
          [12.5, 37.7],
        ]],
      },
      properties: {
        kind: "province",
        name: "Agrigentum",
        terrain: "Dry uplands",
      },
    },
    {
      type: "Feature",
      id: "messina",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [14.0, 38.2],
          [15.0, 38.3],
          [15.7, 38.2],
          [15.7, 37.9],
          [15.2, 37.5],
          [14.5, 37.5],
          [14.0, 37.8],
          [14.0, 38.2],
        ]],
      },
      properties: {
        kind: "province",
        name: "Messina",
        terrain: "Mountain strait",
      },
    },
    {
      type: "Feature",
      id: "settlement-palermo",
      geometry: {
        type: "Point",
        coordinates: [13.36, 38.12],
      },
      properties: {
        kind: "settlement",
        name: "Palermo",
        provinceId: "palermo",
        type: "city",
      },
    },
    {
      type: "Feature",
      id: "settlement-messina",
      geometry: {
        type: "Point",
        coordinates: [15.55, 38.19],
      },
      properties: {
        kind: "settlement",
        name: "Messina",
        provinceId: "messina",
        type: "city",
      },
    },
    {
      type: "Feature",
      id: "settlement-drepanum",
      geometry: {
        type: "Point",
        coordinates: [12.55, 38.02],
      },
      properties: {
        kind: "settlement",
        name: "Drepanum",
        provinceId: "drepanum",
        type: "port",
      },
    },
    {
      type: "Feature",
      id: "settlement-agrigentum",
      geometry: {
        type: "Point",
        coordinates: [13.59, 37.29],
      },
      properties: {
        kind: "settlement",
        name: "Agrigentum",
        provinceId: "agrigentum",
        type: "town",
      },
    },
  ],
};
