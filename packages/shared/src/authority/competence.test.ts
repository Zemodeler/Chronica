import { describe, expect, it } from "vitest";
import { ALL_CHAMBER_POWERS, chamberHolds } from "../political-parts";
import { ACT_KINDS, ACT_WINDOW_DAYS } from "./charge-vocabulary";
import { MAX_ACT_MARKS, actMarkOf, actWindowOpen, withActMark, type ActMark } from "../world/act-marks";
import { gradeAt, type ActCompetence } from "./competence";
import { MODERN_WORDS, modernWordsIn } from "./period-words";

const mark = (overrides: Partial<ActMark> = {}): ActMark => ({
  polityId: "rome", act: "tax_rate", officeId: null, byCharacterId: "a", byOfficeId: "roman-consul", atStep: 100, sinceStep: 100, total: 0, ...overrides,
});

describe("who may do what: the parts", () => {
  it("holds the four newer powers by the old bundle for a chamber written before them", () => {
    // A Senate that held taxes and war held the mint, the purse, the treaties and the levy with them.
    const old = ["laws", "war", "taxes", "constitution"] as const;
    expect(chamberHolds([...old], "coinage")).toBe(true);
    expect(chamberHolds([...old], "finance")).toBe(true);
    expect(chamberHolds([...old], "treaties")).toBe(true);
    expect(chamberHolds([...old], "levy")).toBe(true);
    expect(chamberHolds(["laws", "elections", "judgment"], "coinage")).toBe(false);
    // Naming any of the newer four takes a chamber out of the old bundle: it holds what it names.
    expect(chamberHolds(["laws", "taxes", "finance"], "coinage")).toBe(false);
    expect(chamberHolds(["laws", "taxes", "finance"], "finance")).toBe(true);
    // A chamber with no list holds everything; the full list does too.
    expect(chamberHolds(undefined, "coinage")).toBe(true);
    for (const power of ALL_CHAMBER_POWERS) expect(chamberHolds(ALL_CHAMBER_POWERS, power)).toBe(true);
  });

  it("remembers one decider an act, and lets a season run out", () => {
    expect(ACT_KINDS).toHaveLength(12);
    const first = mark();
    expect(actWindowOpen(first, 100 + ACT_WINDOW_DAYS.tax_rate - 1)).toBe(true);
    expect(actWindowOpen(first, 100 + ACT_WINDOW_DAYS.tax_rate)).toBe(false);
    // An act decided anew replaces the one before it, and a power's spending is kept apart for each office.
    const marks = withActMark(withActMark([], first), mark({ byCharacterId: "b", atStep: 150 }));
    expect(marks).toHaveLength(1);
    expect(actMarkOf(marks, "rome", "tax_rate")?.byCharacterId).toBe("b");
    const spent = withActMark(withActMark([], mark({ act: "spending", officeId: "x", total: 5 })), mark({ act: "spending", officeId: "y", total: 7 }));
    expect(spent).toHaveLength(2);
    expect(actMarkOf(spent, "rome", "spending", "y")?.total).toBe(7);
    // However long the world runs, the rows stay few.
    let many: ActMark[] = [];
    for (let at = 0; at < MAX_ACT_MARKS + 50; at += 1) many = withActMark(many, mark({ polityId: `power-${at}`, atStep: at }));
    expect(many.length).toBeLessThanOrEqual(MAX_ACT_MARKS);
  });

  it("reads a figure past an office's own as what lies beyond it", () => {
    const line: ActCompetence = { act: "tax_rate", grade: "with_colleague", within: 1_200, beyond: "by_the_body", body: { id: "senate", name: "Senate" }, why: "", whyBeyond: "" };
    expect(gradeAt(line, 1_200)).toBe("with_colleague");
    expect(gradeAt(line, 1_201)).toBe("by_the_body");
    expect(gradeAt(line)).toBe("with_colleague");
    expect(gradeAt({ ...line, within: null }, 9_999)).toBe("with_colleague");
  });

  it("keeps a list of the words a modern office is made of, for every later phase to scan its strings against", () => {
    expect(MODERN_WORDS.length).toBeGreaterThan(10);
    for (const word of ["minister", "cabinet", "portfolio", "mandate", "KPI", "dashboard", "report", "advice", "recommendation", "department store"]) {
      expect(modernWordsIn(`the ${word} of the state`), word).not.toEqual([]);
    }
    expect(modernWordsIn("The quaestor rendered his accounts to the Senate, and the censor read the rolls.")).toEqual([]);
  });
});
