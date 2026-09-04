import type { MaterialWorldState } from "../material-state";
import type { WorldState } from "../world/world-state";

// A character's purse.
//
// `Character.personalAccountId` is not a hint -- candidate scoring, commitment
// settlement, inheritance, and the Game Master's `inspect_character` all read
// the balance behind it. A character whose purse does not exist is not merely
// poor: they are invisible to every one of those systems, silently.
//
// Scenario authors have always paired a character with an account by hand (see
// packages/db/src/built-in-scenarios.ts). These helpers make a workflow that
// creates a character at runtime do the same thing, and heal a snapshot from
// before they did.

/** The purse id a runtime-created character is given. Derived, so it is stable across a replay. */
export function characterPurseId(characterId: string): string {
  return `account-${characterId}`;
}

export interface OpenedCharacterAccount {
  readonly material: MaterialWorldState;
  /** The account the character owns afterwards — existing or newly opened. */
  readonly accountId: string;
}

/**
 * Give a character an active, private purse with ownership access.
 *
 * Idempotent: a character who already owns an account keeps it, and the
 * existing id is returned so the caller can point at it. Returns null when the
 * derived id is already taken by somebody else's account, so the caller can
 * refuse rather than produce a world with two accounts sharing an id.
 */
export function openCharacterAccount(
  material: MaterialWorldState,
  characterId: string,
  preferredAccountId: string = characterPurseId(characterId),
): OpenedCharacterAccount | null {
  const owned = material.accounts.find((account) => account.owner.kind === "character" && account.owner.id === characterId);
  if (owned !== undefined) return { material, accountId: owned.id };

  const idTaken = material.accounts.some((account) => account.id === preferredAccountId);
  if (idTaken) return null;

  return {
    accountId: preferredAccountId,
    material: {
      ...material,
      accounts: [
        ...material.accounts,
        {
          id: preferredAccountId,
          owner: { kind: "character" as const, id: characterId },
          currencyId: material.currency.id,
          balance: 0,
          status: "active" as const,
          visibility: "private" as const,
        },
      ],
      accountAccess: [
        ...material.accountAccess,
        {
          id: `${preferredAccountId}-access`,
          characterId,
          accountId: preferredAccountId,
          permissions: ["view" as const, "spend_without_vote" as const],
          sourceKind: "ownership" as const,
          sourceId: characterId,
        },
      ],
    },
  };
}

/**
 * Heal a snapshot whose characters point at purses that were never created.
 *
 * Two runtime workflows (`create_world_character`, `create_child_character`)
 * used to name an account and not open it, so games that ran them carry the
 * dangling reference in committed state. This repairs it the way the character
 * was always declared: the named account is opened, empty, owned by them. If
 * they turn out to already own a differently-named account, the character is
 * repointed at it instead of gaining a second one, because the material schema
 * allows an owner only one.
 *
 * A no-op — returning the same object — when nothing is broken.
 */
export function ensureCharacterAccounts(world: WorldState): WorldState {
  const accountIds = new Set(world.material.accounts.map((account) => account.id));
  const broken = world.characters.filter((character) => !accountIds.has(character.personalAccountId));
  if (broken.length === 0) return world;

  let material = world.material;
  const repointed = new Map<string, string>();
  for (const character of broken) {
    const opened = openCharacterAccount(material, character.id, character.personalAccountId);
    if (opened === null) continue;
    material = opened.material;
    if (opened.accountId !== character.personalAccountId) repointed.set(character.id, opened.accountId);
  }

  return {
    ...world,
    material,
    characters: repointed.size === 0
      ? world.characters
      : world.characters.map((character) => {
        const accountId = repointed.get(character.id);
        return accountId === undefined ? character : { ...character, personalAccountId: accountId };
      }),
  };
}
