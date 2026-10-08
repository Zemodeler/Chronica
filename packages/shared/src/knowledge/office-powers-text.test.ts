import { describe, expect, it } from "vitest";
import type { Office } from "../characters/character";
import { describeOfficePowers } from "./office-powers-text";

/** An office with only the fields the rendering reads (2026-10-08: this file was empty since it was made). */
const office = (over: Partial<Office> = {}): Office =>
  ({
    id: "office-consul",
    label: "Consul",
    polityId: "polity-rome",
    authorisedActionIds: [],
    sponsorableCategories: [],
    treasuryAccountId: null,
    treasuryPermissions: [],
    ...over,
  }) as unknown as Office;

describe("an office's powers, said in plain sentences", () => {
  it("says what a title with no powers is", () => {
    const lines = describeOfficePowers(office());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/no power of its own/);
  });

  it("gives one sentence per sphere, command before foreign affairs", () => {
    const lines = describeOfficePowers(office({ authorisedActionIds: ["diplomatic_message_send", "force_create"] }));
    expect(lines).toEqual([
      "Command: may raise forces.",
      "Foreign affairs: may send letters and embassies in the state's name.",
    ]);
  });

  it("joins several acts of one sphere with commas and an 'and'", () => {
    const [line] = describeOfficePowers(office({ authorisedActionIds: ["force_create", "force_reinforce", "force_engage"] }));
    expect(line).toBe("Command: may raise forces, reinforce forces and give battle.");
  });

  it("puts the money acts on the treasury line when there is a treasury to name", () => {
    const spends = describeOfficePowers(office({ authorisedActionIds: ["money_transfer"], treasuryAccountId: "acct-rome", treasuryPermissions: ["spend_without_vote"] as never }));
    expect(spends).toEqual(["Treasury: may spend from the treasury without a vote."]);
    const proposes = describeOfficePowers(office({ treasuryAccountId: "acct-rome", treasuryPermissions: ["propose_spending"] as never }));
    expect(proposes[0]).toBe("Treasury: may propose spending from the treasury, but cannot spend without a vote.");
  });

  it("says plainly when a man may move money but has no treasury of the state to draw on", () => {
    const [line] = describeOfficePowers(office({ authorisedActionIds: ["money_transfer"] }));
    expect(line).toBe("Money: may spend and move money, but has no treasury of the state to draw on.");
  });

  it("reads the reserved powers, the veto and the roll of former magistrates", () => {
    const lines = describeOfficePowers(office({ sponsorableCategories: ["declare_war", "borrow"] as never, vetoes: true, enrolsFormerMagistrates: true }));
    expect(lines).toContain("May bring before the chamber a motion to declare war and borrow for the state.");
    expect(lines.some((line) => line.startsWith("Veto:"))).toBe(true);
    expect(lines.some((line) => line.includes("held a magistracy"))).toBe(true);
  });

  it("names the department an office heads or sits in, and only its own", () => {
    const departments = [
      { name: "the Treasury", levers: [], officeIds: ["office-consul"], headOfficeId: "office-consul" },
      { name: "the Roads", levers: [], officeIds: ["office-censor"], headOfficeId: "office-censor" },
      { name: "the Senate's board", levers: [], officeIds: ["office-consul", "office-censor"], headOfficeId: "office-censor" },
    ];
    const lines = describeOfficePowers(office(), { departments });
    expect(lines).toEqual(["Heads the Treasury.", "Sits in the Senate's board."]);
  });
});
