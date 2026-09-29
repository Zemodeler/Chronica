import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema, WORLD_DELTA_OPS, WorldDeltaSchema, WorldStateSchema, localRef,
  type WorldDelta, type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * Anything the engine can mint, the same answer must be able to talk about.
 *
 * A creating op hands the model a `localId` and the model writes `local:x`
 * wherever it means the thing it just made. A field that takes a bare entity
 * id does not stop that at the door -- `EntityIdSchema` is a plain string and
 * accepts `local:free_messana` happily -- it stops it in the handler, which
 * looks the literal handle up among the world's ids, does not find it, and
 * refuses the order on the grounds that the thing does not exist. It does
 * exist. It was made four lines earlier.
 *
 * `polity_create` was in exactly that position on ten fields: a rising could
 * declare itself and then not be given a leader, an army, a war, a letter or
 * an opinion until a turn the player never took.
 *
 * So this derives the sites rather than listing them. The ops that mint
 * something are found by introspecting the vocabulary for a `localId`; every
 * field that names one of those kinds is found by name; and each site must
 * have a fixture here proving the handler resolves a handle. Add a creating op
 * or a field that names one of its products and this test fails until somebody
 * has said what happens -- which is the point, because the alternative is
 * finding out in play.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const MESSANA = PUNIC_IDS.messana;

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("mint"),
  gameId: "game-1",
  // The world founding a rising and arming it, as the orchestrator does in
  // play -- not the consul raising men for a power he does not serve.
  actsForTheWorld: true,
});

/** What each op that mints something puts into the world. */
const MINTS: Readonly<Record<string, string>> = {
  character_create: "character",
  force_create: "force",
  polity_create: "polity",
  authority_grant_upsert: "grant",
  polity_stance_shift: "stance",
  project_create: "project",
  generic_entity_create: "entity",
  obligation_upsert: "obligation",
  income_source_upsert: "income",
  loan_open: "loan",
  storyline_open: "storyline",
  agreement_open: "agreement",
  diplomatic_message_send: "message",
  political_procedure_open: "procedure",
  social_events: "encounter",
  // A plot mints the plot itself and the thread it runs in. Nothing in the
  // vocabulary names a plot afterwards -- it is resolved by the engine, on its
  // own schedule, and never referred to by a later delta -- so there is no
  // handle site to prove. It is declared here so the guard stays exhaustive.
  covert_plot_open: "plot",
  // A plan mints the contingency itself. It is named again by
  // `contingency_disarm`, which takes an ordinary ref -- a plan called off in
  // the same breath it was laid in is a plan nobody laid, so there is no handle
  // site to prove here either.
  contingency_arm: "contingency",
  // An audit is resolved by the engine on its day and never named again.
  audit_open: "audit",
  siege_lay: "siege",
  // A contract is ended again by `service_contract_close`, with an ordinary
  // ref: a man hired and let go in the same breath was never hired.
  service_contract_open: "contract",
  // An estate. Named afterwards only by `holdingRef`, an ordinary ref, which
  // resolves a same-answer handle by construction.
  holding_create: "holding",
  // A trade. Named afterwards only by `ventureRef`, an ordinary ref.
  trade_venture_open: "venture",
};

/** How a field says which kind of thing it names. Ref-typed names are already safe by construction. */
const NAMES: Readonly<Record<string, RegExp>> = {
  polity: /^(polityId|otherPolityId|fromPolityId|toPolityId|towardPolityId|breaksFromPolityId)$/,
  province: /^(provinceId|locationId)$/,
};

type Shape = Record<string, unknown>;
const shapes = (): { op: string; shape: Shape }[] =>
  (WorldDeltaSchema as unknown as { options: { shape: Shape }[] }).options.map((option) => ({
    op: (option.shape["op"] as { value: string }).value,
    shape: option.shape,
  }));

/** Every place a field names a kind of thing that some op can mint. */
function sitesNaming(kind: string): string[] {
  const matcher = NAMES[kind];
  if (matcher === undefined) return [];
  return shapes().flatMap(({ op, shape }) =>
    Object.keys(shape).filter((field) => matcher.test(field)).map((field) => `${op}.${field}`));
}

/**
 * One order per site: make a power, then name it with a handle in that field.
 * Anything else in the payload is whatever the op needs to be well formed.
 */
const THE_RISING = {
  op: "polity_create", localId: "risen", name: "The Free City of Messana",
  breaksFromPolityId: "mamertines", provinceIds: [MESSANA], capitalSettlementId: null,
  reason: "The citizens throw off the mercenaries who took their city.",
};

const HANDLE = localRef("risen");

const FIXTURES: Readonly<Record<string, Record<string, unknown>>> = {
  "character_create.polityId": {
    op: "character_create", localId: "leader", name: "Cleon of Messana", polityId: HANDLE,
    provinceId: MESSANA, age: 45, officeLabel: null, traits: [], generatedBecause: "A rising has a leader.",
  },
  "force_create.polityId": {
    op: "force_create", localId: "levy", name: "The citizen levy", polityId: HANDLE,
    commanderCharacterRef: "mamertine-spokesman", controllerCharacterRef: "mamertine-spokesman",
    locationId: MESSANA, authorizedStrength: 900, reason: "Every man who can hold a spear.",
  },
  "force_modify.polityId": {
    op: "force_modify", forceRef: "mamertine-garrison", polityId: HANDLE,
    reason: "The garrison goes over to the city.",
  },
  "polity_stance_shift.polityId": {
    op: "polity_stance_shift", polityId: HANDLE, towardPolityId: "syracuse", trustDelta: -30,
    reason: "The new city knows who will come for it.",
  },
  "polity_stance_shift.towardPolityId": {
    op: "polity_stance_shift", polityId: "syracuse", towardPolityId: HANDLE, trustDelta: -40,
    reason: "Syracuse takes a view of the rising.",
  },
  "polity_outlook_set.polityId": {
    op: "polity_outlook_set", polityId: HANDLE, primaryObjective: "Stay free of all three of them.",
    concerns: [{ label: "Syracuse will come for the strait", level: "high" }],
    intentions: ["Find a protector"], riskTolerance: 60,
    reason: "The city decides what it wants.",
  },
  "agreement_open.polityId": {
    op: "agreement_open", localId: "their_war", kind: "war", polityId: HANDLE, otherPolityId: "syracuse",
    terms: "The city will not be retaken.", reason: "It declares itself against Syracuse.",
  },
  "agreement_open.otherPolityId": {
    op: "agreement_open", localId: "the_reprisal", kind: "war", polityId: "syracuse", otherPolityId: HANDLE,
    terms: "Syracuse will not have a free city on the strait.", reason: "Hieron moves.",
  },
  "diplomatic_message_send.fromPolityId": {
    op: "diplomatic_message_send", localId: "their_plea", kind: "letter", fromPolityId: HANDLE,
    fromCharacterRef: "mamertine-spokesman", toPolityId: "rome", toCharacterRef: null,
    subject: "A free city asks for a protector", terms: "Come before Syracuse does.",
    reason: "The city writes to Rome.",
  },
  "diplomatic_message_send.toPolityId": {
    op: "diplomatic_message_send", localId: "an_offer", kind: "letter", fromPolityId: "rome",
    fromCharacterRef: "gaius-genucius", toPolityId: HANDLE, toCharacterRef: null,
    subject: "Rome's regard for a free city", terms: "Keep your laws; Rome asks only the strait.",
    reason: "The consul is quick off the mark.",
  },
  "character_state_set.polityId": {
    op: "character_state_set", characterRef: "mamertine-spokesman", polityId: HANDLE,
    reason: "The spokesman throws in his lot with the city.",
  },
  "polity_create.breaksFromPolityId": {
    op: "polity_create", localId: "a_further_rising", name: "The Sons of Messana",
    breaksFromPolityId: HANDLE, provinceIds: [MESSANA], capitalSettlementId: null,
    reason: "The rising has a rising of its own.",
  },
};

/** Fields naming a province: nothing mints one yet, so these are recorded rather than exercised. */
const NOTHING_MINTS_ONE_YET = new Set(["province"]);

function carriedOut(fixture: Record<string, unknown>): { refusals: string[]; unsayable: string | null } {
  const deltas: WorldDelta[] = [];
  for (const raw of [THE_RISING, fixture]) {
    const parsed = WorldDeltaSchema.safeParse(raw);
    if (!parsed.success) {
      return { refusals: [], unsayable: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    }
    deltas.push(parsed.data);
  }
  const result = applyDeltas(world(), deltas, context());
  return { refusals: result.rejected.map((rejection) => rejection.reason), unsayable: null };
}

describe("what the engine can make, the same answer can name", () => {
  it("has a fixture for every place a field names something an op can mint", () => {
    const missing: string[] = [];
    for (const kind of new Set(Object.values(MINTS))) {
      if (NOTHING_MINTS_ONE_YET.has(kind)) continue;
      for (const site of sitesNaming(kind)) {
        if (!(site in FIXTURES)) missing.push(site);
      }
    }
    // A new creating op, or a new field naming one of its products, lands here
    // rather than in somebody's game.
    expect(missing).toEqual([]);
  });

  it("knows what every creating op creates", () => {
    const undeclared = shapes()
      .filter(({ op, shape }) => "localId" in shape && !(op in MINTS))
      .map(({ op }) => op);
    expect(undeclared).toEqual([]);
  });

  it("only claims to cover ops the vocabulary actually has", () => {
    expect(Object.keys(MINTS).filter((op) => !WORLD_DELTA_OPS.includes(op as never))).toEqual([]);
  });

  for (const [site, fixture] of Object.entries(FIXTURES)) {
    it(`carries out ${site} against a power created in the same answer`, () => {
      const { refusals, unsayable } = carriedOut(fixture);
      expect(unsayable).toBeNull();
      // The refusal this is really about is "no such power exists" for a power
      // that was made four lines earlier.
      expect(refusals).toEqual([]);
    });
  }
});
