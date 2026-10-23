import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type Character, type WorldState } from "@chronica/shared";
import { perceivedRatio } from "./perceive";

// Parsed once: the world is large and the beliefs are cheap.
const BASE = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const world = (day: number): WorldState => ({ ...BASE, instant: { day, minute: 0 } });
const base = (): Character => BASE.characters[0]!;

const man = (id: string, over: { intrigue?: number; learning?: number; pride?: number; fear?: number } = {}): Character => {
  const c = base();
  return {
    ...c, id,
    skills: { ...c.skills, intrigue: over.intrigue ?? 50, learning: over.learning ?? 50 },
    mind: { ...c.mind, drives: { ...c.mind.drives, status: over.pride ?? 50, revenge: over.pride ?? 50, duty: 50, security: over.fear ?? 50 }, temperament: { ...c.mind.temperament, caution: over.fear ?? 50 } },
  };
};
const neighbour = (over: Partial<{ ratio: number; km: number; relation: "none" | "war" }> = {}) => ({ polityId: "x", ratio: 1, km: 500, relation: "none" as const, ...over });

describe("what a ruler believes of his neighbour's strength", () => {
  it("is the same for the same ruler all quarter, and changes with the news the next", () => {
    const a = man("ruler-1");
    expect(perceivedRatio(world(100), a, neighbour())).toBe(perceivedRatio(world(150), a, neighbour()));
    const quarters = new Set([0, 100, 200, 300, 400, 500].map((day) => perceivedRatio(world(day), a, neighbour()).toFixed(3)));
    expect(quarters.size).toBeGreaterThan(3);
  });

  it("is a different belief for different men about the same neighbour", () => {
    const beliefs = new Set(Array.from({ length: 30 }, (_, i) => perceivedRatio(world(100), man(`ruler-${i}`), neighbour()).toFixed(3)));
    expect(beliefs.size).toBeGreaterThan(20);
  });

  it("is centred on the truth for a middling man, and is not exact", () => {
    const readings = Array.from({ length: 300 }, (_, i) => perceivedRatio(world(100), man(`ruler-${i}`), neighbour({ ratio: 1.5 })));
    const mean = readings.reduce((sum, value) => sum + value, 0) / readings.length;
    expect(mean).toBeGreaterThan(1.3);
    expect(mean).toBeLessThan(1.7);
    expect(readings.filter((value) => Math.abs(value - 1.5) > 0.05).length).toBeGreaterThan(readings.length * 0.8);
  });

  it("is further out for a distant neighbour than for a near one, and for a man who knows little than one who knows much", () => {
    const spread = (km: number, intrigue: number, learning: number, relation: "none" | "war" = "none") => {
      const logs = Array.from({ length: 300 }, (_, i) => Math.log(perceivedRatio(world(100), man(`ruler-${i}`, { intrigue, learning }), neighbour({ km, relation }))));
      const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
      return Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / logs.length);
    };
    expect(spread(2_500, 50, 50)).toBeGreaterThan(spread(100, 50, 50) * 1.3);
    expect(spread(800, 10, 10)).toBeGreaterThan(spread(800, 90, 90) * 1.2);
    // And a power he is at war with, he has seen the armies of.
    expect(spread(800, 50, 50, "war")).toBeLessThan(spread(800, 50, 50) * 0.6);
  });

  it("flatters the proud, who think themselves stronger than they are, and frightens the fearful, who think the enemy stronger", () => {
    const mean = (over: { pride?: number; fear?: number }) => {
      const logs = Array.from({ length: 300 }, (_, i) => Math.log(perceivedRatio(world(100), man(`ruler-${i}`, over), neighbour({ ratio: 1 }))));
      return logs.reduce((s, v) => s + v, 0) / logs.length;
    };
    expect(mean({ pride: 95 })).toBeGreaterThan(mean({ pride: 5 }) + 0.15);
    expect(mean({ fear: 95 })).toBeLessThan(mean({ fear: 5 }) - 0.1);
  });

  it("is never absurd: always positive and bounded", () => {
    for (let i = 0; i < 50; i += 1) {
      const value = perceivedRatio(world(100), man(`ruler-${i}`, { intrigue: 0, learning: 0, pride: 100 }), neighbour({ ratio: 40, km: 9_000 }));
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(50);
    }
  });
});
