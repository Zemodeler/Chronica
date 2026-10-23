import { GenericEntitySchema, WorldDeltaSchema, readDepartments, type FactProposalDraft, type Office, type PoliticalProcedure, type WorldDelta, type WorldState } from "@chronica/shared";
import { FLEET_HULLS, fleetBegun, fleetWork } from "./a-fleet-by-decree";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { carrierOf, polityOfQuestion, readDecree, type Decree } from "./decree-reader";
import { marchDeltas } from "./march-template";
import type { IdFactory } from "./ports";
import { safeLocalId } from "./safe-local-id";
import { beginsNothing } from "./senate";

/**
 * A carried question becomes an act (docs/economy.md, "Orders, calls and consequences"; the user's decision, 2026-10-08: "carried Senate motions become acts by rule: yes").
 *
 * A Senate, a council or an assembly that has carried a question naming a concrete act -- build a fleet, send an army to a place, levy so many men, lay the tribute at a rate,
 * give a man an army, seek peace or an alliance of a power -- has resolved it, and the month after the man who put it (else the head of the power) does it, through the deltas
 * the engine already has, as the carried decree of the hulls is (`a-fleet-by-decree.ts`). It is done once (a marker, `decreed_<question>`), told in a public fact either way, and
 * leaves a question whose words name no act, or two, as it always was: "a resolution of the Senate, no one is charged with it" (`senate.ts`). No model call.
 */

/** Days after the vote that the carried decree is done: "the month after". */
export const DECREE_AFTER_DAYS = 20;
/** A decree not done by then is left. */
export const DECREE_LAPSES_DAYS = 240;

export const markerOfDecree = (procedureId: string): string => `decreed_${procedureId}`.slice(0, 80);

export interface DecreeInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly offices: readonly Office[];
  readonly ids: IdFactory;
  readonly playerCharacterId: string | null;
  readonly rules: Pick<ApplyContext, "warfare" | "terrains" | "successionRules" | "wealth" | "gameId">;
}

/** Whether a shipbuilding work of this power is on: a decree for ships is not made twice. */
const buildingShips = (world: WorldState, polityId: string): boolean => world.projects.some((project) => project.kind === "shipbuilding" && project.status !== "completed" && project.status !== "cancelled" && project.sponsorEntityRef.id === polityId);

const nameOf = (world: WorldState, id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;
const polityName = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
const placeName = (world: WorldState, id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;

/** The acts a decree comes to, and what is said of it; or the reason it cannot be done. */
function actsOf(world: WorldState, decree: Decree, polityId: string, carrierId: string, procedure: PoliticalProcedure): { readonly deltas: readonly WorldDelta[]; readonly said: string } | { readonly refusal: string } {
  const carrier = world.characters.find((character) => character.id === carrierId)!;
  const power = polityName(world, polityId);
  switch (decree.kind) {
    case "fleet": {
      if (buildingShips(world, polityId)) return { refusal: `a fleet is already being built for ${power}` };
      const work = fleetWork(world, polityId, carrierId, decree.hulls ?? FLEET_HULLS);
      return work === null ? { refusal: `the chest of ${power} cannot bear the building of ships now, or it has no harbour of its own to build them in` }
        : { deltas: [fleetBegun(work, polityId, carrier)], said: `${work.completionOutcome.amount} hulls are laid down, at ${work.total} drachmae` };
    }
    case "levy": {
      const capital = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
      const home = decree.provinceId === null ? world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital)) ?? world.map.provinces.find((province) => province.controllerPolityId === polityId)
        : world.map.provinces.find((province) => province.id === decree.provinceId);
      if (home === undefined || home.controllerPolityId !== polityId) return { refusal: `the men cannot be called up at a place that is not ${power}'s` };
      return {
        deltas: [WorldDeltaSchema.parse({
          op: "force_create", localId: safeLocalId(`levy_${home.id}_${decree.men}`).toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60), name: `Levy of ${power} at ${home.name}`.slice(0, 120), polityId,
          commanderCharacterRef: carrierId, controllerCharacterRef: carrierId, locationId: home.id, authorizedStrength: decree.men, payObligationRef: null,
          reason: `${carrier.name} calls ${decree.men} men to the standards at ${home.name}, as the Senate resolved.`.slice(0, 240),
        })],
        said: `${decree.men} men are called to the standards at ${home.name}`,
      };
    }
    case "march": {
      const force = world.material.forces.find((candidate) => candidate.id === decree.forceId);
      if (force === undefined) return { refusal: "the army is gone" };
      return { deltas: marchDeltas(force, decree.provinceId, "march", carrier.name), said: `${force.name} is sent to ${placeName(world, decree.provinceId)}` };
    }
    case "tribute":
      return {
        deltas: [WorldDeltaSchema.parse({ op: "tax_policy_set", scope: "polity", polityId, provinceId: null, regime: "land_levy", rateBps: decree.rateBps, reason: `The tribute is laid at ${decree.rateBps / 100} in a hundred, as the Senate resolved.`.slice(0, 240) })],
        said: `the tribute is laid at ${decree.rateBps / 100} in a hundred`,
      };
    case "command": {
      const force = world.material.forces.find((candidate) => candidate.id === decree.forceId);
      if (force === undefined) return { refusal: "the army is gone" };
      return {
        deltas: [WorldDeltaSchema.parse({ op: "force_modify", forceRef: force.id, commanderCharacterRef: decree.characterId, reason: `${nameOf(world, decree.characterId)} is given ${force.name}, as the Senate resolved.`.slice(0, 240) })],
        said: `${nameOf(world, decree.characterId)} is given the command of ${force.name}`,
      };
    }
    case "letter": {
      const reader = readDepartments(world).rulers(decree.toPolityId)[0];
      const peace = decree.letter === "peace_offer";
      return {
        deltas: [WorldDeltaSchema.parse({
          op: "diplomatic_message_send", localId: safeLocalId(`${decree.letter}_${procedure.id}`).slice(0, 60), kind: decree.letter, fromPolityId: polityId, fromCharacterRef: carrierId, toPolityId: decree.toPolityId,
          toCharacterRef: reader?.id ?? null, subject: `${peace ? "Peace" : "An alliance"} between ${power} and ${polityName(world, decree.toPolityId)}`.slice(0, 240),
          terms: `${power} offers ${peace ? "peace" : "an alliance"}, as its council resolved: ${procedure.label}`.slice(0, 1_200), replyWithinDays: 60, visibility: "polity",
          reason: `${carrier.name} sends what the council resolved.`.slice(0, 240),
        })],
        said: `${peace ? "an offer of peace" : "an offer of alliance"} goes to ${polityName(world, decree.toPolityId)}`,
      };
    }
  }
}

/** Each carried question that names an act and has not been acted on, a month on, is done. */
export function carriedMotionsAreDone(input: DecreeInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  for (const procedure of input.world.material.politicalProcedures) {
    if (procedure.outcome !== "passed" || procedure.resolvedAtStep === null) continue;
    const since = input.toDay - procedure.resolvedAtStep;
    if (since < DECREE_AFTER_DAYS || since > DECREE_LAPSES_DAYS) continue;
    if (world.genericEntities.some((entity) => entity.kind === "decree" && entity.label === markerOfDecree(procedure.id))) continue;
    if (!beginsNothing(world, procedure)) continue;
    const polityId = polityOfQuestion(world, procedure);
    const decree = polityId === null ? null : readDecree(world, procedure, input.rules.warfare);
    if (polityId === null || decree === null) continue;
    const carrierId = carrierOf(world, procedure, polityId);
    if (carrierId === null) continue;
    const power = polityName(world, polityId);
    const carrier = nameOf(world, carrierId);
    const acts = actsOf(world, decree, polityId, carrierId, procedure);
    let done = false;
    let line: string;
    if ("refusal" in acts) {
      line = `${carrier} could not carry out what the ${power} resolved ("${procedure.label.slice(0, 120)}"): ${acts.refusal}.`;
    } else {
      const context: ApplyContext = {
        now: { day: input.toDay, minute: 540 }, actorRef: { kind: "character", id: carrierId }, offices: input.offices, ids: input.ids, playerCharacterId: input.playerCharacterId,
        actsForTheWorld: true, ...input.rules,
      };
      const tried = applyDeltas(world, [...acts.deltas], context);
      done = tried.applied.length > 0;
      if (done) world = tried.world;
      line = done
        ? `${carrier} carried out what the ${power} resolved: ${acts.said}.`
        : `${carrier} could not carry out what the ${power} resolved ("${procedure.label.slice(0, 120)}"): ${(tried.rejected[0]?.reason ?? "it could not be done").replace(/\s+/g, " ").slice(0, 200)}.`;
    }
    world = {
      ...world,
      genericEntities: [...world.genericEntities, GenericEntitySchema.parse({
        id: safeLocalId(`decree_${procedure.id}`).slice(0, 100), kind: "decree", label: markerOfDecree(procedure.id), ownerRef: { kind: "polity", id: polityId },
        attributes: { procedureId: procedure.id, atStep: input.toDay, done, what: decree.kind }, createdAtStep: input.toDay,
      })],
    };
    facts.push({
      localId: safeLocalId(`decree_${procedure.id}`).slice(0, 60), kind: done ? "decree_carried_out" : "decree_not_carried_out", visibility: "public", discoveryState: "public", knowableInDays: 0, significance: done ? 45 : 30,
      summary: line.slice(0, 400),
      affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: polityId }, { kind: "character", id: carrierId }],
    });
  }
  return { world, facts };
}
