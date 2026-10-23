import { describe, expect, it } from "vitest";
import { type WorldState } from "@chronica/shared";
import { accountStyleOf, decideAudits, renderTheAccounts, theKingsJustice } from "./close-of-office";
import { atDay, holderOf, opening, ending, withTheft } from "./accounts-test-kit";
import { applyDecision } from "./fiscal-test-kit";
import { opening as fiscalOpening, input as fiscalInput } from "./fiscal-test-kit";

/**
 * A king has no accounts to render.
 *
 * Nobody asked a Ptolemy, a Hiero or a tribal chief for his accounts at the close of anything. The king's own men go through the books of his officers, by his
 * order, once in the year and when somebody speaks ill of a man: his *dioiketes* where he has one, else the friend who has most of a steward in him. What they find
 * he judges himself: the officer is put out of his charge and pays back what he kept, and the friend who thought ill of him is named as the one who spoke.
 */
describe("a king has no accounts to render", () => {
  const world = opening(365);

  it("asks no accounts of a king's officer, a chief, or a priest-king's man", () => {
    for (const polity of ["ptolemaic-egypt", "syracuse", "macedon", "seleucid-empire", "boii"]) expect(accountStyleOf(world, polity)).toBe("none");
    const oikonomos = holderOf(world, "ptolemaic-egypt:oikonomos");
    const done = renderTheAccounts(ending(withTheft(world, oikonomos.id, "ptolemaic-egypt"), "ptolemaic-egypt:oikonomos", oikonomos));
    expect(done.renderings).toEqual([]);
    expect(done.facts).toEqual([]);
    expect(done.world.diversions.every((row) => row.foundAtStep === null)).toBe(true);
  });

  it("has the king's men go through the books once in the year, by the dioiketes or a friend", () => {
    const base = fiscalOpening(400);
    const found = (() => {
      for (let day = 400; day <= 760; day += 30) {
        const there = atDay(base, day);
        const made = decideAudits({ ...fiscalInput(there, "rome"), warfare: undefined }).filter((d) => d.polityId === "ptolemaic-egypt");
        if (made.length > 0) return { day, made, there };
      }
      return undefined;
    })();
    expect(found).toBeDefined();
    const [decision] = found!.made;
    expect(decision!.why).toMatch(/^audit: /);
    expect(decision!.deltas[0]).toMatchObject({ op: "audit_open" });
    const done = applyDecision(found!.there, decision!);
    expect(done.rejected).toEqual([]);
    expect(done.world.audits.some((audit) => audit.status === "under_way" && audit.scope.id === "ptolemaic-egypt")).toBe(true);
    // Not twice in a season: once it is in the log, the next months have none.
    const logged = { ...done.world, statecraft: { ...done.world.statecraft, log: [...done.world.statecraft.log, { day: found!.day, polityId: "ptolemaic-egypt", actorCharacterId: decision!.actorCharacterId, act: "magistrate" as const, targetPolityId: null, why: decision!.why }] } };
    expect(decideAudits({ ...fiscalInput(atDay(logged, found!.day + 30), "rome"), warfare: undefined }).filter((d) => d.polityId === "ptolemaic-egypt")).toEqual([]);
  });

  it("judges an officer the audit found short, himself: put out and made to pay, the friend who spoke named", () => {
    const officer = holderOf(world, "syracusan-strategos");
    const friend = holderOf(world, "syracusan-friend");
    let stolen: WorldState = withTheft(world, officer.id, "syracuse", 1, 4_000);
    stolen = { ...stolen, diversions: stolen.diversions.map((row) => ({ ...row, foundAtStep: 360 })) };
    stolen = { ...stolen, characters: stolen.characters.map((c) => (c.id === friend.id ? { ...c, relations: [{ subjectCharacterId: officer.id, causes: [{ id: "x", label: "Quarrelled.", score: -60, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] } : c)) };
    const purseBefore = stolen.material.accounts.find((a) => a.id === officer.personalAccountId)!.balance;
    const done = theKingsJustice({ ...ending(stolen, "syracusan-strategos", officer, 365), endedTerms: [] });
    expect(done.world.material.officeSeats.some((seat) => seat.holderCharacterId === officer.id && seat.status === "held")).toBe(false);
    expect(done.world.material.accounts.find((a) => a.id === officer.personalAccountId)!.balance).toBeLessThan(purseBefore);
    expect(done.facts.map((f) => f.kind)).toEqual(["royal_audit"]);
    expect(done.facts[0]!.summary).toContain(friend.name);
    expect(done.world.diversions.filter((row) => row.byCharacterId === officer.id)).toEqual([]);
    // A republic's man is not the king's to judge.
    const roman = holderOf(world, "roman-quaestor");
    const theft = withTheft(world, roman.id, "rome", 1);
    const marked = { ...theft, diversions: theft.diversions.map((row) => ({ ...row, foundAtStep: 360 })) };
    expect(theKingsJustice({ ...ending(marked, "roman-quaestor", roman), endedTerms: [] }).facts).toEqual([]);
  });

  it("is the same on every run", () => {
    const base = fiscalOpening(400);
    const a = decideAudits({ ...fiscalInput(atDay(base, 640), "rome"), warfare: undefined });
    const b = decideAudits({ ...fiscalInput(atDay(structuredClone(base), 640), "rome"), warfare: undefined });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
