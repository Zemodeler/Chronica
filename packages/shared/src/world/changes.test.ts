import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "../index";
import { diffWorlds } from "./changes";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

const detailFor = (changes: ReturnType<typeof diffWorlds>, id: string): string | undefined =>
  changes.find((change) => change.id === id)?.detail;

describe("what changed on the map", () => {
  it("finds nothing in a world that did not move", () => {
    expect(diffWorlds(base(), base())).toEqual([]);
  });

  it("names a province that changed hands, and both powers' new reach", () => {
    const before = base();
    const province = before.map.provinces.find((candidate) => candidate.controllerPolityId !== null)!;
    const taker = before.map.polities.find((polity) => polity.id !== province.controllerPolityId)!;
    const after: WorldState = {
      ...before,
      map: { ...before.map, provinces: before.map.provinces.map((candidate) => (candidate.id === province.id ? { ...candidate, controllerPolityId: taker.id } : candidate)) },
    };

    const changes = diffWorlds(before, after);
    expect(detailFor(changes, province.id)).toContain(`to ${taker.name}`);
    expect(detailFor(changes, taker.id)).toBe("holds 1 province more");
    expect(detailFor(changes, province.controllerPolityId!)).toBe("holds 1 province fewer");
  });

  it("notices an army that bled, and one that is gone", () => {
    const before = base();
    const force = before.material.forces[0]!;
    const bled = { ...force, personnel: force.personnel.map((category) => ({ ...category, fit: Math.max(0, category.fit - 900) })) };
    const afterBled: WorldState = { ...before, material: { ...before.material, forces: [bled, ...before.material.forces.slice(1)] } };
    expect(detailFor(diffWorlds(before, afterBled), force.id)).toMatch(/^down /);

    const afterGone: WorldState = { ...before, material: { ...before.material, forces: before.material.forces.slice(1) } };
    expect(detailFor(diffWorlds(before, afterGone), force.id)).toContain("destroyed or dispersed");
  });

  it("says nothing about a handful of men, which is not a change anybody sees", () => {
    const before = base();
    const force = before.material.forces[0]!;
    const category = force.personnel[0]!;
    const after: WorldState = {
      ...before,
      material: { ...before.material, forces: [{ ...force, personnel: [{ ...category, fit: category.fit - 12 }, ...force.personnel.slice(1)] }, ...before.material.forces.slice(1)] },
    };
    expect(diffWorlds(before, after)).toEqual([]);
  });

  it("records a death", () => {
    const before = base();
    const character = before.characters.find((candidate) => candidate.alive)!;
    const after: WorldState = { ...before, characters: before.characters.map((candidate) => (candidate.id === character.id ? { ...candidate, alive: false } : candidate)) };
    expect(detailFor(diffWorlds(before, after), character.id)).toBe("dies");
  });
});

describe("an army that was only ordered bigger", () => {
  it("records a reinforcement, which moves authorized strength before it moves men", () => {
    // A garrison strengthened by three hundred produced no change row at all,
    // because the men had been called up and had not yet arrived.
    const before = base();
    const force = before.material.forces[0]!;
    const after: WorldState = {
      ...before,
      material: {
        ...before.material,
        forces: [{ ...force, authorizedStrength: force.authorizedStrength + 300 }, ...before.material.forces.slice(1)],
      },
    };
    expect(detailFor(diffWorlds(before, after), force.id)).toContain("300 more than before");
  });

  it("ignores an adjustment too small for anyone to notice", () => {
    const before = base();
    const force = before.material.forces[0]!;
    const after: WorldState = {
      ...before,
      material: { ...before.material, forces: [{ ...force, authorizedStrength: force.authorizedStrength + 20 }, ...before.material.forces.slice(1)] },
    };
    expect(diffWorlds(before, after)).toEqual([]);
  });
});

describe("what changed beyond the map", () => {
  it("says a purse that moved, claimed by its owner", () => {
    const before = base();
    const account = before.material.accounts.find((candidate) => candidate.balance >= 1_000)!;
    const after: WorldState = {
      ...before,
      material: { ...before.material, accounts: before.material.accounts.map((candidate) => (candidate.id === account.id ? { ...candidate, balance: candidate.balance - 500 } : candidate)) },
    };
    const change = diffWorlds(before, after).find((candidate) => candidate.id === account.id)!;
    expect(change.kind).toBe("account");
    expect(change.detail).toMatch(/^down 500 to/);
    expect(change.claimedBy).toEqual([account.owner.id]);
  });

  it("does not remark on small change", () => {
    const before = base();
    const account = [...before.material.accounts].sort((a, b) => b.balance - a.balance)[0]!;
    const after: WorldState = {
      ...before,
      material: { ...before.material, accounts: before.material.accounts.map((candidate) => (candidate.id === account.id ? { ...candidate, balance: candidate.balance - 20 } : candidate)) },
    };
    expect(diffWorlds(before, after)).toEqual([]);
  });

  it("says who broke a promise, claimed by both parties", () => {
    const before = WorldStateSchema.parse({
      ...base(),
      commitments: [{
        id: "grain", promisorCharacterId: base().characters[0]!.id, beneficiaryCharacterId: base().characters[1]!.id, actionKind: "payment",
        description: "Grain by the Ides", visibility: "private", sourceEventId: null, status: "pending", createdAtStep: 0, reviewAtStep: 10,
      }],
    });
    const after: WorldState = { ...before, commitments: before.commitments.map((commitment) => ({ ...commitment, status: "broken" as const, resolvedAtStep: 0 })) };
    const change = diffWorlds(before, after).find((candidate) => candidate.detail.includes("promise"))!;
    expect(change.detail).toMatch(/^broke a promise to .+: grain by the Ides$/);
    expect(change.claimedBy).toEqual([before.characters[1]!.id]);
  });
});

describe("why it changed", () => {
  const moveMoney = (before: WorldState, amount: number, cause: { kind: "scheduled_income" | "action"; id: string }) => {
    const account = before.material.accounts.find((candidate) => candidate.balance >= 1_000)!;
    const after: WorldState = {
      ...before,
      material: {
        ...before.material,
        accounts: before.material.accounts.map((candidate) => (candidate.id === account.id ? { ...candidate, balance: candidate.balance + amount } : candidate)),
        transactions: [...before.material.transactions, {
          id: "tx-new", atStep: 7, kind: cause.kind === "action" ? "purchase" : "income", amount: Math.abs(amount),
          ...(amount > 0 ? { destinationAccountId: account.id } : { sourceAccountId: account.id }),
          cause: { ...cause, explanation: "test" }, visibility: "public",
        }],
      },
    };
    return diffWorlds(before, after).find((candidate) => candidate.id === account.id)!;
  };

  it("marks a purse that only took its rents as the world's routine", () => {
    // "Treasury up 1,234" rode on every entry naming Rome.
    const change = moveMoney(base(), 900, { kind: "scheduled_income", id: "rents" });
    expect(change.routine).toBe(true);
    expect(change.causes).toEqual([]);
  });

  it("names what spent the money, and the day", () => {
    const change = moveMoney(base(), -900, { kind: "action", id: "fleet-project" });
    expect(change.routine).toBe(false);
    expect(change.causes).toEqual([{ id: "fleet-project", day: 7 }]);
  });

  it("marks an army that grew only by its mended wounded as the world's routine", () => {
    const before = base();
    const force = before.material.forces[0]!;
    const category = force.personnel[0]!;
    const after: WorldState = {
      ...before,
      material: {
        ...before.material,
        forces: [{
          ...force,
          personnel: [{ ...category, fit: category.fit + 361 }, ...force.personnel.slice(1)],
          history: [...force.history, { id: "mended", atStep: 9, kind: "recovery", categoryId: category.categoryId, count: 361, causeId: force.id }],
        }, ...before.material.forces.slice(1)],
      },
    };
    const change = diffWorlds(before, after).find((candidate) => candidate.id === force.id && candidate.detail.startsWith("up"))!;
    expect(change.routine).toBe(true);
  });
});
