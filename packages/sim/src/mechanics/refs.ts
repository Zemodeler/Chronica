import { atWar, provinceLevel, provinceTaxCapacity, treasuryOf, type GenericEntity, type OrderPartyRef, type WorldState, PROVINCE_LEVELS } from "@chronica/shared";

/**
 * What a rule may name: the values the engine can read for this arrangement,
 * offered to the writer and accepted by the validator from one list, so the
 * model is never offered an id the engine would refuse.
 *
 * Deliberately near: the owner's purse or treasury, the arrangement's own
 * fund, the treasury of whoever controls the province, the people standing in
 * it, the province itself and the owner's, the powers concerned. A rule that
 * wants to reach a far treasury or a stranger is refused, by design; the
 * audit shows it as `mechanic_refused` if the model keeps reaching.
 */

export interface ReadableAccount {
  readonly id: string;
  readonly label: string;
  /** Whether the owner controls it: his own purse, his treasury, the arrangement's fund. */
  readonly owned: boolean;
  /** The person whose purse it is, when it is a person's. */
  readonly characterId: string | null;
}

export interface ReadableRefs {
  readonly owner: OrderPartyRef;
  readonly ownerPolityId: string | null;
  readonly ownerAccountId: string | null;
  readonly accounts: readonly ReadableAccount[];
  readonly provinces: readonly { readonly id: string; readonly name: string; readonly taxCapacity: number | null; readonly levels: Readonly<Record<(typeof PROVINCE_LEVELS)[number], number | null>> }[];
  readonly polities: readonly { readonly id: string; readonly name: string }[];
  readonly characters: readonly { readonly id: string; readonly name: string; readonly purseId: string | null }[];
  readonly forces: readonly { readonly id: string; readonly name: string; readonly strength: number }[];
  readonly wars: readonly (readonly [string, string])[];
  /** The binding slots a shape is cut and refilled by (`shape.ts`). */
  readonly slots: Readonly<Record<Slot, string | null>>;
}

export const SLOTS = ["$owner", "$owner_account", "$owner_province", "$owner_polity", "$controller", "$controller_treasury", "$fund"] as const;
export type Slot = (typeof SLOTS)[number];

const MAX_PEOPLE = 8;
const MAX_FORCES = 4;
const MAX_POLITIES = 6;

function purseOf(world: WorldState, characterId: string): string | null {
  return world.material.accounts.find((account) => account.owner.kind === "character" && account.owner.id === characterId && account.status === "active")?.id ?? null;
}

export function readableRefsFor(world: WorldState, owner: OrderPartyRef, entity: GenericEntity): ReadableRefs {
  const ownerCharacter = owner.kind === "character" ? world.characters.find((character) => character.id === owner.id) : undefined;
  const ownerPolityId = owner.kind === "polity" ? owner.id : ownerCharacter?.polityId ?? null;
  const ownerAccountId = owner.kind === "character" ? purseOf(world, owner.id) : owner.kind === "polity" ? treasuryOf(world, owner.id) : null;
  const provinceIds = [...new Set([entity.provinceId ?? null, ownerCharacter?.locationProvinceId ?? null].filter((id): id is string => id !== null))];
  const controllerId = provinceIds.length === 0 ? null : world.map.provinces.find((province) => province.id === provinceIds[0])?.controllerPolityId ?? null;
  const controllerTreasury = controllerId === null ? null : treasuryOf(world, controllerId);
  const fund = world.material.accounts.find((account) => account.owner.kind === "entity" && account.owner.id === entity.id && account.status === "active")?.id ?? null;

  const nameOfCharacter = (id: string) => world.characters.find((character) => character.id === id)?.name ?? id;
  const nameOfPolity = (id: string) => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

  // The people in it: those standing in the arrangement's province, and those
  // the owner has any relation with. The toll-payers, the racket's victims.
  const related = new Set(ownerCharacter?.relations.map((relation) => relation.subjectCharacterId) ?? []);
  const people = world.characters
    .filter((character) => character.alive && character.id !== owner.id && ((character.locationProvinceId !== null && provinceIds.includes(character.locationProvinceId)) || related.has(character.id)))
    .sort((a, b) => Number(related.has(b.id)) - Number(related.has(a.id)) || a.id.localeCompare(b.id))
    .slice(0, MAX_PEOPLE);

  const accounts: ReadableAccount[] = [];
  if (ownerAccountId !== null) accounts.push({ id: ownerAccountId, label: owner.kind === "polity" ? `the treasury of ${nameOfPolity(owner.id)}` : `${nameOfCharacter(owner.id)}'s purse`, owned: true, characterId: owner.kind === "character" ? owner.id : null });
  // Its own fund only once it has one: offered before it existed, the writer
  // wrote rules that waited for money in it that nothing ever paid.
  if (fund !== null) accounts.push({ id: fund, label: `${entity.label}'s own fund`, owned: true, characterId: null });
  if (controllerTreasury !== null && controllerTreasury !== ownerAccountId && controllerId !== null) accounts.push({ id: controllerTreasury, label: `the treasury of ${nameOfPolity(controllerId)}`, owned: false, characterId: null });
  for (const person of people) {
    const purse = purseOf(world, person.id);
    if (purse !== null) accounts.push({ id: purse, label: `${person.name}'s purse`, owned: false, characterId: person.id });
  }

  const polityIds = new Set<string>();
  if (ownerPolityId !== null) polityIds.add(ownerPolityId);
  if (controllerId !== null) polityIds.add(controllerId);
  const wars: [string, string][] = [];
  for (const agreement of world.polityAgreements) {
    if (agreement.status !== "active" || agreement.kind !== "war") continue;
    if (polityIds.has(agreement.polityId) || polityIds.has(agreement.otherPolityId)) {
      wars.push([agreement.polityId, agreement.otherPolityId]);
      polityIds.add(agreement.polityId);
      polityIds.add(agreement.otherPolityId);
    }
  }

  return {
    owner,
    ownerPolityId,
    ownerAccountId,
    accounts,
    provinces: provinceIds.map((id) => ({
      id,
      name: world.map.provinces.find((province) => province.id === id)?.name ?? id,
      taxCapacity: provinceTaxCapacity(world, id),
      levels: Object.fromEntries(PROVINCE_LEVELS.map((level) => [level, provinceLevel(world, id, level)])) as Record<(typeof PROVINCE_LEVELS)[number], number | null>,
    })),
    polities: [...polityIds].slice(0, MAX_POLITIES).map((id) => ({ id, name: nameOfPolity(id) })),
    characters: people.map((person) => ({ id: person.id, name: person.name, purseId: purseOf(world, person.id) })),
    forces: world.material.forces
      .filter((force) => force.locationId !== null && provinceIds.includes(force.locationId))
      .slice(0, MAX_FORCES)
      .map((force) => ({ id: force.id, name: force.name, strength: force.personnel.reduce((sum, category) => sum + category.fit, 0) })),
    wars: wars.filter(([a, b]) => atWar(world.polityAgreements, a, b)),
    slots: {
      $owner: owner.id,
      $owner_account: ownerAccountId,
      $owner_province: provinceIds[0] ?? null,
      $owner_polity: ownerPolityId,
      $controller: controllerId,
      $controller_treasury: controllerTreasury,
      $fund: fund,
    },
  };
}

/** The list as the writer is shown it: every id it may use, and what it is. */
export function renderReadableRefs(refs: ReadableRefs): string {
  const lines: string[] = ["READABLE VALUES (use only these ids):"];
  lines.push("Accounts:", ...refs.accounts.map((account) => `- ${account.id}: ${account.label}${account.owned ? " (yours to spend)" : " (needs their consent or your authority)"}`));
  lines.push("Provinces:", ...refs.provinces.map((province) =>
    `- ${province.id}: ${province.name}; tax capacity ${province.taxCapacity ?? "?"} a month; ${PROVINCE_LEVELS.map((level) => `${level} ${province.levels[level] ?? "?"} bps`).join(", ")}`));
  lines.push("Powers:", ...refs.polities.map((polity) => `- ${polity.id}: ${polity.name}`));
  if (refs.wars.length > 0) lines.push(`At war: ${refs.wars.map(([a, b]) => `${a} with ${b}`).join("; ")}`);
  if (refs.characters.length > 0) lines.push("People:", ...refs.characters.map((person) => `- ${person.id}: ${person.name}${person.purseId === null ? "" : ` (purse ${person.purseId})`}`));
  if (refs.forces.length > 0) lines.push("Armies:", ...refs.forces.map((force) => `- ${force.id}: ${force.name}, ${force.strength} fit`));
  return lines.join("\n");
}
