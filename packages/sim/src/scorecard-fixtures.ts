import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type Force, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput } from "./burst";
import type { ChronicleEntry } from "./chronicle";
import type { SimModelPort, SimOperation } from "./ports";
import { countRequests, scoreOrders, scoreProse, type Scorecard } from "./scorecard";

/**
 * The runs the scorecard is taken on: a scripted model, so the same world and
 * the same answers every time, and a number that moves only when the engine
 * does. Plan `chronicle-and-order-truth`, phase 0.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const { messana: MESSANA } = PUNIC_IDS;
const ACTOR = "gaius-genucius";

function clepsinaWorld(): WorldState {
  const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const hulls = opening.material.forces.find((force) => force.id === "allied-greek-hulls")!;
  const navy: Force = { ...hulls, id: "roman-navy", name: "Roman Navy", locationId: MESSANA, personnel: [{ categoryId: "warship", label: "Warships", fit: 150, unavailable: [] }] };
  return {
    ...opening,
    material: {
      ...opening.material,
      forces: [
        ...opening.material.forces.map((force): Force => force.id === "roman-field-army"
          ? { ...force, locationId: PUNIC_IDS.rome, personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 7_100, unavailable: [] }] }
          : force),
        navy,
      ],
    },
  };
}

function scripted(script: Partial<Record<SimOperation, string[]>>, asked: string[]): SimModelPort {
  const remaining = { ...script };
  return {
    complete(operation) {
      asked.push(operation);
      const next = remaining[operation]?.shift();
      return Promise.resolve(next ?? JSON.stringify({ actors: [] }));
    },
  };
}

const answer = (body: Record<string, unknown>): string => JSON.stringify({
  narrativeSummary: "As ordered.", frictions: [], deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  intent: { summary: "The order.", parts: [] },
  ...body,
});

interface Fixture {
  readonly label: string;
  readonly orderText: string;
  readonly answer: string;
}

const FIXTURES: readonly Fixture[] = [
  {
    // R54, R55, R65, R66: one part with work behind it, one with none.
    label: "clepsina: crossing + audit",
    orderText: "Carry Legio I to Messana in the Roman Navy. Appoint someone independent of me to examine the accusation.",
    answer: answer({
      intent: { summary: "Carry the legion over and have the accusation examined.", domains: ["military"], parts: [
        { said: "Carry Legio I to Messana in the Roman Navy", factLocalIds: [], whyNot: null },
        { said: "Appoint someone independent to examine the accusation", factLocalIds: [], whyNot: null },
      ] },
      deltas: [{ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, fleetRefs: ["roman-navy"], reason: "Carry Legio I over to Messana in the Roman Navy." }],
    }),
  },
  {
    // A part the answer wrote no act for: told as nothing came of it.
    label: "clepsina: part with no act",
    orderText: "Have the allies made ready.",
    answer: answer({
      intent: { summary: "Ready the allies.", domains: ["military"], parts: [{ said: "Have the allies made ready", factLocalIds: [], whyNot: null }] },
    }),
  },
];

/** Run every fixture and score it. `entries` are chronicle passages to score for prose, when a run has them. */
export async function runScorecard(entries: readonly ChronicleEntry[] = [], now: () => number = () => 0): Promise<readonly Scorecard[]> {
  const cards: Scorecard[] = [];
  for (const fixture of FIXTURES) {
    const asked: string[] = [];
    const started = now();
    const burst: BurstInput = {
      world: clepsinaWorld(), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      burstId: `scorecard-${cards.length}`, gameId: "game-scorecard", actorRef: { kind: "character", id: ACTOR }, actorPolityId: "rome",
      orderText: fixture.orderText, knownFacts: [], queue: [], port: scripted({ simulate_orchestrate: [fixture.answer] }, asked), narratorSeeds: [], spanDays: 1,
    };
    const result = await runSimulationBurst(burst);
    cards.push({
      label: fixture.label,
      orders: scoreOrders(result.world, result.orderRecordId === null ? undefined : [result.orderRecordId]),
      prose: scoreProse(entries),
      requests: countRequests(asked),
      totalRequests: asked.length,
      wallSeconds: (now() - started) / 1000,
      stopReason: result.stopReason,
    });
  }
  return cards;
}
