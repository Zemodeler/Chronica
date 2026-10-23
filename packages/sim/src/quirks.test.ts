import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type Character, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { writeLetter } from "./letter-craft";
import { letterVerdict } from "./letter-verdict";
import { favouredNeighbour, flourishOf, hasQuirk, quirksOf, type QuirkId } from "./quirks";

const BASE: WorldState = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const people = Array.from({ length: 600 }, (_, i) => ({ id: `man-${i}` }));

describe("what is particular about a man", () => {
  it("gives every man two different quirks, the same two for life", () => {
    for (const man of people.slice(0, 100)) {
      const [a, b] = quirksOf(man);
      expect(a!.id).not.toBe(b!.id);
      expect(quirksOf(man).map((q) => q.id)).toEqual([a!.id, b!.id]);
    }
  });

  it("is spread across every quirk, each in about a fifth of men, and not the same pair in every man", () => {
    const counts = new Map<QuirkId, number>();
    for (const man of people) for (const quirk of quirksOf(man)) counts.set(quirk.id, (counts.get(quirk.id) ?? 0) + 1);
    expect(counts.size).toBe(10);
    for (const [, count] of counts) {
      expect(count).toBeGreaterThan(people.length * 0.1);
      expect(count).toBeLessThan(people.length * 0.3);
    }
    expect(new Set(people.map((man) => quirksOf(man).map((q) => q.id).sort().join("+"))).size).toBeGreaterThan(20);
  });

  it("picks the one neighbour a grudge-bearer will not forgive, or a friend is fond of, the same every time and not for everyone", () => {
    const neighbours = ["a", "b", "c", "d", "e", "f", "g"];
    const bearers = people.filter((man) => hasQuirk(man, "grudge_bearer"));
    expect(bearers.length).toBeGreaterThan(20);
    const chosen = bearers.map((man) => favouredNeighbour(man, neighbours, "grudge_bearer"));
    expect(chosen.every((who) => who !== null && neighbours.includes(who))).toBe(true);
    expect(new Set(chosen).size).toBeGreaterThan(3);
    expect(favouredNeighbour(bearers[0]!, neighbours, "grudge_bearer")).toBe(favouredNeighbour(bearers[0]!, [...neighbours].reverse(), "grudge_bearer"));
    // A man without the quirk has no such neighbour, and neither does a man with none to choose from.
    const free = people.find((man) => !hasQuirk(man, "grudge_bearer"))!;
    expect(favouredNeighbour(free, neighbours, "grudge_bearer")).toBeNull();
    expect(favouredNeighbour(bearers[0]!, [], "grudge_bearer")).toBeNull();
  });

  it("shows in what he writes: a saying, the gods, a long explanation -- for the men who have the habit and no one else", () => {
    const says = people.find((man) => hasQuirk(man, "proverbial"))!;
    const plain = people.find((man) => !["proverbial", "devout", "long_winded"].some((id) => hasQuirk(man, id as QuirkId)))!;
    expect(flourishOf(says, "demand").length).toBeGreaterThan(20);
    expect(flourishOf(plain, "demand")).toBe("");
    const base = BASE.characters[0]!;
    const asMan = (m: { id: string }): Character => ({ ...base, id: m.id });
    const facts = { us: "Carthage", them: "Rome", matter: "the strait", ask: "that you withdraw", days: 30 };
    expect(writeLetter(asMan(says), 100, "demand", facts, "x").body).toContain(flourishOf(says, "demand"));
    expect(writeLetter(asMan(plain), 100, "demand", facts, "x").body.length).toBeLessThan(writeLetter(asMan(says), 100, "demand", facts, "x").body.length);
  });
});

describe("how a man's own quirks and his liking for the writer decide an answer", () => {
  const polities = BASE.map.polities.map((polity) => polity.id);
  const asker = polities[0]!, answererPolity = polities[1]!;
  const request = (kind: DiplomaticMessage["kind"], proposes: DiplomaticMessage["proposes"]): DiplomaticMessage => ({
    id: "q-1", kind, fromPolityId: asker, fromCharacterId: "writer-1", toPolityId: answererPolity, toCharacterId: "answerer-1", subject: "A request", terms: "x",
    sentAtStep: 0, replyDueByStep: 400, status: "awaiting_reply", answer: null, answerText: null, answeredAtStep: null, inReplyToMessageId: null, visibility: "polity", proposes,
  });

  /** An answerer whose mind is exactly the middle of everything, so only what is varied here varies. */
  function answerer(id: string, relation: number | null): Character {
    const base = BASE.characters[0]!;
    return {
      ...base, id, traits: [],
      mind: { ...base.mind, riskTolerance: 50, temperament: { boldness: 50, caution: 50, honesty: 50, sociability: 50, discipline: 50, cruelty: 50 }, drives: { security: 50, status: 50, wealth: 50, family: 50, faith: 50, duty: 50, revenge: 50 } },
      relations: relation === null ? [] : [{ subjectCharacterId: "writer-1", causes: [{ id: "c", label: "x", score: relation, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] as never,
    };
  }
  // One world to a trust, kept: the board is read once per world, and is the expensive part.
  const kept = new Map<number, WorldState>();
  const world = (trust: number): WorldState => { let w = kept.get(trust); if (w === undefined) { w = build(trust); kept.set(trust, w); } return w; };
  const build = (trust: number): WorldState => ({ ...BASE, instant: { day: 100, minute: 0 }, polityStances: [...BASE.polityStances.filter((s) => !(s.polityId === answererPolity && s.towardPolityId === asker)), { polityId: answererPolity, towardPolityId: asker, trustScore: trust, grievances: [] } as never] });

  it("lets a friend have what a stranger would not be given, and an enemy be refused what a stranger would get", () => {
    // A trust that is just short for a stranger: the man's liking tips it.
    let tipped = 0, lost = 0;
    for (let trust = -10; trust <= 50; trust += 2) {
      const w = world(trust);
      const stranger = letterVerdict(w, request("alliance_offer", ["alliance"]), answerer("answerer-1", null))!.accepted;
      const friend = letterVerdict(w, request("alliance_offer", ["alliance"]), answerer("answerer-1", 55))!.accepted;
      const enemy = letterVerdict(w, request("alliance_offer", ["alliance"]), answerer("answerer-1", -55))!.accepted;
      if (friend && !stranger) tipped += 1;
      if (stranger && !enemy) lost += 1;
      expect(!friend && stranger).toBe(false);
      expect(!stranger && enemy).toBe(false);
    }
    expect(tipped).toBeGreaterThan(2);
    expect(lost).toBeGreaterThan(2);
  });

  it("makes a suspicious man want more trust than a generous one for the same request", () => {
    const needed = (id: string) => {
      for (let trust = -80; trust <= 90; trust += 5) if (letterVerdict(world(trust), request("military_aid_request", undefined), answerer(id, null))?.accepted) return trust;
      return 100;
    };
    const suspicious = people.find((man) => hasQuirk(man, "suspicious") && !hasQuirk(man, "generous"))!;
    const generous = people.find((man) => hasQuirk(man, "generous") && !hasQuirk(man, "suspicious"))!;
    const neither = people.find((man) => !hasQuirk(man, "generous") && !hasQuirk(man, "suspicious") && !hasQuirk(man, "grudge_bearer") && !hasQuirk(man, "loyal_friend"))!;
    expect(needed(suspicious.id)).toBeGreaterThan(needed(neither.id));
    expect(needed(neither.id)).toBeGreaterThan(needed(generous.id));
  });

  it("takes another month over a decision in the months the omens are against it, if he reads them", () => {
    const reader = people.find((man) => hasQuirk(man, "superstitious"))!;
    const slowness = Array.from({ length: 24 }, (_, month) => letterVerdict({ ...world(0), instant: { day: month * 30, minute: 0 } }, request("peace_talks", undefined), answerer(reader.id, null))!.slowness);
    expect(new Set(slowness).size).toBeGreaterThan(1);
    const plain = people.find((man) => !hasQuirk(man, "superstitious"))!;
    const steady = Array.from({ length: 24 }, (_, month) => letterVerdict({ ...world(0), instant: { day: month * 30, minute: 0 } }, request("peace_talks", undefined), answerer(plain.id, null))!.slowness);
    expect(new Set(steady).size).toBe(1);
  });
});
