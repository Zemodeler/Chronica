import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { competenceOf, type ActKind } from "@chronica/shared";
import { government, opening } from "./competence-test-kit";

/**
 * The charges match the sources.
 *
 * docs/plans/government.md ends in a data block, "Proposed competence tables for the engine", that says per culture and per act who decides and how sure the research
 * is of it. The scenario's charges (`db/punic-wars-charges.ts`) are written from it. Here the block is read, and a spot-check of Rome and Carthage holds the
 * engine's reading to it line by line: what the block says is the body's, the engine's competence lays before the body; what it says is forbidden to any single
 * magistrate, no magistrate holds alone; what it says is one man's, he holds. Where the research is thin the engine takes the simplification the doc names (the data
 * block's L and M flags), and the doc says so under "Disputed and thin evidence".
 */

const doc = readFileSync(new URL("../../../docs/plans/government.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const block = /```\n(rome:[\s\S]*?)```/u.exec(doc)?.[1] ?? "";

/** The lines of one culture's table, by act. */
function tableOf(culture: string): Map<string, string> {
  const start = block.indexOf(`${culture}:\n`);
  const rows = new Map<string, string>();
  if (start < 0) return rows;
  for (const line of block.slice(start + culture.length + 2).split("\n")) {
    if (/^[a-z_]+:\s*$/.test(line) || line.trim() === "") break;
    const found = /^ {2}([a-z_ /,]+?):\s+(.*)$/.exec(line);
    if (found !== null) rows.set(found[1]!, found[2]!);
  }
  return rows;
}

const world = opening();
const read = (officeId: string, act: ActKind) => competenceOf(world, officeId, government.offices)!.acts[act];
const bodyOf = (officeId: string, act: ActKind) => read(officeId, act).body?.id;

describe("the charges match the sources", () => {
  const rome = tableOf("rome");
  const carthage = tableOf("carthage");

  it("finds the research's data block, and its tables", () => {
    expect(block.length).toBeGreaterThan(2_000);
    expect(rome.size).toBeGreaterThanOrEqual(12);
    expect(carthage.size).toBeGreaterThanOrEqual(12);
  });

  it("Rome: the Senate holds the tribute, and no single magistrate lays a rate past custom or a new tax", () => {
    expect(rome.get("tax_rate")).toMatch(/by_the_body: senate.*forbidden: any single magistrate/);
    for (const office of ["roman-consul", "roman-quaestor"]) {
      expect(bodyOf(office, "tax_rate")).toBe("roman-senate");
      expect(read(office, "tax_rate").beyond).toBe("by_the_body");
      expect(read(office, "tax_rate").within).toBe(1_200);
    }
    for (const office of ["roman-praetor", "roman-aedile", "roman-censor", "roman-tribune"]) expect(read(office, "tax_rate").grade, office).toBe("forbidden");
  });

  it("Rome: customs are the censors' (they let the dues), the Senate's beyond them", () => {
    expect(rome.get("customs")).toMatch(/alone: censor.*by_the_body: senate/);
    expect(read("roman-censor", "customs")).toMatchObject({ grade: "with_colleague", beyond: "by_the_body" });
    expect(bodyOf("roman-censor", "customs")).toBe("roman-senate");
    expect(read("roman-consul", "customs").grade).toBe("by_the_body");
  });

  it("Rome: coin and loans are the Senate's, and no single magistrate borrows", () => {
    expect(rome.get("coinage")).toMatch(/by_the_body: senate/);
    expect(rome.get("loans")).toMatch(/by_the_body: senate.*forbidden: any single magistrate/);
    for (const office of ["roman-consul", "roman-dictator"]) {
      expect(read(office, "coinage").grade, office).toBe("by_the_body");
      expect(read(office, "loans").grade, office).toBe("by_the_body");
      expect(bodyOf(office, "coinage")).toBe("roman-senate");
    }
    expect(read("roman-quaestor", "coinage").grade).toBe("forbidden");
  });

  it("Rome: the aedile keeps the city's bread, the Senate buys abroad", () => {
    expect(rome.get("grain")).toMatch(/alone: aedile.*by_the_body: senate/);
    for (const office of ["roman-aedile", "roman-plebeian-aedile"]) expect(read(office, "grain")).toMatchObject({ grade: "with_colleague", beyond: "by_the_body" });
    expect(read("roman-consul", "grain").grade).toBe("by_the_body");
  });

  it("Rome: the Senate negotiates and the people ratify, and no magistrate makes war, peace or a pact alone", () => {
    for (const act of ["pacts", "peace", "war"]) expect(rome.get(act), act).toMatch(/senate|people/);
    expect(rome.get("war")).toMatch(/alone: forbidden/);
    for (const act of ["pacts", "peace", "war", "embargoes"] as const) expect(read("roman-consul", act).grade, act).toBe("by_the_body");
    expect(bodyOf("roman-consul", "pacts")).toBe("roman-senate");
  });

  it("Rome: the consuls hold the levy, both sharing the legions; the consul draws for the army only, the quaestor keeps the books", () => {
    expect(rome.get("levy")).toMatch(/alone: consul.*with_colleague: both consuls/);
    expect(read("roman-consul", "levy").grade).toBe("with_colleague");
    expect(rome.get("spending")).toMatch(/alone: consul for the army only.*keeper: quaestor/);
    expect(read("roman-consul", "spending")).toMatchObject({ grade: "with_colleague", beyond: "by_the_body" });
    expect(read("roman-quaestor", "spending").grade).toBe("by_the_body");
  });

  it("Rome: the tribune and the augur stop what they may, the dictator holds all but the treasury", () => {
    expect(rome.get("veto")).toMatch(/tribune: any magistrate/);
    expect(competenceOf(world, "roman-tribune", government.offices)!.mayStop.length).toBeGreaterThanOrEqual(6);
    expect(competenceOf(world, "roman-augur", government.offices)!.mayStop).toContain("appointment");
    expect(rome.get("dictator")).toMatch(/everything but the treasury/);
    for (const act of ["tax_rate", "customs", "levy", "war", "appointment"] as const) expect(read("roman-dictator", act).grade, act).toBe("alone");
    for (const act of ["loans", "spending", "coinage"] as const) expect(read("roman-dictator", act).grade, act).toBe("by_the_body");
  });

  it("Carthage: the elders hold the tribute, the coin, the loans and the chest; the accountants keep the books within custom", () => {
    for (const act of ["tax_rate", "coinage", "loans", "spending"]) expect(carthage.get(act), act).toMatch(/by_the_body: elders/);
    for (const act of ["tax_rate", "coinage", "loans", "spending", "war"] as const) expect(bodyOf("carthaginian-suffete", act), act).toBe("carthaginian-council");
    expect(read("carthaginian-suffete", "tax_rate").grade).toBe("by_the_body");
    expect(read("carthaginian-accountant", "tax_rate")).toMatchObject({ grade: "with_colleague", beyond: "by_the_body" });
    expect(read("carthaginian-accountant", "loans").grade).toBe("by_the_body");
    expect(carthage.get("spending")).toMatch(/keeper: officers of the accounts/);
    expect(read("carthaginian-accountant", "spending").grade).toBe("by_the_body");
  });

  it("Carthage: the suffetes are the civil heads, the general raises the hired men and strikes the army's coin, and leaves the peace to the elders", () => {
    expect(world.constitutions.find((record) => record.polityId === "carthage")!.rulerOfficeId).toBe("carthaginian-suffete");
    expect(read("carthaginian-suffete", "war").grade).toBe("by_the_body");
    expect(carthage.get("levy")).toMatch(/alone: general raises them/);
    expect(read("carthaginian-strategos", "levy").grade).toBe("alone");
    expect(carthage.get("coinage")).toMatch(/alone: general for field pay/);
    expect(read("carthaginian-strategos", "coinage")).toMatchObject({ grade: "alone", within: 0, beyond: "by_the_body" });
    expect(carthage.get("peace")).toMatch(/by_the_body: elders/);
    expect(read("carthaginian-strategos", "peace").grade).toBe("by_the_body");
    expect(read("carthaginian-strategos", "war").grade).toBe("forbidden");
  });

  it("Carthage: the Hundred and Four hold a seat in a court and no charge of the purse", () => {
    expect(carthage.get("accountability")).toMatch(/hundred_and_four/);
    for (const act of ["tax_rate", "loans", "spending", "war"] as const) expect(read("carthaginian-judge", act).grade, act).toBe("forbidden");
  });

  it("Syracuse and Egypt: the king alone, his friends advising; a dioiketes within custom and no further", () => {
    const syracuse = tableOf("syracuse");
    const egypt = tableOf("egypt");
    for (const act of ["tax_rate", "coinage", "pacts", "war", "spending"]) expect(syracuse.get(act), act).toMatch(/alone: king/);
    for (const act of ["tax_rate", "coinage", "pacts", "war", "peace", "levy", "spending"] as const) expect(read("syracusan-king", act).grade, act).toBe("alone");
    expect(egypt.get("tax_rate")).toMatch(/alone: king; dioiketes sets the rolls/);
    expect(read("ptolemaic-egypt:ruler", "tax_rate").grade).toBe("alone");
    expect(read("ptolemaic-egypt:dioiketes", "tax_rate")).toMatchObject({ grade: "alone", within: 1_200, beyond: "forbidden" });
    expect(read("ptolemaic-egypt:dioiketes", "pacts").grade).toBe("forbidden");
    expect(read("ptolemaic-egypt:oikonomos", "grain").grade).toBe("alone");
    expect(read("seleucid-empire:dioiketes", "tax_rate").grade).toBe("alone");
  });
});
