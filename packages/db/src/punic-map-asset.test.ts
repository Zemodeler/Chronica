import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUNIC_WARS_MAP_ASSET } from "./punic-map-asset";

describe("the Punic Wars map asset row", () => {
  it("describes the file that is served, byte for byte", () => {
    const bytes = readFileSync(new URL("../../../apps/web/public/maps/punic-wars-provinces.geojson", import.meta.url));
    const geojson = JSON.parse(bytes.toString("utf8")) as { features: unknown[] };
    expect(PUNIC_WARS_MAP_ASSET.featureCount).toBe(geojson.features.length);
    expect(PUNIC_WARS_MAP_ASSET.byteSize).toBe(bytes.length);
    expect(PUNIC_WARS_MAP_ASSET.checksum).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
