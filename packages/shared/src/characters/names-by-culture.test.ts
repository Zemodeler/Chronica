import { describe, expect, it } from "vitest";
import { aNameFor, cultureOf, POOLS } from "./names-by-culture";

describe("the culture a power's people belong to", () => {
  it("reads Asia Minor's powers as what they were", () => {
    for (const greek of ["seleucid-empire", "ptolemaic-egypt", "pergamon", "bithynia", "heraclea-pontica", "euxine-greek-cities", "hellespont-propontic-cities"]) expect(cultureOf(greek)).toBe("greek");
    for (const native of ["cappadocia", "pontus", "paphlagonia", "colchis", "pisidia-isauria"]) expect(cultureOf(native)).toBe("anatolian");
    for (const caucasian of ["caucasian-iberia", "caucasian-albania"]) expect(cultureOf(caucasian)).toBe("anatolian");
    for (const iranian of ["armenia", "atropatene", "caspian-peoples", "makran-tribes", "zagros-tribes"]) expect(cultureOf(iranian)).toBe("iranian");
    for (const galatian of ["galatians-tolistobogii", "galatians-tectosages", "galatians-trocmi"]) expect(cultureOf(galatian)).toBe("celtic");
  });

  it("names a Cappadocian from the Anatolian stock", () => {
    expect(POOLS.anatolian.first).toContain(aNameFor("cappadocia", "ruler", new Set()));
  });

  it("gives the Arabian, Judaean, Mesopotamian and Nubian peoples pools of their own", () => {
    for (const arab of ["hejaz-tribes", "najd-tribes", "qedar", "scenitae-arabs", "nabataeans", "lihyan", "gerrha", "ituraeans"]) expect(cultureOf(arab)).toBe("arabian");
    for (const south of ["minaeans", "saba"]) expect(cultureOf(south)).toBe("sabaean");
    expect(cultureOf("judea")).toBe("judaean");
    expect(cultureOf("marsh-peoples")).toBe("mesopotamian");
    expect(cultureOf("kush")).toBe("nubian");
  });

  it("draws each people's names from its own set, the same way every time, in Latin letters", () => {
    const cases: [string, keyof typeof POOLS][] = [
      ["nabataeans", "arabian"], ["qedar", "arabian"], ["saba", "sabaean"], ["judea", "judaean"], ["marsh-peoples", "mesopotamian"],
      ["kush", "nubian"], ["armenia", "iranian"], ["atropatene", "iranian"], ["zagros-tribes", "iranian"],
    ];
    for (const [polity, culture] of cases) {
      const name = aNameFor(polity, "ruler", new Set());
      expect(POOLS[culture].first, polity).toContain(name);
      expect(aNameFor(polity, "ruler", new Set())).toBe(name);
      expect(name).toMatch(/^[A-Za-z-]+$/);
    }
    expect(aNameFor("judea", "ruler", new Set(["x"]))).not.toBe("");
  });

  it("keeps every pool free of repeats and foreign-script glyphs", () => {
    for (const [culture, pool] of Object.entries(POOLS)) {
      for (const list of [pool.first, pool.second ?? []]) {
        expect(new Set(list).size, culture).toBe(list.length);
        for (const name of list) expect(name, `${culture}: ${name}`).toMatch(/^[A-Za-z' -]+$/);
      }
    }
  });
});
