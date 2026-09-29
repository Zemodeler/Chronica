import { describe, expect, it } from "vitest";
import { aNameFor, cultureOf, POOLS } from "./names-by-culture";

describe("the culture a power's people belong to", () => {
  it("reads Asia Minor's powers as what they were", () => {
    for (const greek of ["seleucid-empire", "ptolemaic-egypt", "pergamon", "bithynia", "heraclea-pontica", "euxine-greek-cities", "hellespont-propontic-cities"]) expect(cultureOf(greek)).toBe("greek");
    for (const native of ["cappadocia", "armenia", "pontus", "paphlagonia", "colchis", "pisidia-isauria"]) expect(cultureOf(native)).toBe("anatolian");
    for (const eastern of ["atropatene", "caucasian-iberia", "nabataeans", "judea", "kush", "makran-tribes"]) expect(cultureOf(eastern)).toBe("anatolian");
    for (const galatian of ["galatians-tolistobogii", "galatians-tectosages", "galatians-trocmi"]) expect(cultureOf(galatian)).toBe("celtic");
  });

  it("names a Cappadocian from the Anatolian stock", () => {
    expect(POOLS.anatolian.first).toContain(aNameFor("cappadocia", "ruler", new Set()));
  });
});
