import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACT_KINDS,
  ACT_WORDS,
  CONCERN_IN_WORDS,
  ECONOMIC_LEVERS,
  LEVERS,
  MODERN_WORDS,
  WITHIN_UNIT,
  allOffices,
  competenceOf,
  modernWordsIn,
  tradeAddresseeFinder,
} from "@chronica/shared";
import { act, government, holdersOf, opening, taxSet, thinksIll } from "./competence-test-kit";

/**
 * No modern words.
 *
 * The state is a state of the third century before Christ, and what a player or a model reads of it is in the words of the age:
 * magistrate, quaestor, aedile, censor, praetor, tribune, consul, suffete, the Hundred and Four, dioiketes, strategos, the
 * king's friends, a decree of the Senate, a magistrate's charge and competence, the accounts at the close of his office. No
 * ministers, no cabinets, no portfolios, no mandates, no reports on a quarter, no dashboards, no advice drawn up to be followed.
 *
 * `MODERN_WORDS` (shared) is the list. This scans every string of the government's first phase -- the sentences a charge is read in,
 * the words of the acts and of the economic charges, the refusals the engine gives, the motions it lays -- and the source of the files
 * that write them. A later phase adds its own strings and its own files here, and not a list of its own.
 */

/** The files whose every word is the player's or a model's to read, or from which such words are made. */
const NEW_FILES = [
  "../../shared/src/authority/competence.ts",
  "../../shared/src/authority/charge-vocabulary.ts",
  "../../shared/src/world/act-marks.ts",
  "./apply/competence-gate.ts",
  "./levers.ts",
  // H1: the charges written down for the powers we know, and the officers who lay what is not theirs before the chamber.
  "../../db/src/punic-wars-charges.ts",
  "./fiscal-officers.ts",
  // What a state spends to go on being one: the upkeep, the costs of government, the works it lets, and the books of a played ruler.
  "../../shared/src/world/keeping.ts",
  "./the-upkeep-of-a-state.ts",
  "./public-works.ts",
  "./keeping-the-state.ts",
  "./played-ruler-books.ts",
  // The noble families (docs/plans/gentes.md): what they say, and the files that say it.
  "../../shared/src/world/gentes.ts",
  "../../shared/src/characters/roman-names.ts",
  "../../shared/src/characters/gens-standing.ts",
  "../../shared/src/authority/your-gens.ts",
  "./gentes.ts",
  "./adoption.ts",
  "./feuds-in-letters.ts",
  // Grain bought with the state's silver, and armies fed by contract (v58).
  "./grain-purchases.ts",
  "./army-victualling.ts",
  "./gens-loyalty.ts",
  // H2 and H3: the magistrates at their charges and the bodies that sit.
  "./magistrates.ts",
  "./bodies.ts",
  "../../shared/src/material/taxation.ts",
  "../../db/src/punic-wars-gentes.ts",
  "../../db/src/punic-wars-fasti.ts",
];

describe("no modern words", () => {
  it("knows the words it is looking for", () => {
    expect(modernWordsIn("The minister's report to the cabinet, with a recommendation.").length).toBeGreaterThanOrEqual(3);
    expect(modernWordsIn("The quaestor rendered his accounts to the Senate at the close of his office.")).toEqual([]);
    expect(MODERN_WORDS.length).toBeGreaterThan(10);
  });

  it("is kept to by every sentence a charge is read in, for every office of every power", () => {
    const world = opening();
    const lines: string[] = [];
    for (const office of allOffices(world, government.offices)) {
      const competence = competenceOf(world, office.id, government.offices);
      if (competence === null) continue;
      for (const act of ACT_KINDS) lines.push(competence.acts[act].why, competence.acts[act].whyBeyond);
      lines.push(competence.label);
    }
    expect(lines.length).toBeGreaterThan(500);
    const found = lines.flatMap((line) => modernWordsIn(line).map((word) => `${word}: ${line}`));
    expect(found).toEqual([]);
  });

  it("is kept to by the words of the acts and of the economic charges", () => {
    const words = [
      ...Object.values(ACT_WORDS), ...Object.values(WITHIN_UNIT), CONCERN_IN_WORDS.coinage,
      ...ECONOMIC_LEVERS.map((lever) => LEVERS[lever].words),
    ];
    expect(words.flatMap((word) => modernWordsIn(word))).toEqual([]);
  });

  it("is kept to by what the engine says when an act is refused, stopped or laid before the Senate", () => {
    const world = opening();
    const [first, second] = holdersOf(world, "roman-consul") as [string, string];
    const quaestor = holdersOf(world, "roman-quaestor")[0]!;
    const said: string[] = [];
    const past = act(world, first, taxSet("rome", 1_800), { order: true });
    said.push(...past.rejected.map((entry) => entry.reason), past.world.material.politicalProcedures.at(-1)!.label);
    said.push(...act(world, first, taxSet("rome", 1_800)).rejected.map((entry) => entry.reason));
    const done = act(world, first, taxSet("rome", 1_100)).world;
    said.push(...act({ ...done, elapsedStep: 230 }, second, taxSet("rome", 1_150)).rejected.map((entry) => entry.reason));
    said.push(...act(thinksIll(world, second, first), first, taxSet("rome", 1_100)).rejected.map((entry) => entry.reason));
    said.push(...act(world, quaestor, { op: "money_transfer", fromAccountRef: "rome-treasury", toAccountRef: null, amount: 1_000, reason: "Silver." }).rejected.map((entry) => entry.reason));
    expect(said.length).toBeGreaterThanOrEqual(5);
    expect(said.flatMap((line) => modernWordsIn(line).map((word) => `${word}: ${line}`))).toEqual([]);
  });

  it("is kept to by whom a letter about a pact is addressed to, and why", () => {
    const world = opening();
    const find = tradeAddresseeFinder(world, government.offices);
    const lines = ["rome", "carthage", "syracuse", "etruscan-cities"].map((polity) => find(polity)?.why ?? "");
    expect(lines.filter((line) => line.length > 0).length).toBeGreaterThanOrEqual(3);
    expect(lines.flatMap((line) => modernWordsIn(line))).toEqual([]);
  });

  it("is kept to by the files that write them, comments and all", () => {
    const found = NEW_FILES.flatMap((file) => {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      return modernWordsIn(text).map((word) => `${file}: ${word}`);
    });
    expect(found).toEqual([]);
  });
});
