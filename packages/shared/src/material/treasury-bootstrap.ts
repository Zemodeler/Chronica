import type { MaterialWorldState } from "../material-state";
import type { WorldState } from "../world/world-state";

// A polity's treasury.
//
// docs/plans/ai-world-matters-runtime.md, "Treasury and monetary provenance":
// every represented polity should have one canonical polity-owned account
// unless the scenario explicitly models a different arrangement. This
// mirrors `character-accounts.ts`'s own reasoning for a character's purse --
// a polity with no treasury of its own is not merely poor: `collect_revenue`,
// fiscal authority grants, and matter routing all read a real account, not a
// hint.

/** The treasury account id a polity is given at runtime. Derived, so it is stable across a replay. */
export function polityTreasuryId(polityId: string): string {
  return `treasury-${polityId}`;
}

/**
 * Ensures every polity in `world.map.polities` owns one active `MoneyAccount`.
 *
 * Idempotent: a polity that already owns an account (whatever its id) keeps
 * it untouched. A newly opened treasury always starts at balance 0 -- an
 * opening balance is scenario-authored, and an existing campaign must never
 * receive unexplained retrospective wealth (doc, "Polity treasuries"). This
 * is setup/migration bookkeeping, not history: it emits no `FactualEvent`,
 * so a treasury appearing for the first time is never itself narrated.
 */
export function ensurePolityTreasuries(world: WorldState, atStep: number): WorldState {
  void atStep; // accepted for parity with `ensureProvinceMaterial`'s call convention; treasury creation itself carries no step-dependent state.
  const polities = world.map.polities;
  const ownedByPolity = new Set(
    world.material.accounts.filter((a) => a.owner.kind === "polity").map((a) => a.owner.id),
  );
  const missing = polities.filter((p) => !ownedByPolity.has(p.id));
  if (missing.length === 0) return world;

  let material: MaterialWorldState = world.material;
  for (const polity of missing) {
    const preferredId = polityTreasuryId(polity.id);
    if (material.accounts.some((a) => a.id === preferredId)) continue; // id collision with an unrelated account; leave the polity without one rather than guess a second id
    material = {
      ...material,
      accounts: [
        ...material.accounts,
        {
          id: preferredId,
          owner: { kind: "polity" as const, id: polity.id },
          currencyId: material.currency.id,
          balance: 0,
          status: "active" as const,
          visibility: "polity" as const,
        },
      ],
    };
  }

  return { ...world, material };
}
