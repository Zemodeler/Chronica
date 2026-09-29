import { describe, expect, it } from "vitest";
import { spelledAlike, whoIsNamed } from "./names";

const people = [
  { id: "hieron-ii", name: "Hieron II" },
  { id: "declared-028f", name: "Gaius Genucius Clepsina" },
  { id: "declared-npc-lucius", name: "Lucius Genucius Clepsina" },
  { id: "hanno-carthage", name: "Hanno of Carthage" },
  { id: "hannibal-gisco", name: "Hannibal Gisco" },
];

describe("who a name means", () => {
  it("takes a spelling a letter off for the same man", () => {
    expect(spelledAlike("Hiero II", "Hieron II")).toBe(true);
    expect(whoIsNamed(people, "Hiero II")?.id).toBe("hieron-ii");
    expect(whoIsNamed(people, "hieron ii")?.id).toBe("hieron-ii");
  });

  it("finds a person written by name rather than id", () => {
    expect(whoIsNamed(people, "Gaius Genucius Clepsina")?.id).toBe("declared-028f");
  });

  it("means nobody when it could mean two", () => {
    expect(whoIsNamed(people, "Genucius Clepsina")).toBeNull();
    expect(whoIsNamed(people, "Clepsina")).toBeNull();
  });

  it("does not stretch a short name to fit", () => {
    expect(spelledAlike("Hanno", "Hanna")).toBe(true);
    expect(spelledAlike("Gisco", "Hanno")).toBe(false);
    expect(spelledAlike("Hanno of Carthage", "Hannibal Gisco")).toBe(false);
    expect(whoIsNamed(people, "Mago")).toBeNull();
  });
});
