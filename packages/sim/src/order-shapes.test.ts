import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * The shapes of order players write -- a rally of a people under a banner, a march through a friendly country with gold for its
 * passage, a battle plan with a formation, a journey to a foreign court for a wife, a raid, a candidacy, scouts and guides hired, a
 * trap and a feigned retreat, a conditional offer of terms, a siege with proclamations, a request to the Senate -- each as the acts
 * that carry it out. The engine must let each of them through: nothing here is refused for want of a detail no player would give.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const ACTOR = "gaius-genucius";

const context = (extra: Partial<ApplyContext> = {}): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: ACTOR }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory("shapes"), gameId: "game-shapes", playerCharacterId: ACTOR, ...extra,
});
const carry = (deltas: readonly unknown[], world: WorldState = opening()) => {
  const parsed = deltas.map((delta) => WorldDeltaSchema.parse(delta));
  return applyDeltas(world, parsed, context({ orderDeltas: new Set(parsed) }));
};
const provinceOf = (world: WorldState, polityId: string) => world.map.provinces.find((province) => province.controllerPolityId === polityId)!;
const army = (world: WorldState) => world.material.forces.find((force) => force.id === "roman-field-army")!;
const placedAt = (world: WorldState, provinceId: string): WorldState => ({ ...world, material: { ...world.material, forces: world.material.forces.map((force) => force.id === "roman-field-army" ? { ...force, locationId: provinceId } : force) } });
const why = (result: ReturnType<typeof carry>): string[] => result.rejected.map((entry) => `${entry.delta.op}: ${entry.reason}`);

describe("orders of these shapes are carried out by the engine", () => {
  it("rallies men under his banner: a new army, in his own name, in a country not his", () => {
    const world = opening();
    const there = provinceOf(world, "etruscan-cities");
    const result = carry([{ op: "force_create", localId: "banner", name: "The Banner of Gaius Genucius", polityId: "rome", commanderCharacterRef: ACTOR, controllerCharacterRef: ACTOR, locationId: there.id, authorizedStrength: 2000, reason: "He rallies volunteers under his banner." }], world);
    expect(why(result)).toEqual([]);
    expect(result.world.material.forces.some((force) => force.name === "The Banner of Gaius Genucius")).toBe(true);
  });

  it("marches an army through another country, asking leave by letter and paying gold for it", () => {
    const world = opening();
    const far = provinceOf(world, "samnites");
    const result = carry([
      { op: "force_modify", forceRef: "roman-field-army", locationId: far.id, reason: "March toward the Samnites." },
      { op: "diplomatic_message_send", localId: "leave", kind: "letter", fromPolityId: "rome", fromCharacterRef: ACTOR, toPolityId: "samnites", subject: "Passage for the army", terms: "We ask leave to pass through your country and will pay gold for it.", reason: "Ask for passage." },
      { op: "money_transfer", fromAccountRef: "gaius-purse", toAccountRef: null, amount: 100, reason: "Gold offered for the passage." },
    ], world);
    expect(why(result)).toEqual([]);
  });

  it("gives his army a battle plan and fights where the enemy stands", () => {
    const world = opening();
    const enemy = world.material.forces.find((force) => force.id === "campanian-legion")!;
    const result = carry([
      { op: "force_modify", forceRef: "roman-field-army", battlePlan: { factor: "deployment", magnitude: "meaningful", rationale: "Principes and triarii hold the centre, javelins on the flanks, horse hidden in the valleys until the signal.", restsOn: ["rough_ground"] }, reason: "Set the formation." },
      { op: "force_engage", forceRef: "roman-field-army", targetForceRef: "campanian-legion", posture: "offer_battle", reason: "Seek battle." },
    ], placedAt(world, enemy.locationId));
    expect(why(result)).toEqual([]);
  });

  it("sends a man on a journey to a foreign court to seek a wife, with a letter to carry", () => {
    const world = opening();
    const egypt = world.map.provinces.find((province) => /egypt|alexandr/i.test(`${province.controllerPolityId ?? ""} ${province.name}`));
    const result = carry([
      { op: "character_create", localId: "lucius", name: "Lucius Genucius", polityId: "rome", provinceId: army(world).locationId, age: 24, officeLabel: "a young Roman", officeAuthorises: [], traits: ["amiable"], standing: "the consul's nephew", wealth: 300, generatedBecause: "The consul's nephew.", reason: "The consul's nephew." },
      { op: "service_contract_open", localId: "journey", role: "envoy", label: "Envoy to the court of Alexandria", employerAccountRef: "gaius-purse", employeeRef: "local:lucius", advance: 100, termDays: 120, duties: "Travel to Alexandria and seek an Egyptian wife and the friendship of Ptolemy.", provinceId: egypt?.id ?? null, reason: "He goes to Alexandria." },
    ], world);
    expect(why(result)).toEqual([]);
  });

  it("raids the towns of an enemy with his horse and sends the loot home", () => {
    const world = opening();
    const target = provinceOf(world, "campanian-legion") ?? provinceOf(world, "rhegium-campanians");
    const result = carry([{ op: "force_raid", forceRef: "roman-field-army", provinceId: target.id, toAccountRef: "rome-treasury", reason: "Raid and pillage; the loot goes to Rome." }], placedAt(world, target.id));
    expect(why(result)).toEqual([]);
  });

  it("stands for office with the backing of his army and his friends", () => {
    const result = carry([{ op: "political_procedure_open", localId: "candidacy", type: "nomination", institutionRef: null, sponsorCharacterRef: ACTOR, subjectKind: "character", subjectRef: ACTOR, label: "Gaius Genucius stands for a further term as consul", resolutionMechanism: "vote", deadlineInDays: 30, reason: "He stands again." }]);
    expect(why(result)).toEqual([]);
  });

  it("hires local herders and farmers as guides", () => {
    const world = opening();
    const hills = provinceOf(world, "lucanians");
    const result = carry([
      { op: "character_create", localId: "herder", name: "A Lucanian herder", polityId: "lucanians", provinceId: hills.id, age: 40, officeLabel: "a herder", officeAuthorises: [], traits: ["watchful"], standing: "a local herder", wealth: 10, generatedBecause: "A local guide.", reason: "A local guide." },
      { op: "service_contract_open", localId: "guide", role: "agent", label: "Guide of the pass", employerAccountRef: "gaius-purse", employeeRef: "local:herder", advance: 20, termDays: 30, duties: "Draw maps of the hills and tell what he knows of the road.", provinceId: hills.id, reason: "Hire a guide." },
    ], world);
    expect(why(result)).toEqual([]);
  });

  it("sets a trap with a surprise plan", () => {
    const result = carry([{ op: "force_modify", forceRef: "roman-field-army", battlePlan: { factor: "surprise", magnitude: "meaningful", rationale: "A third waits in the forest; a false retreat draws the enemy onto it.", restsOn: ["rough_ground"] }, reason: "Prepare the ambush." }]);
    expect(why(result)).toEqual([]);
  });

  it("lays siege to a city, with a proclamation of clemency", () => {
    const world = opening();
    const target = world.map.provinces.find((province) => province.controllerPolityId === "rhegium-campanians")!;
    const settlement = target.settlements[0]!;
    const result = carry([
      { op: "siege_lay", localId: "siege", forceRef: "roman-field-army", settlementId: settlement.id, works: ["lines"], reason: "Surround the city." },
      { op: "generic_entity_create", localId: "proclamation", kind: "decree", label: "Proclamation of clemency to Rhegium", ownerRef: { kind: "character", id: ACTOR }, attributes: { text: "The city will be preserved if it yields." }, provinceId: target.id, reason: "He proclaims clemency." },
    ], placedAt(world, target.id));
    expect(why(result)).toEqual([]);
  });

  it("asks the Senate for legions and a fleet", () => {
    const world = opening();
    const senate = world.material.institutions.find((institution) => /senate/i.test(`${institution.id} ${institution.name}`));
    const result = carry([{ op: "political_procedure_open", localId: "motion", type: "vote", institutionRef: senate?.id ?? null, sponsorCharacterRef: ACTOR, subjectKind: "polity", subjectRef: "rome", label: "Legions and a fleet for the war in Africa", resolutionMechanism: "vote", deadlineInDays: 20, reason: "Ask the Senate." }], world);
    expect(why(result)).toEqual([]);
  });

  it("gives games for the people", () => {
    const world = opening();
    const result = carry([{ op: "public_benefaction", payerAccountRef: null, amount: 200, kind: "games", provinceId: army(world).locationId, reason: "Games for the people." }], world);
    expect(why(result)).toEqual([]);
  });
});

import { atWar } from "@chronica/shared";

describe("an attack is the war's beginning", () => {
  it("a raid on a power sworn to Rome opens the war, and is carried out", () => {
    const world = opening();
    const target = provinceOf(world, "samnites");
    const result = carry([{ op: "force_raid", forceRef: "roman-field-army", provinceId: target.id, reason: "Raid." }], placedAt(world, target.id));
    expect(why(result)).toEqual([]);
    expect(atWar(result.world.polityAgreements, "rome", "samnites")).toBe(true);
    expect(result.factProposals.some((fact) => fact.kind === "war_declared")).toBe(true);
  });

  it("a siege laid on a city not at war with Rome opens the war, and is laid", () => {
    const world = opening();
    const target = provinceOf(world, "samnites");
    const settlement = target.settlements[0]!;
    const result = carry([{ op: "siege_lay", localId: "siege", forceRef: "roman-field-army", settlementId: settlement.id, reason: "Besiege it." }], placedAt(world, target.id));
    expect(why(result)).toEqual([]);
    expect(atWar(result.world.polityAgreements, "rome", "samnites")).toBe(true);
  });

  it("a battle with an ally's army opens the war, and is fought", () => {
    const world = opening();
    const ally = world.material.forces.find((force) => force.polityId === "samnites" && force.id !== "roman-field-army");
    if (ally === undefined) return;
    const result = carry([{ op: "force_engage", forceRef: "roman-field-army", targetForceRef: ally.id, posture: "offer_battle", reason: "Attack." }], placedAt(world, ally.locationId));
    expect(why(result)).toEqual([]);
    expect(atWar(result.world.polityAgreements, "rome", "samnites")).toBe(true);
  });
});

describe("who may attack, and whose war it is", () => {
  const asActor = (actor: string, deltas: readonly unknown[], world: WorldState) => {
    const parsed = deltas.map((delta) => WorldDeltaSchema.parse(delta));
    return applyDeltas(world, parsed, context({ actorRef: { kind: "character", id: actor }, playerCharacterId: actor, orderDeltas: new Set(parsed) }));
  };

  it("a man with no troops of his own cannot send another's army to raid: nobody moves, and no war begins", () => {
    const world = opening();
    const target = provinceOf(world, "samnites");
    // A Roman who leads no army: any senator will do.
    const commanders = new Set(world.material.forces.flatMap((force) => [force.commanderCharacterId, force.controllerCharacterId]));
    const nobody = world.characters.find((character) => character.polityId === "rome" && character.alive && !commanders.has(character.id) && character.id !== ACTOR)!;
    const result = asActor(nobody.id, [{ op: "force_raid", forceRef: "roman-field-army", provinceId: target.id, reason: "Raid." }], placedAt(world, target.id));
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.kind).toBe("ignored");
    expect(atWar(result.world.polityAgreements, "rome", "samnites")).toBe(false);
  });

  it("the consul who commands the army may send it, and the war begins with the raid", () => {
    const world = opening();
    const target = provinceOf(world, "samnites");
    const result = asActor(ACTOR, [{ op: "force_raid", forceRef: "roman-field-army", provinceId: target.id, reason: "Raid." }], placedAt(world, target.id));
    expect(why(result)).toEqual([]);
    expect(atWar(result.world.polityAgreements, "rome", "samnites")).toBe(true);
  });

  it("a man's own band, paid from his own purse, raids on his own account: a quarrel of private men, not a war", () => {
    const world = opening();
    const target = provinceOf(world, "samnites");
    const raised = asActor(ACTOR, [
      { op: "obligation_upsert", localId: "pay", obligationRef: null, kind: "army_pay", label: "Pay of his own band", payerAccountRef: "gaius-purse", recipientAccountRef: null, amount: 100, cadenceDays: 30, reason: "He pays them himself." },
      { op: "force_create", localId: "band", name: "Gaius Genucius's own band", polityId: "rome", commanderCharacterRef: ACTOR, controllerCharacterRef: ACTOR, locationId: target.id, authorizedStrength: 100, payObligationRef: "local:pay", reason: "His own followers." },
    ], world);
    expect(raised.rejected.map((entry) => entry.reason)).toEqual([]);
    const band = raised.world.material.forces.find((force) => force.name === "Gaius Genucius's own band")!;
    const result = asActor(ACTOR, [{ op: "force_raid", forceRef: band.id, provinceId: target.id, reason: "His own men raid." }], raised.world);
    expect(why(result)).toEqual([]);
    expect(atWar(result.world.polityAgreements, "rome", "samnites")).toBe(false);
    expect(result.factProposals.some((fact) => fact.kind === "private_attack")).toBe(true);
  });
});

import { advanceWorldTo } from "@chronica/shared";

describe("what a private attack brings", () => {
  const raidWithOwnBand = () => {
    const world = opening();
    const target = provinceOf(world, "samnites");
    const raised = carry([
      { op: "obligation_upsert", localId: "pay", obligationRef: null, kind: "army_pay", label: "Pay of his own band", payerAccountRef: "gaius-purse", recipientAccountRef: null, amount: 100, cadenceDays: 30, reason: "He pays them himself." },
      { op: "force_create", localId: "band", name: "Gaius Genucius's own band", polityId: "rome", commanderCharacterRef: ACTOR, controllerCharacterRef: ACTOR, locationId: target.id, authorizedStrength: 100, payObligationRef: "local:pay", reason: "His own followers." },
    ], world);
    const band = raised.world.material.forces.find((force) => force.name === "Gaius Genucius's own band")!;
    return carry([{ op: "force_raid", forceRef: band.id, provinceId: target.id, reason: "His own men raid." }], raised.world);
  };

  it("is a demand for redress from the injured power, which makes war if it is refused", () => {
    const raided = raidWithOwnBand();
    const demand = raided.world.diplomacy.find((message) => message.kind === "ultimatum" && message.fromPolityId === "samnites" && message.toPolityId === "rome");
    expect(demand).toBeDefined();
    expect(demand!.onRefusal).toBe("war");
    expect(demand!.status).toBe("awaiting_reply");
    expect(atWar(raided.world.polityAgreements, "rome", "samnites")).toBe(false);
    // Refused by Rome, the deed is held to be Rome's own, and the war follows.
    const arrived = advanceWorldTo(raided.world, { day: demand!.deliveredOnDay ?? 1, minute: 540 });
    const answerer = demand!.toCharacterId ?? ACTOR;
    const refused = applyDeltas(arrived, [WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: demand!.id, answer: "refused", answerText: "Rome will not give him up.", reason: "Refused." })],
      context({ actorRef: { kind: "character", id: answerer }, playerCharacterId: answerer }));
    expect(refused.rejected.map((entry) => entry.reason)).toEqual([]);
    expect(atWar(refused.world.polityAgreements, "rome", "samnites")).toBe(true);
  });

  it("makes no war when Rome makes the damage good", () => {
    const raided = raidWithOwnBand();
    const demand = raided.world.diplomacy.find((message) => message.kind === "ultimatum" && message.fromPolityId === "samnites")!;
    const arrived = advanceWorldTo(raided.world, { day: demand.deliveredOnDay ?? 1, minute: 540 });
    const answerer = demand.toCharacterId ?? ACTOR;
    const accepted = applyDeltas(arrived, [WorldDeltaSchema.parse({ op: "diplomatic_message_answer", messageRef: demand.id, answer: "accepted", answerText: "Rome will make good the damage.", reason: "Accepted." })],
      context({ actorRef: { kind: "character", id: answerer }, playerCharacterId: answerer }));
    expect(accepted.rejected.map((entry) => entry.reason)).toEqual([]);
    expect(atWar(accepted.world.polityAgreements, "rome", "samnites")).toBe(false);
  });
});
