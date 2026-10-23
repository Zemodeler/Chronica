import { beforeAll, describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, modernWordsIn, readDepartments, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { COGNITION_SYSTEM_PROMPT, runCognition } from "./cognition";
import {
  CRISIS_ARREARS_MONTHS,
  KEPT_BY_THE_OFFICERS,
  ROUTINE_OPS,
  keptByTheOfficers,
  setAsideForTheOfficers,
  stateCrisisLine,
} from "./kept-by-the-officers";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrate";
import type { SimModelPort } from "./ports";

/**
 * The model is left to its plots.
 *
 * The routine government of a state is kept by its officers, by rule (docs/economy.md, "What the model is left to"). A man the
 * model plays is not shown the menu of it and, if he writes one of its acts, it is set aside quietly and counted. The player's own
 * order may still be about anything, and so may the order of a man he has put it to.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const fresh = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const silent: SimModelPort = {
  complete(operation) {
    if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "w", deltas: [], facts: [], outcome: "continue" }));
    if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
    return Promise.resolve("{}");
  },
};
const burstOf = (port: SimModelPort, world: WorldState) => runSimulationBurst({
  world, clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
  terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
  burstId: "plots", gameId: "left-to-its-plots", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
  orderText: null, spanDays: 30, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET,
});
// The opening has its rulers seated only once the world has run a month (as nature-binds.test.ts does).
const world = (await burstOf(silent, fresh())).world;
const parse = (raw: Record<string, unknown>) => WorldDeltaSchema.parse(raw);

const foreign = world.map.polities.map((polity) => ({ polity, head: readDepartments(world).rulers(polity.id).find((candidate) => candidate.alive) }))
  .find((entry) => entry.polity.id !== "rome" && entry.head !== undefined && entry.head.personalAccountId != null)!;
const ruler = foreign.head!;
const P = foreign.polity.id;
const other = world.map.polities.find((polity) => polity.id !== "rome" && polity.id !== foreign.polity.id)!.id;
const player = readDepartments(world).rulers("rome").find((candidate) => candidate.alive)!;
const ask = { actorId: ruler.id, playerId: player.id, playerPolityId: "rome" };
const aProvince = world.map.provinces.find((province) => province.controllerPolityId === P)!.id;
const chestOf = (polityId: string): string => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)!.id;
const purseOf = (id: string): string => world.characters.find((character) => character.id === id)!.personalAccountId;

const tax = parse({ op: "tax_policy_set", scope: "polity", polityId: P, regime: "tithe", rateBps: 1_400, reason: "test" });
const debase = parse({ op: "coinage_debase", coinageId: "x", stepBps: -1_500, reason: "test" });
const bribe = parse({ op: "money_transfer", fromAccountRef: purseOf(ruler.id), toAccountRef: chestOf("rome"), amount: 100, reason: "a bribe" });

describe("what a man the model plays is shown", () => {
  it("is told, in the words of the age, that the officers keep the routine government and what his own work is", () => {
    expect(COGNITION_SYSTEM_PROMPT).toContain(KEPT_BY_THE_OFFICERS);
    expect(modernWordsIn(KEPT_BY_THE_OFFICERS)).toEqual([]);
    for (const work of ["plots", "marriages", "patronage", "factions", "oaths", "treachery", "love and grudges"]) expect(KEPT_BY_THE_OFFICERS).toContain(work);
  });

  it("has no menu of the routine acts: not the tax, the mint, the estates, the ventures, the loans between states", () => {
    for (const op of ROUTINE_OPS) expect(COGNITION_SYSTEM_PROMPT, op).not.toContain(`"${op}"`);
    // Nor the terms of a trade pact, nor the offer of a state's loan, which were there for the treasurer.
    expect(COGNITION_SYSTEM_PROMPT).not.toContain("customs cap");
    expect(COGNITION_SYSTEM_PROMPT).not.toContain("Taking a loan offer listed under TREASURY");
    // What a plotter reaches for is still there.
    for (const op of ["money_transfer", "covert_plot_open", "belief_set", "diplomatic_message_send", "family_tie_set", "political_support_set", "loan_open", "agreement_open"]) {
      expect(COGNITION_SYSTEM_PROMPT, op).toContain(`"${op}"`);
    }
  });

  it("is a shorter prompt than it was", () => {
    // 77.4k before the officers took the routine government; 73.9k after.
    expect(COGNITION_SYSTEM_PROMPT.length).toBeLessThan(75_000);
  });

  it("still leaves the player's order the whole menu", () => {
    for (const op of ["tax_policy_set", "coinage_debase", "holding_create", "holding_improve", "trade_venture_open", "loan_open", "loan_settle", "agreement_open"]) {
      expect(ORCHESTRATOR_SYSTEM_PROMPT, op).toContain(`"${op}"`);
    }
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("trade_pact");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("by rule");
  });
});

describe("what the engine sets aside for a man the model plays", () => {
  it("sets aside the tax, the coin, the estates, the ventures and a state's loan", () => {
    expect(keptByTheOfficers(world, tax, ask)).toMatch(/officers keep it/);
    expect(keptByTheOfficers(world, debase, ask)).toMatch(/officers keep it/);
    const estate = parse({ op: "holding_create", localId: "h", title: "Villa", provinceId: aProvince, holderCharacterRef: ruler.id, band: "slight", priceFromAccountRef: purseOf(ruler.id), reason: "test" });
    expect(keptByTheOfficers(world, estate, ask)).not.toBeNull();
    const venture = parse({ op: "trade_venture_open", localId: "v", title: "Ship", ownerCharacterRef: ruler.id, fromProvinceId: aProvince, toProvinceId: aProvince, band: "slight", paidFromAccountRef: purseOf(ruler.id), reason: "test" });
    expect(keptByTheOfficers(world, venture, ask)).not.toBeNull();
    const stateLoan = parse({ op: "loan_open", localId: "l", lenderKind: "foreign", lenderRef: null, borrowerAccountRef: chestOf(P), principal: 5_000, interestBps: 200, cadenceDays: 30, terms: "x", reason: "test" });
    expect(keptByTheOfficers(world, stateLoan, ask)).toMatch(/a loan to a state/);
  });

  it("sets aside a pact or an embargo between powers, and lets a war, and a pact that touches the player's own power, stand", () => {
    const pact = parse({ op: "agreement_open", localId: "p", kind: "trade_pact", polityId: P, otherPolityId: other, terms: "x", visibility: "public", reason: "test" });
    expect(keptByTheOfficers(world, pact, ask)).toMatch(/between powers/);
    expect(keptByTheOfficers(world, parse({ op: "agreement_open", localId: "e", kind: "embargo", polityId: P, otherPolityId: other, terms: "x", visibility: "public", reason: "test" }), ask)).not.toBeNull();
    expect(keptByTheOfficers(world, parse({ op: "agreement_open", localId: "w", kind: "war", polityId: P, otherPolityId: other, terms: "War.", visibility: "public", reason: "test" }), ask)).toBeNull();
    expect(keptByTheOfficers(world, parse({ op: "agreement_open", localId: "p2", kind: "trade_pact", polityId: P, otherPolityId: "rome", terms: "x", visibility: "public", reason: "test" }), ask)).toBeNull();
  });

  it("does not touch a plot: a bribe, a private loan, a letter, a belief, a dole given to win a city", () => {
    const private_loan = parse({ op: "loan_open", localId: "pl", lenderKind: "character", lenderRef: player.id, borrowerAccountRef: purseOf(ruler.id), principal: 500, interestBps: 300, cadenceDays: 30, terms: "to buy a vote", reason: "test" });
    const dole = parse({ op: "public_benefaction", payerAccountRef: null, amount: 200, kind: "dole", provinceId: aProvince, reason: "to be loved" });
    const belief = parse({ op: "belief_set", holderCharacterRef: player.id, claim: "the consul steals", kind: "rumour", confidence: 60, reason: "test" });
    for (const act of [bribe, private_loan, dole, belief]) expect(keptByTheOfficers(world, act, ask), act.op).toBeNull();
  });

  it("sets them aside one by one, keeping the rest, and says why", () => {
    const outcome = setAsideForTheOfficers(world, [tax, bribe, debase], ask);
    expect(outcome.kept).toEqual([bribe]);
    expect(outcome.setAside.map((entry) => entry.delta.op)).toEqual(["tax_policy_set", "coinage_debase"]);
  });

  it("leaves a man the player has put an order to the whole of it", () => {
    const attempt = { id: "att-1", issuerRef: { kind: "character", id: player.id }, recipientRef: { kind: "character", id: ruler.id }, status: "accepted" };
    const ordered = { ...world, orderAttempts: [...world.orderAttempts, attempt as unknown as WorldState["orderAttempts"][number]] };
    expect(keptByTheOfficers(ordered, tax, ask)).toBeNull();
    expect(keptByTheOfficers(world, tax, ask)).not.toBeNull();
    // And the player's own man is never asked at all (the burst only sets aside what another man wrote).
    expect(keptByTheOfficers(world, tax, { ...ask, actorId: player.id })).not.toBeNull();
  });
});

describe("what the model is told of the chest and the granary", () => {
  const polity = "rome";
  const consul = readDepartments(world).rulers(polity).find((candidate) => candidate.alive)!;
  const owedAMonth = (w: WorldState): number => {
    const chests = new Set(w.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polity).map((account) => account.id));
    return w.material.obligations.filter((o) => o.active && chests.has(o.payerAccountId) && o.cadenceSteps > 0).reduce((sum, o) => sum + (o.amount * 30) / o.cadenceSteps, 0);
  };
  const behind = (w: WorldState, months: number): WorldState => {
    const chests = new Set(w.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polity).map((account) => account.id));
    const first = w.material.obligations.find((o) => o.active && chests.has(o.payerAccountId) && o.cadenceSteps > 0)!;
    return { ...w, material: { ...w.material, obligations: w.material.obligations.map((o) => (o.id === first.id ? { ...o, arrears: Math.ceil(owedAMonth(w) * months) } : o)) } };
  };

  it("says nothing of a state that is merely poor", () => {
    expect(stateCrisisLine(world, consul.id)).toBeNull();
    expect(stateCrisisLine(behind(world, CRISIS_ARREARS_MONTHS * 0.5), consul.id)).toBeNull();
  });

  it("says the soldiers' pay is behind once it is a month behind, to the ruler and to nobody who has no army or crown", () => {
    const line = stateCrisisLine(behind(world, CRISIS_ARREARS_MONTHS), consul.id);
    expect(line).toMatch(/^A crisis of the state: the soldiers' pay is \d+ behind/);
    expect(modernWordsIn(line!)).toEqual([]);
    const bystander = world.characters.find((character) => character.alive && character.polityId === polity
      && !readDepartments(world).rulers(polity).some((r) => r.id === character.id)
      && !world.material.forces.some((force) => force.commanderCharacterId === character.id || force.controllerCharacterId === character.id))!;
    expect(stateCrisisLine(behind(world, 3), bystander.id)).toBeNull();
  });
});

describe("what a ruler reads in his own section", () => {
  const consul = readDepartments(world).rulers("rome").find((candidate) => candidate.alive)!;
  const sectionFor = async (w: WorldState): Promise<string> => {
    let said = "";
    const port: SimModelPort = { complete(_operation, _system, userMessage) { said = userMessage; return Promise.resolve(JSON.stringify({ actors: [] })); } };
    await runCognition(port, [{ ref: { kind: "character", id: consul.id }, characterId: consul.id, name: consul.name, level: "focused", impetus: "reaction", pressing: true, score: 60, knownFacts: [], why: "directly affected" }], w, definition.clock);
    return said;
  };
  it("carries no list of the charges of his office and no crisis while the books are quiet", async () => {
    const text = await sectionFor(world);
    expect(text).not.toContain("In charge of:");
    expect(text).not.toContain("A crisis of the state");
  });
  it("carries the crisis once the soldiers' pay is a month behind", async () => {
    const chests = new Set(world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === "rome").map((account) => account.id));
    const paying = world.material.obligations.find((o) => o.active && chests.has(o.payerAccountId) && o.cadenceSteps > 0)!;
    const owed = world.material.obligations.filter((o) => o.active && chests.has(o.payerAccountId) && o.cadenceSteps > 0).reduce((sum, o) => sum + (o.amount * 30) / o.cadenceSteps, 0);
    const behind: WorldState = { ...world, material: { ...world.material, obligations: world.material.obligations.map((o) => (o.id === paying.id ? { ...o, arrears: Math.ceil(owed) } : o)) } };
    expect(await sectionFor(behind)).toContain("A crisis of the state: the soldiers' pay is");
  });
});

describe("a model's management act in a burst", () => {
  let skipped: readonly { stage: string; reason: string }[] = [];
  let asked = 0;
  beforeAll(async () => {
    // Every person asked proposes to raise his power's tax and, with it, to pay somebody off.
    const port: SimModelPort = {
      complete(operation, _system, userMessage) {
        if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "w", deltas: [], facts: [], outcome: "continue" }));
        if (operation !== "simulate_cognition") return Promise.resolve("{}");
        const people = [...userMessage.matchAll(/^## .* \[([^\]]+)\]$/gm)].map((match) => match[1]!);
        asked += people.length;
        return Promise.resolve(JSON.stringify({ actors: people.map((id) => {
          const polityId = world.characters.find((character) => character.id === id)?.polityId ?? P;
          return { actorRef: { kind: "character", id }, reasoning: "Money.", proposal: { narrativeSummary: "He raises the tithe.", deltas: [
            { op: "tax_policy_set", scope: "polity", polityId, regime: "tithe", rateBps: 1_600, reason: "more silver" },
          ], facts: [] } };
        }) }));
      },
    };
    const result = await burstOf(port, fresh());
    skipped = result.skipped;
  }, 300_000);

  it("is set aside quietly, and counted in the log under the officers", () => {
    expect(asked).toBeGreaterThan(0);
    const counted = skipped.filter((entry) => entry.stage === "officers");
    expect(counted.length).toBeGreaterThan(0);
    expect(counted[0]!.reason).toMatch(/officers keep it/);
    // Quiet: not a refusal the model is called again to correct.
    expect(skipped.filter((entry) => entry.stage === "repair")).toEqual([]);
  });
});
