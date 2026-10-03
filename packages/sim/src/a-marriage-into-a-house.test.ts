import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, familyLinksOf, marriageBar, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { bearChild, birthChance } from "./births";
import { answerMarriageOffers } from "./marriage";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * Play-test L10: a man could not marry into the nobility.
 *
 * The scenario had no wives and no daughters -- its only women were six
 * Vestals -- a marriage tie had no guards, and an offer of marriage was a
 * letter that married nobody. Now the great houses have their families, a
 * marriage is barred where it should be, and an offer is answered by rule:
 * on yes the two are married, a dowry is paid, and an heir can be born.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const named = (world: WorldState, name: string) => world.characters.find((character) => character.name === name)!;
const balance = (world: WorldState, id: string): number => world.material.accounts.find((account) => account.id === id)!.balance;
const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: characterId }, offices: definition.government.offices, warfare: definition.warfare,
  ids: createIdFactory(`wed-${characterId}`), gameId: "game-1",
});

/** The suitor asks the father for his daughter's hand, in a letter. */
function proposes(world: WorldState, suitorId: string, fatherId: string, daughter: string): WorldState {
  const sent = applyDeltas(world, [WorldDeltaSchema.parse({
    op: "diplomatic_message_send", localId: "the_suit", kind: "marriage_offer", fromPolityId: "rome", fromCharacterRef: suitorId, toPolityId: "rome", toCharacterRef: fatherId,
    subject: `The hand of ${daughter}`, terms: `I ask for ${daughter} in marriage.`, reason: "He would marry into the house.",
  })], as(suitorId));
  expect(sent.rejected).toEqual([]);
  return sent.world;
}

/** What the father thinks of the suitor, set outright. */
function thinks(world: WorldState, of: string, about: string, score: number): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id !== of ? character : {
      ...character,
      relations: [...character.relations.filter((relation) => relation.subjectCharacterId !== about), { subjectCharacterId: about, causes: [{ id: `seeded-${score}`, label: "Long acquaintance.", score, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }],
    })),
  };
}

describe("the great houses have families", () => {
  it("seeds wives, daughters and sons for the principal houses, with ties, and keeps the Vestals out of them", () => {
    const world = opening();
    const blasio = named(world, "Gnaeus Cornelius Blasio");
    const kin = familyLinksOf(world, blasio.id);
    expect(kin.some((view) => view.kind === "spouse_or_partner")).toBe(true);
    expect(kin.filter((view) => view.kind === "parent").length).toBeGreaterThanOrEqual(2);
    expect(world.characters.filter((character) => character.gender === "female").length).toBeGreaterThan(20);
    // Philistis, Leptines' daughter, is Hieron's queen.
    const philistis = named(world, "Philistis");
    expect(familyLinksOf(world, philistis.id).map((view) => view.kind).sort()).toEqual(["child", "spouse_or_partner"]);
    // Every invented one says so.
    expect(named(world, "Cornelia Blasionis").creationReason).toMatch(/^Invented/);
    expect(named(world, "Quintus Fabius Pictor").creationReason).toMatch(/^Historical/);
  });
});

describe("a marriage is barred where it should be", () => {
  it("refuses a Vestal, a child, a second wife, kin, and two men", () => {
    const world = opening();
    const ogulnius = "quintus-ogulnius";
    const vestal = world.material.officeSeats.find((seat) => seat.officeId === "roman-vestal" && seat.holderCharacterId !== null)!.holderCharacterId!;
    expect(marriageBar(world, ogulnius, vestal)).toMatch(/Vestal/);
    const girl = named(world, "Claudia Russi");
    const younger: WorldState = { ...world, characters: world.characters.map((character) => (character.id === girl.id ? { ...character, ageYearsAtStart: 9 } : character)) };
    expect(marriageBar(younger, ogulnius, girl.id)).toMatch(/too young/);
    expect(marriageBar(world, named(world, "Gnaeus Cornelius Blasio").id, named(world, "Genucia").id)).toMatch(/married already/);
    expect(marriageBar(world, named(world, "Gaius Fabius Pictor").id, named(world, "Fabia Pictoris").id)).toMatch(/kin|married/);
    expect(marriageBar(world, ogulnius, "gaius-genucius")).toMatch(/both men/);
    expect(marriageBar(world, ogulnius, named(world, "Cornelia Blasionis").id)).toBeNull();
    // And the act refuses what the rule bars.
    const wedVestal = applyDeltas(world, [WorldDeltaSchema.parse({ op: "family_tie_set", characterRef: ogulnius, relatedCharacterRef: vestal, relation: "spouse_or_partner", change: "form", reason: "He marries her." })], as(ogulnius));
    expect(wedVestal.rejected).toHaveLength(1);
    expect(wedVestal.rejected[0]!.reason).toMatch(/Vestal/);
  });
});

describe("an offer of marriage is answered by rule", () => {
  it("a man the father thinks well of is given the daughter: they marry, the dowry is paid, and a child can be born", () => {
    const start = opening();
    const blasio = named(start, "Gnaeus Cornelius Blasio");
    const cornelia = named(start, "Cornelia Blasionis");
    const liked = thinks(start, blasio.id, "quintus-ogulnius", 40);
    const asked = proposes(liked, "quintus-ogulnius", blasio.id, "Cornelia");
    const before = balance(asked, blasio.personalAccountId);
    const answered = runDeterministicTick({ world: asked, toDay: 2, ids: createIdFactory("wed"), warfare: definition.warfare });
    const letter = answered.world.diplomacy.find((message) => message.kind === "marriage_offer")!;
    expect(letter.status).toBe("answered");
    expect(letter.answer).toBe("accepted");
    expect(familyLinksOf(answered.world, "quintus-ogulnius").some((view) => view.kind === "spouse_or_partner" && view.counterpartCharacterId === cornelia.id)).toBe(true);
    expect(answered.factProposals.some((fact) => fact.kind === "marriage" && fact.summary.includes("dowry"))).toBe(true);
    expect(balance(answered.world, blasio.personalAccountId)).toBeLessThan(before);
    // The heads of the houses think the better of each other.
    const bride = answered.world.characters.find((character) => character.id === cornelia.id)!;
    expect(birthChance(answered.world, bride, 2, 30)).toBeGreaterThan(0);
    const child = bearChild(answered.world, bride, 400, () => true)!;
    expect(child).not.toBeNull();
    expect(familyLinksOf(child.world, "quintus-ogulnius").some((view) => view.kind === "parent" && view.counterpartCharacterId === child.childId)).toBe(true);
  });

  it("a man the father despises is refused, with the reasons, and nobody is married", () => {
    const start = opening();
    const blasio = named(start, "Gnaeus Cornelius Blasio");
    const hated = thinks(start, blasio.id, "quintus-ogulnius", -60);
    const asked = proposes(hated, "quintus-ogulnius", blasio.id, "Cornelia");
    const answered = answerMarriageOffers(asked, createIdFactory("no"), 2, null);
    const letter = answered.world.diplomacy.find((message) => message.kind === "marriage_offer")!;
    expect(letter.answer).toBe("refused");
    expect(letter.answerText).toMatch(/thinks ill of him/);
    expect(familyLinksOf(answered.world, "quintus-ogulnius").some((view) => view.kind === "spouse_or_partner")).toBe(false);
  });

  it("leaves an offer to the player for the player to answer", () => {
    const start = opening();
    const blasio = named(start, "Gnaeus Cornelius Blasio");
    const asked = proposes(start, "quintus-ogulnius", blasio.id, "Cornelia");
    const answered = answerMarriageOffers(asked, createIdFactory("player"), 2, blasio.id);
    expect(answered.world.diplomacy.find((message) => message.kind === "marriage_offer")!.status).toBe("awaiting_reply");
  });

  it("will not let a suitor write himself a daughter's husband: he must ask her father", () => {
    const start = opening();
    const cornelia = named(start, "Cornelia Blasionis");
    const taken = applyDeltas(start, [WorldDeltaSchema.parse({ op: "family_tie_set", characterRef: "quintus-ogulnius", relatedCharacterRef: cornelia.id, relation: "spouse_or_partner", change: "form", reason: "He marries her." })], as("quintus-ogulnius"));
    expect(taken.rejected).toHaveLength(1);
    expect(taken.rejected[0]!.reason).toMatch(/her father's to give.*marriage_offer/);
  });
});
