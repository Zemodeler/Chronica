import { leaderOf, nearestShore, type Force, type WorldState } from "@chronica/shared";

/**
 * The allies' ships (socii navales).
 *
 * Rome had almost no fleet of its own in 264. It crossed to Sicily in the
 * hulls of Tarentum, Locri, Velia and Neapolis, which owed them under their
 * treaties as the Latins owed men -- and the engine levied allies for men
 * alone, so a consul with half of Magna Graecia bound to him could cross only
 * in ships Rome itself had built or hired. Now a port-holding ally sends hulls
 * with its contingent when its leader goes to war (`treaties.ts`), and a
 * magistrate may call for them whenever he needs them: "requisition the socii
 * navales" is a `force_create` of transports under the ally's name, raised in
 * its harbours at its own cost (`apply-deltas.ts`, "force_create").
 */

/** Transports each of an ally's harbours can send, and the fewest a harbour-less coast still finds. */
export const HULLS_PER_PORT = 15;
const HULLS_ON_A_BARE_COAST = 5;
/** The category the allies send: hulls that carry, which is what was asked of them. */
export const ALLIED_HULL_CATEGORY = "transport";

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const isHulls = (force: Force): boolean => force.personnel.some((group) => /transport|warship|ship|hull|galley|trireme|quinquereme/i.test(group.categoryId) && group.fit > 0);

/** Whether a force_create names ships, by its category: what a requisition of the allies' hulls looks like. */
export const namesShips = (categoryId: string | undefined): boolean => categoryId !== undefined && /transport|warship|ship|hull|galley|trireme|quinquereme/i.test(categoryId);

/** Whether this power follows that one by foedus, and so owes it ships. */
export const owesShipsTo = (world: WorldState, allyId: string, leaderId: string): boolean => allyId !== leaderId && leaderOf(world.polityAgreements, allyId) === leaderId;

/**
 * What an ally can still send: its harbours' worth of hulls, less those of
 * its already afloat. Zero for an ally with no coast.
 */
export function alliedHullsAvailable(world: WorldState, allyId: string): { readonly hulls: number; readonly shore: string | null } {
  const coast = world.map.provinces.filter((province) => province.controllerPolityId === allyId || province.settlements.some((settlement) => settlement.controllerPolityId === allyId));
  const ports = coast.flatMap((province) => province.settlements).filter((settlement) => settlement.kind === "port" && settlement.controllerPolityId === allyId);
  const shores = [...new Set(coast.map((province) => nearestShore(world, province.id)))].filter((id) => coast.some((province) => province.id === id)).sort();
  const shore = ports[0]?.provinceId ?? shores[0] ?? null;
  if (shore === null) return { hulls: 0, shore: null };
  const owed = ports.length > 0 ? ports.length * HULLS_PER_PORT : HULLS_ON_A_BARE_COAST;
  const afloat = world.material.forces.filter((force) => force.polityId === allyId && isHulls(force)).reduce((sum, force) => sum + fitOf(force), 0);
  return { hulls: Math.max(0, owed - afloat), shore };
}

/**
 * The hulls an ally sends: a force of its own, in its own harbour, at its own
 * cost, under the man the order names -- or the reason none come.
 */
export function requisitionAlliedHulls(world: WorldState, input: {
  readonly id: string; readonly chestId: string; readonly allyId: string; readonly name: string; readonly wanted: number;
  readonly commanderId: string; readonly controllerId: string; readonly categoryId: string; readonly label: string; readonly atStep: number;
}): { readonly world: WorldState; readonly hulls: number; readonly shore: string } | string {
  const ally = world.map.polities.find((polity) => polity.id === input.allyId)?.name ?? input.allyId;
  const { hulls, shore } = alliedHullsAvailable(world, input.allyId);
  if (shore === null) return `${ally} holds no coast, and has no ships to send.`;
  if (hulls <= 0) return `${ally} has sent every hull its harbours owe already.`;
  const sent = Math.min(hulls, input.wanted);
  const force: Force = {
    id: input.id, name: input.name, polityId: input.allyId, commanderCharacterId: input.commanderId, controllerCharacterId: input.controllerId,
    locationId: shore, positionId: null, authorizedStrength: sent, personnel: [{ categoryId: input.categoryId, label: input.label, fit: sent, unavailable: [] }],
    moraleBps: 6_000, cohesionBps: 5_500, fatigueBps: 0, provisionStatus: "provisioned", provisionedThroughStep: input.atStep + 60,
    payObligationId: null, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
  };
  return {
    world: {
      ...world,
      material: {
        ...world.material,
        forces: [...world.material.forces, force],
        accounts: [...world.material.accounts, { id: input.chestId, owner: { kind: "force", id: input.id }, currencyId: world.material.currency.id, balance: 0, status: "active", visibility: "polity" }],
      },
    },
    hulls: sent,
    shore,
  };
}
