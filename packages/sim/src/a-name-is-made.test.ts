import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  CharacterKnowledgebaseSchema,
  OrderPartSchema,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  aptitude,
  electableFor,
  labelNamesOffice,
  materializePlayerCharacter,
  readGlossary,
  readTheMirror,
  resolveEligibility,
  seatCharacterInOffice,
  standingInWords,
  type BattleResult,
  type OfficeNote,
  type PoliticalProcedure,
  type VoteRecord,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { lineOf } from "./order-outcomes";
import { createIdFactory } from "./ports";
import { recordTheFight } from "./ranks";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { BATTLE_WON_BPS, BATTLE_WON_WOUNDED_BPS, CITY_TAKEN_BPS, OFFICE_MONTH_BPS, ROUTED_BPS, creditTheSpeech, honourSieges, honourTheSitting } from "./standing-deeds";
import { runDeterministicTick } from "./tick";
import { sentenceByOutcome } from "./trials";

/**
 * A name is made (L1, L2, L3, L7, E16, E17 of the 2026-10-02 play-test).
 *
 * The legionary of the play-test began at 2,000 standing; the lowest office
 * asks 3,000; nothing he could do in the field, in a siege or in the forum
 * moved the number; he could not see it, nor what each office asked; his
 * candidacy for the military tribunate matched no office and hung "waiting on
 * a vote"; and the sixteen tribunes were elected from among the consulars.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = definition.government;
const offices = government.offices;
const PLAYER = "declared-vettius";
const ARMY = "roman-field-army";
const opening = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

function declare(role: string, socioEconomicClass: string, ageYearsAtOpening: number, startingMoney = 300, world = opening()): WorldState {
  const knowledgebase = CharacterKnowledgebaseSchema.parse({
    version: 1, characterId: PLAYER, gameId: "game-name", canonicalName: "Titus Vettius", nickname: null, birthYearApprox: -294, deathYearApprox: null,
    origin: "invented", period: "270 BCE", locationProvinceId: PUNIC_IDS.rome, culture: "Roman", faith: null,
    biography: "A farmer's son of the Sabine hills, levied for the year and eager to be noticed.", notableEvents: [],
    role, authority: [], socioEconomicClass, startingMoney, ageYearsAtOpening,
    skills: { martial: 55, intrigue: 20, learning: 20, piety: 40, stewardship: 20, diplomacy: 60, body: 60, subSkills: {} },
    skillRationale: {},
    relations: [
      { name: "Vettia", relationship: "mother", historical: false, notes: "Keeps the farm.", kind: "person", category: "family", familyRole: "parent" },
      ...[1, 2, 3].map((n) => ({ name: `Comrade ${n}`, relationship: "tent-mate", historical: false, notes: "Serves beside him.", kind: "person", category: "other", familyRole: null })),
    ],
    confirmedByPlayer: true, confirmationDraft: null,
  });
  return materializePlayerCharacter(world, PLAYER, knowledgebase, government);
}
const legionary = (startingMoney = 300) => declare("Legionary in the consul's army", "Plebeian", 24, startingMoney);

const me = (world: WorldState) => world.characters.find((character) => character.id === PLAYER)!;
const withStanding = (world: WorldState, id: string, prestigeBps: number): WorldState => ({
  ...world, characters: world.characters.map((character) => (character.id === id ? { ...character, prestigeBps } : character)),
});
const act = (world: WorldState, actor: string, raw: Record<string, unknown>, day = world.elapsedStep) => {
  const delta = WorldDeltaSchema.parse(raw);
  return applyDeltas(world, [delta], {
    now: { day, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, successionRules: government.successionRules,
    warfare: definition.warfare, ids: createIdFactory(`name-${actor}-${raw.op as string}-${day}`), gameId: "game-name", playerCharacterId: PLAYER, orderDeltas: new Set([delta]),
  });
};
const tick = (world: WorldState, toDay: number) => {
  const advanced = { ...world, elapsedStep: toDay, instant: { day: toDay, minute: 0 } };
  const result = runDeterministicTick({ world: advanced, toDay, ids: createIdFactory(`name-tick-${toDay}`), warfare: definition.warfare, government, playerCharacterId: PLAYER });
  expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  return result;
};
const stand = (world: WorldState, label: string) => act(world, PLAYER, {
  op: "political_procedure_open", localId: "stand", type: "nomination", institutionRef: null, sponsorCharacterRef: PLAYER,
  subjectKind: "character", subjectRef: PLAYER, label, resolutionMechanism: "sponsor_discretion", deadlineInDays: null, visibility: "public", reason: "He stands.",
});
const candidaciesOf = (world: WorldState): PoliticalProcedure[] =>
  world.material.politicalProcedures.filter((procedure) => procedure.type === "nomination" && procedure.subjectId === PLAYER);

/** A battle, as `recordTheFight` reads one: who fought, who attacked, who won, and who got away in order. */
const aBattle = (outcome: BattleResult["outcome"], attackerForceIds: string[], participantIds: string[], orderlyRetreat: string[] = []): BattleResult => ({
  battleId: "battle-at-the-river", participantIds, attackerForceIds, outcome, phases: [], acceptedTactics: [], rejectedTactics: [], draws: [],
  casualties: [], captures: [], forceChanges: [], commanderChanges: [], retreats: orderlyRetreat.map((forceId) => ({ forceId, toProvinceId: null, orderly: true })),
  siegeAndControlChanges: [], facts: [],
});

const ROMAN_GATES = [...new Set(opening().material.eligibilityRequirements.filter((requirement) => requirement.kind === "min_prestige").map((requirement) => requirement.params.minPrestigeBps as number))];

describe("L1: a man sees his standing, and what each office asks", () => {
  it("changes the words for standing at every gate an office has", () => {
    expect(ROMAN_GATES.length).toBeGreaterThanOrEqual(5);
    for (const gate of ROMAN_GATES) expect(standingInWords(gate), `${gate}`).not.toBe(standingInWords(gate - 1));
  });

  it("says by how much a man falls short, in the refusal itself", () => {
    const world = legionary();
    const quaestor = offices.find((office) => office.id === "roman-quaestor")!;
    expect(me(world).prestigeBps).toBe(2_000);
    expect(resolveEligibility(world, PLAYER, quaestor.eligibilityRequirementIds, quaestor.id).failedReasons.join(" ")).toContain("standing 2,000 of 3,000 required");
  });

  it("says on the office's note why he may not stand yet", () => {
    const world = withStanding(legionary(), PLAYER, 2_900);
    const notes = readGlossary({ world, characterId: PLAYER, offices, successionRules: government.successionRules, clock: definition.clock });
    const quaestorship = Object.values(notes).find((note): note is OfficeNote => note?.kind === "office" && note.name === "Roman quaestor")!;
    expect(quaestorship.next!.youLabel).toBe("Not yet: you stand at 2,900; the office asks 3,000.");
  });

  it("shows the number and the next gates on his sheet, whatever he is known for", () => {
    const world = legionary();
    const traited = { ...world, characters: world.characters.map((character) => (character.id === PLAYER ? { ...character, traits: ["brave"] } : character)) };
    const mirror = readTheMirror({ world: traited, characterId: PLAYER, government })!;
    expect(mirror.standingFigure).toBe("2,000 of 10,000");
    expect(mirror.standingBps).toBe(2_000);
    const quaestor = mirror.gates.find((gate) => gate.office === "Roman quaestor")!;
    expect(quaestor).toMatchObject({ needed: "3,000", met: false, short: "1,000 short" });
    expect(mirror.gates.map((gate) => gate.office)).toContain("Tribune of the plebs");
    // A patrician is not shown the gates of offices his birth bars him from.
    const patrician = declare("Legionary in the consul's army", "Patrician", 24);
    const his = readTheMirror({ world: { ...patrician, characters: patrician.characters.map((character) => (character.id === PLAYER ? { ...character, ordo: "patrician" as const } : character)) }, characterId: PLAYER, government })!;
    expect(his.gates.map((gate) => gate.office)).not.toContain("Tribune of the plebs");
  });

  it("tells the orchestrator the man's standing and the gates either side of it", () => {
    const world = legionary();
    const slice = renderWorldSlice(buildWorldSlice({
      world, clock: definition.clock, offices, actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText: "x", facts: [], dueEvents: [], pendingEvents: [],
    }));
    expect(slice).toMatch(/STANDING: 2,000 of 10,000 \(of no particular standing\); next: [^;]*Roman quaestor[^;]* at 3,000 \(1,000 short\)/);
  });
});

describe("L2: standing is earned by deeds, the same way every time", () => {
  it("speaks of the men of a winning army in the camp, the wounded more, and of a routed army's men in the city", () => {
    const world = legionary();
    const won = recordTheFight(world, aBattle("attacker_victory", [ARMY], [ARMY, "carthaginian-sicily-army"]), [
      { characterId: PLAYER, forceId: ARMY, outcome: "unharmed" },
    ], PLAYER);
    expect(me(won.world).prestigeBps).toBe(2_000 + BATTLE_WON_BPS);
    expect(won.facts.some((fact) => fact.kind === "standing_changed" && /name is known in .*camp after the victory/.test(fact.summary))).toBe(true);
    const bled = recordTheFight(world, aBattle("attacker_victory", [ARMY], [ARMY, "carthaginian-sicily-army"]), [{ characterId: PLAYER, forceId: ARMY, outcome: "wounded" }], PLAYER);
    expect(me(bled.world).prestigeBps).toBeGreaterThanOrEqual(2_000 + BATTLE_WON_WOUNDED_BPS);
    const routed = recordTheFight(world, aBattle("defender_victory", [ARMY], [ARMY, "carthaginian-sicily-army"]), [{ characterId: PLAYER, forceId: ARMY, outcome: "unharmed" }], PLAYER);
    expect(me(routed.world).prestigeBps).toBeLessThanOrEqual(2_000 + ROUTED_BPS);
    const withdrew = recordTheFight(world, aBattle("defender_victory", [ARMY], [ARMY, "carthaginian-sicily-army"], [ARMY]), [{ characterId: PLAYER, forceId: ARMY, outcome: "unharmed" }], PLAYER);
    expect(me(withdrew.world).prestigeBps).toBeLessThanOrEqual(2_000);
    expect(me(withdrew.world).prestigeBps).toBeGreaterThan(2_000 + ROUTED_BPS - 1);
  });

  it("lets a soldier choose glory for himself, as his own business", () => {
    const world = legionary();
    const result = act(world, PLAYER, { op: "force_membership_set", characterRef: PLAYER, forceRef: ARMY, change: "conduct", conduct: "glory", reason: "He means to be seen." });
    expect(result.rejected).toHaveLength(0);
    expect(result.breaches).toHaveLength(0);
    expect(me(result.world).service?.conduct).toBe("glory");
  });

  it("honours the men who took a city, crowns one man first over the wall when it was stormed, and the men who held one until it was relieved", () => {
    const world = legionary();
    const where = world.material.forces.find((force) => force.id === ARMY)!.locationId;
    const taken = honourSieges(world, [{ kind: "taken", siegeId: "siege-x", place: "Rhegium", provinceId: where, polityId: "rome", stormed: false }], 10, PLAYER);
    expect(me(taken.world).prestigeBps).toBe(2_000 + CITY_TAKEN_BPS);
    expect(taken.facts.some((fact) => fact.summary === "Titus Vettius's name is known in the camp after the taking of Rhegium.")).toBe(true);
    // Stormed, with a crowd of bold men in the ranks: exactly one is first over the wall.
    const crowded: WorldState = {
      ...world,
      characters: [...world.characters, ...Array.from({ length: 30 }, (_, index) => ({ ...me(world), id: `bold-${index}`, name: `Bold ${index}`, personalAccountId: me(world).personalAccountId, service: { ...me(world).service!, conduct: "glory" as const } }))],
      material: { ...world.material, forces: world.material.forces.map((force) => (force.id === ARMY ? { ...force, memberCharacterIds: [...force.memberCharacterIds, ...Array.from({ length: 30 }, (_, index) => `bold-${index}`)] } : force)) },
    };
    const stormed = honourSieges(crowded, [{ kind: "taken", siegeId: "siege-y", place: "Rhegium", provinceId: where, polityId: "rome", stormed: true }], 10, PLAYER);
    const first = stormed.facts.filter((fact) => fact.kind === "soldier_deed" && /first man over the wall of Rhegium/.test(fact.summary));
    expect(first).toHaveLength(1);
    const crowned = stormed.world.characters.filter((character) => (character.service?.decorations ?? []).some((decoration) => /mural/i.test(decoration.label)));
    expect(crowned).toHaveLength(1);
    expect(crowned[0]!.prestigeBps).toBe(2_000 + CITY_TAKEN_BPS + 200);
    const relieved = honourSieges(world, [{ kind: "relieved", siegeId: "siege-z", place: "Messana", forceIds: [ARMY] }], 10, PLAYER);
    expect(me(relieved.world).prestigeBps).toBe(2_150);
  });

  it("adds to a magistrate's name for every month he sits, counted once", () => {
    const world = seatCharacterInOffice(legionary(), PLAYER, { office: offices.find((office) => office.id === "roman-quaestor")!, vacantSeatId: null }, 0, 365);
    const three = honourTheSitting(world, offices, 95, PLAYER);
    expect(me(three.world).prestigeBps).toBe(2_000 + 3 * OFFICE_MONTH_BPS);
    expect(three.facts.some((fact) => /3 months as Roman quaestor add to Titus Vettius's name/.test(fact.summary))).toBe(true);
    const again = honourTheSitting(three.world, offices, 100, PLAYER);
    expect(me(again.world).prestigeBps).toBe(2_000 + 3 * OFFICE_MONTH_BPS);
    expect(me(honourTheSitting(again.world, offices, 120, PLAYER).world).prestigeBps).toBe(2_000 + 4 * OFFICE_MONTH_BPS);
  });

  it("adds less for a month in office the higher a man already stands, and nothing at the top", () => {
    const at = (bps: number): WorldState => {
      const world = seatCharacterInOffice(legionary(), PLAYER, { office: offices.find((office) => office.id === "roman-quaestor")!, vacantSeatId: null }, 0, 365);
      return { ...world, characters: world.characters.map((character) => (character.id === PLAYER ? { ...character, prestigeBps: bps } : character)) };
    };
    // Full measure up to 4,000; half at 7,000; none at 10,000. A flat hundred
    // walked every magistrate of a long game up to the ceiling.
    expect(me(honourTheSitting(at(4_000), offices, 35, PLAYER).world).prestigeBps).toBe(4_000 + OFFICE_MONTH_BPS);
    expect(me(honourTheSitting(at(7_000), offices, 35, PLAYER).world).prestigeBps).toBe(7_000 + OFFICE_MONTH_BPS / 2);
    expect(me(honourTheSitting(at(10_000), offices, 35, PLAYER).world).prestigeBps).toBe(10_000);
  });

  it("credits a speech on the side that carried, by how well he speaks, and costs one on a side routed", () => {
    const world = legionary();
    const question = { id: "procedure-q", label: "Send the legions to Sicily" } as PoliticalProcedure;
    const spoke = (position: "support" | "oppose"): WorldState => ({
      ...world,
      material: { ...world.material, supportPositions: [...world.material.supportPositions, { id: "support-x", procedureId: question.id, supporterKind: "character", supporterId: PLAYER, position, influenceWeight: 10, visibility: "public", reasons: [], provenanceEventIds: [], changedAtStep: 0 }] },
    });
    const carried = { outcome: "passed", yesWeight: 200, noWeight: 60 } as VoteRecord;
    const won = creditTheSpeech(spoke("support"), question, carried, PLAYER);
    // From 50 for the plainest speaker to 150 for the best: his rhetoric, or his diplomacy, whichever is the better.
    const gift = Math.max(aptitude(me(world), "rhetoric"), me(world).skills.diplomacy);
    expect(me(won.world).prestigeBps).toBe(2_000 + 50 + Math.round(gift));
    expect(won.facts[0]!.summary).toMatch(/spoke for "Send the legions to Sicily" and the house went his way/);
    expect(me(creditTheSpeech(spoke("oppose"), question, carried, PLAYER).world).prestigeBps).toBe(1_950);
    expect(me(creditTheSpeech(spoke("oppose"), question, { outcome: "passed", yesWeight: 100, noWeight: 80 } as VoteRecord, PLAYER).world).prestigeBps).toBe(2_000);
  });

  it("costs a convicted man his standing: a fine, and more for exile", () => {
    const world = withStanding(legionary(), PLAYER, 5_000);
    const trial = (sentence: "fine" | "exile") => ({
      id: "procedure-trial", type: "denunciation", subjectKind: "character", subjectId: PLAYER, outcome: "passed", sentence, sponsorCharacterId: "gaius-genucius",
      institutionId: null, label: "The trial of Titus Vettius",
    } as unknown as PoliticalProcedure);
    expect(me(sentenceByOutcome(world, trial("fine"), 10)).prestigeBps).toBe(4_200);
    expect(me(sentenceByOutcome(world, trial("exile"), 10)).prestigeBps).toBe(3_500);
  });
});

describe("L7: games, feasts and doles", () => {
  const feast = { op: "public_benefaction", payerAccountRef: null, amount: 200, kind: "feast", provinceId: null, reason: "A feast and games for the neighbourhood" };

  it("spends 200 of his own drachmae on a feast and games, as his own business, and is the better spoken of", () => {
    const world = legionary(300);
    const purse = me(world).personalAccountId;
    const balance = (state: WorldState) => state.material.accounts.find((account) => account.id === purse)!.balance;
    const result = act(world, PLAYER, feast);
    expect(result.rejected).toHaveLength(0);
    expect(result.breaches).toHaveLength(0);
    expect(balance(result.world)).toBe(balance(world) - 200);
    const gain = me(result.world).prestigeBps - 2_000;
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThanOrEqual(800);
    expect(result.factProposals.some((fact) => fact.kind === "public_benefaction" && /Titus Vettius gave the people of .* a feast at his own cost, 200 spent/.test(fact.summary))).toBe(true);
    // The same again within the year is worth less.
    const again = act(result.world, PLAYER, feast);
    expect(me(again.world).prestigeBps - me(result.world).prestigeBps).toBeLessThan(gain);
  });

  it("lets an aedile hold the Roman Games out of the treasury within his allowance, without the Senate, and no further", () => {
    const world = declare("Roman aedile", "Patrician", 34);
    expect(world.material.officeSeats.some((seat) => seat.officeId === "roman-aedile" && seat.holderCharacterId === PLAYER && seat.status === "held")).toBe(true);
    const before = me(world).prestigeBps;
    const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!;
    const games = { op: "public_benefaction", payerAccountRef: treasury.id, amount: 1_000_000, kind: "games", provinceId: null, reason: "The Roman Games" };
    const held = act(world, PLAYER, games);
    expect(held.rejected).toHaveLength(0);
    expect(held.breaches).toHaveLength(0);
    const spent = treasury.balance - held.world.material.accounts.find((account) => account.id === treasury.id)!.balance;
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThan(1_000_000);
    expect(me(held.world).prestigeBps).toBeGreaterThan(before);
    // The allowance is spent: more wants the Senate's vote.
    const more = act(held.world, PLAYER, games);
    expect(more.rejected[0]?.reason).toMatch(/allowance for games this term is spent/);
  });
});

describe("E16, L3: a man learns why he was or was not elected", { timeout: 120_000 }, () => {
  it("reads a holding as its office: the tribunate, the aedileship, the consulship", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["stands for the military tribunate", "Military tribune"], ["seeks the tribunate of the plebs", "Tribune of the plebs"],
      ["stands for the aedileship", "Roman aedile"], ["seeks the consulship", "Roman consul"], ["stands for the praetorship", "Roman praetor"],
      ["stands for the quaestorship", "Roman quaestor"], ["seeks the censorship", "Roman censor"],
    ];
    for (const [said, office] of cases) expect(labelNamesOffice(said, office), said).toBe(true);
  });

  it("refuses a name at the declaration, with the numbers, and the order says so", () => {
    const opened = stand(legionary(), "Titus Vettius stands for the military tribunate");
    const [candidacy] = candidaciesOf(opened.world);
    expect(candidacy!.outcome).toBe("failed");
    expect(candidacy!.outcomeReason).toBe("Not admitted: Titus Vettius stands too low: standing 2,000 of 3,000 required.");
    expect(opened.factProposals.some((fact) => fact.kind === "candidacy_refused" && /standing 2,000 of 3,000 required/.test(fact.summary))).toBe(true);
    const part = OrderPartSchema.parse({ said: "Stand for military tribune", workRefs: [{ kind: "procedure", id: candidacy!.id }] });
    expect(lineOf(opened.world, part, PLAYER)).toMatch(/refused: Not admitted: Titus Vettius stands too low: standing 2,000 of 3,000 required/);
  });

  it("names on polling day a man the presiding magistrate refused", () => {
    // Put forward before he fell short -- he was convicted since -- and refused on the day.
    const ready = withStanding(legionary(), PLAYER, 3_200);
    const opened = stand(ready, "Titus Vettius stands for the military tribunate").world;
    const fallen = withStanding(opened, PLAYER, 2_500);
    const called = tick(fallen, 365).world;
    const counted = tick(called, 386);
    const [candidacy] = candidaciesOf(counted.world);
    expect(candidacy!.outcome).toBe("failed");
    expect(candidacy!.outcomeReason).toMatch(/^Not admitted: Titus Vettius stands too low: standing 2,500 of 3,000 required/);
    expect(counted.factProposals.some((fact) => fact.kind === "candidacy_refused" && /The presiding magistrate refused Titus Vettius's name for Military tribune/.test(fact.summary))).toBe(true);
  });

  it("settles his candidacy as failed when the college's places all went to men of no note", () => {
    // Nobody else in Rome the world names: the places go to the implied men.
    const alone = legionary();
    const world = withStanding({ ...alone, characters: alone.characters.filter((character) => character.polityId !== "rome" || character.id === PLAYER) }, PLAYER, 3_200);
    const opened = stand(world, "Titus Vettius stands for the military tribunate").world;
    const counted = tick(tick(withStanding(opened, PLAYER, 2_500), 365).world, 386).world;
    const election = counted.material.politicalProcedures.find((procedure) => procedure.label.startsWith("Election of Military tribune"))!;
    expect(election.outcome).toBe("passed");
    expect(election.outcomeReason).toMatch(/men of no particular note/);
    const [candidacy] = candidaciesOf(counted);
    // It used to be settled "passed" with the election, and he read that he had won.
    expect(candidacy!.outcome).toBe("failed");
    expect(candidacy!.outcomeReason).toMatch(/^Not admitted: /);
  });

  it("does not leave a candidacy waiting on a vote once its election was settled some other way", () => {
    const opened = stand(withStanding(legionary(), PLAYER, 3_200), "Titus Vettius stands for the military tribunate").world;
    const called = tick(opened, 365).world;
    // The model resolves the election itself, without counting him.
    const resolved: WorldState = {
      ...called,
      material: { ...called.material, politicalProcedures: called.material.politicalProcedures.map((procedure) => (procedure.label.startsWith("Election of Military tribune")
        ? { ...procedure, stage: "resolved" as const, outcome: "passed" as const, outcomeReason: "Settled.", resolvedAtStep: 370 }
        : procedure)) },
    };
    const [candidacy] = candidaciesOf(tick(resolved, 371).world);
    expect(candidacy!.outcome).toBe("withdrawn");
    expect(candidacy!.outcomeReason).toMatch(/settled without his name being counted/);
  });

  it("tells a beaten man where he came, costs him standing, and leaves him a grudge against the man who won", () => {
    const world = withStanding(declare("Senator of Rome", "Plebeian", 40), PLAYER, 5_100);
    const mine = stand(world, "Titus Vettius stands for the praetorship").world;
    expect(candidaciesOf(mine)[0]!.outcome).toBeNull();
    // A man of more standing stands against him.
    const praetorship = offices.find((office) => office.id === "roman-praetor")!;
    const rival = electableFor(mine, praetorship, new Map(offices.map((office) => [office.id, office])), 365, PLAYER)[0]!;
    expect(rival.prestigeBps).toBeGreaterThan(5_100);
    const opened = act(mine, rival.id, {
      op: "political_procedure_open", localId: "rival", type: "nomination", institutionRef: null, sponsorCharacterRef: rival.id,
      subjectKind: "character", subjectRef: rival.id, label: `${rival.name} stands for the praetorship`, resolutionMechanism: "sponsor_discretion", deadlineInDays: null, visibility: "public", reason: "He stands.",
    }).world;
    const counted = tick(tick(opened, 365).world, 386);
    const [candidacy] = candidaciesOf(counted.world);
    expect(candidacy!.outcome).toBe("failed");
    expect(candidacy!.outcomeReason).toMatch(/^Beaten: placed 2nd of 2\. The Centuriate Assembly elected /);
    expect(me(counted.world).prestigeBps).toBeLessThan(5_100);
    const winner = counted.world.material.officeSeats.find((seat) => seat.officeId === "roman-praetor" && seat.status === "held")!.holderCharacterId!;
    expect(me(counted.world).relations.find((relation) => relation.subjectCharacterId === winner)?.causes.some((cause) => /took the place as Roman praetor I stood for/.test(cause.label))).toBe(true);
    expect(counted.factProposals.some((fact) => fact.kind === "candidacy_lost" && /^Titus Vettius stood for Roman praetor: Beaten: placed 2nd of 2/.test(fact.summary))).toBe(true);
  });
});

describe("E17: the military tribunes are young men who have served", { timeout: 180_000 }, () => {
  it("elects no former consul, praetor, aedile or censor to the college of 270", () => {
    let world = opening();
    // Due a year after the opening, called when the canvass has run, counted twenty days on.
    for (const day of [30, 365, 386, 420, 445]) world = tick(world, day).world;
    const tribunes = world.material.officeSeats.filter((seat) => seat.officeId === "roman-military-tribune" && seat.status === "held").map((seat) => seat.holderCharacterId!);
    expect(tribunes.length).toBeGreaterThan(0);
    const high = new Set(["roman-consul", "roman-praetor", "roman-aedile", "roman-plebeian-aedile", "roman-censor", "roman-dictator"]);
    for (const id of tribunes) {
      const man = world.characters.find((character) => character.id === id)!;
      expect(man.officesHeld.filter((tenure) => high.has(tenure.officeId)), man.name).toEqual([]);
    }
  });
});

describe("a soldier's road: the legionary who fights, storms and feasts his way to the tribunate", { timeout: 120_000 }, () => {
  it("reaches a standing he can see, stands, and is told on polling day how it went", () => {
    let world = legionary(300);
    // A battle won.
    world = recordTheFight(world, aBattle("attacker_victory", [ARMY], [ARMY, "carthaginian-sicily-army"]), [{ characterId: PLAYER, forceId: ARMY, outcome: "wounded" }], PLAYER).world;
    // A city stormed.
    const where = world.material.forces.find((force) => force.id === ARMY)!.locationId;
    world = honourSieges(world, [{ kind: "taken", siegeId: "siege-rhegium", place: "Rhegium", provinceId: where, polityId: "rome", stormed: true }], 30, PLAYER).world;
    // A feast for the neighbourhood, out of his own purse.
    world = act(world, PLAYER, { op: "public_benefaction", payerAccountRef: null, amount: 200, kind: "feast", provinceId: null, reason: "A feast for the tribe" }).world;
    const standing = me(world).prestigeBps;
    expect(standing).toBeGreaterThan(2_200);
    const mirror = readTheMirror({ world, characterId: PLAYER, government })!;
    expect(mirror.standingBps).toBe(standing);
    expect(mirror.standingFigure).toMatch(/ of 10,000$/);

    // He stands for the military tribunate, and is told on polling day either way.
    const opened = stand(world, "Titus Vettius stands for the military tribunate");
    const counted = tick(tick(opened.world, 365).world, 386);
    const [candidacy] = candidaciesOf(counted.world);
    expect(candidacy!.outcome).not.toBeNull();
    expect(candidacy!.outcomeReason).toMatch(/^(Elected: placed|Beaten: placed|Not admitted: )/);
  });

  it("is elected to the college once his deeds have brought him to the gate", () => {
    const world = withStanding(legionary(), PLAYER, 3_300);
    const opened = stand(world, "Titus Vettius stands for the military tribunate");
    expect(candidaciesOf(opened.world)[0]!.outcome).toBeNull();
    const counted = tick(tick(opened.world, 365).world, 386);
    const [candidacy] = candidaciesOf(counted.world);
    expect(candidacy!.outcomeReason).toMatch(/^Elected: placed \d+(st|nd|rd|th) of \d+\./);
    expect(counted.world.material.officeSeats.some((seat) => seat.officeId === "roman-military-tribune" && seat.holderCharacterId === PLAYER && seat.status === "held")).toBe(true);
    expect(counted.factProposals.some((fact) => fact.kind === "candidacy_won" && fact.summary.startsWith("Titus Vettius stood for Military tribune: Elected"))).toBe(true);
  });
});
