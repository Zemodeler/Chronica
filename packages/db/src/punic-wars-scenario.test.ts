import { describe, expect, it } from "vitest";
import { findPayProblems, WorldStateSchema } from "@chronica/shared";
import { firstPunicWarScenario } from "./built-in-scenarios";
import { punicWarsScenario } from "./punic-wars-scenario";

describe("Punic Wars built-in scenario", () => {
  it("opens in 270 BCE as a tense peace with the Messana crisis", () => {
    expect(punicWarsScenario.definition.clock.epoch).toMatchObject({ year: 270, month: 3, day: 1, era: "BCE" });
    expect(punicWarsScenario.initialWorld.conflicts.wars).toEqual([]);
    expect(punicWarsScenario.initialWorld.storylines?.map((storyline) => storyline.id)).toContain("mamertine-syracusan-crisis");
    expect(punicWarsScenario.initialWorld.map.politicalRelations).toEqual([]);
  });

  it("keeps the four key actors and their historical capitals in authoritative state", () => {
    expect(punicWarsScenario.initialWorld.map.polities.filter((polity) => ["rome", "carthage", "syracuse", "mamertines"].includes(polity.id))).toHaveLength(4);
    // Five armies -- the four powers' own, and the Campanian legion holding
    // Rhegium against the Republic -- plus the ships that decide who can cross
    // to Sicily at all. The consul's army is half allies, as a consular army was.
    const forces = punicWarsScenario.initialWorld.material.forces;
    expect(forces.filter((force) => force.personnel.every((category) => category.categoryId === "infantry"))).toHaveLength(5);
    expect(forces.find((force) => force.id === "roman-field-army")!.personnel.map((category) => category.label)).toEqual(["Legionaries", "Allied infantry"]);
    expect(forces.filter((force) => force.personnel.some((category) => category.categoryId === "warship"))).toHaveLength(3);
  });

  it("makes Sicily an island", () => {
    // Authored as land edges because nothing could tell the difference, so a
    // legion walked to Sicily and a naval war needed no ships.
    const crossing = (from: string, to: string): string | undefined =>
      punicWarsScenario.initialWorld.map.edges.find(
        (edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
      )?.crossing;

    expect(crossing("punic-italy-bruttian-highlands", "ita-72843720b81376294924159-sicily-northeast")).toBe("strait");
    expect(crossing("tun-13205935b88806172084765", "ita-72843720b81376294924159-sicily-west")).toBe("sea_lane");
  });

  it("governs Latium and Campania from Rome, and the rest of Italy through allies bound by foedus", () => {
    const world = punicWarsScenario.initialWorld;
    const controller = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
    expect(controller.get("punic-italy-latium")).toBe("rome");
    expect(controller.get("punic-italy-campanian-plain")).toBe("rome");
    expect(controller.get("punic-italy-etrurian-uplands")).toBe("etruscan-cities");
    expect(controller.get("punic-italy-samnium")).toBe("samnites");
    expect(controller.get("punic-italy-sallentine-peninsula")).toBe("messapians");
    const allies = world.polityAgreements.filter((agreement) => agreement.kind === "foedus" && agreement.otherPolityId === "rome").map((agreement) => agreement.polityId);
    expect(allies.sort()).toEqual(["apulian-cities", "bruttians", "etruscan-cities", "lucanians", "marsi-paeligni", "picentes", "samnites", "umbrians"]);
    // Every ally holds its own ground; the Messapians are not yet anybody's.
    for (const ally of allies) expect([...controller.values()]).toContain(ally);
    expect(allies).not.toContain("messapians");
    // Soldiers, not money: nothing the allies pay reaches Rome's treasury.
    expect(world.material.incomeSources.some((source) => source.beneficiaryAccountId === "rome-treasury" && source.kind === "tribute")).toBe(false);
  });

  it("keeps every rendered settlement in a playable province available to the simulation", () => {
    const settlements = new Map(
      punicWarsScenario.initialWorld.map.provinces.flatMap((province) =>
        province.settlements.map((settlement) => [settlement.id, settlement] as const),
      ),
    );
    expect(settlements.get("settlement-bononia")).toMatchObject({
      name: "Felsina",
      provinceId: "punic-italy-middle-padus",
      controllerPolityId: "boii",
    });
    expect(settlements.get("settlement-volsinii")).toMatchObject({
      provinceId: "punic-italy-etrurian-uplands",
      controllerPolityId: "etruscan-cities",
    });
    // Rome's Latin colonies stand inside its allies' land as its own.
    expect(settlements.get("settlement-luceria")).toMatchObject({ provinceId: "punic-italy-apulian-coast", controllerPolityId: "rome" });
    expect(settlements.get("settlement-lilybaeum")?.provinceId).toBe("ita-72843720b81376294924159-sicily-west");
    expect(settlements.get("settlement-panormus")?.provinceId).toBe("ita-72843720b81376294924159-sicily-northwest");
  });

  // Italy's gameplay provinces match the rendered map's own partition
  // (apps/web/lib/punic-wars-geojson.ts's ITALY_GROUNDED_TERRITORIES) exactly
  // -- a gameplay province id with no matching map polygon has nowhere to
  // render (see the army-vanishing and mismatched-label bugs this replaced).
  it("matches the rendered map's Italy partition exactly", () => {
    const ids = punicWarsScenario.initialWorld.map.provinces.map((province) => province.id);
    expect(ids).toEqual(expect.arrayContaining([
      "punic-italy-ligurian-coast", "punic-italy-insubrian-plain", "punic-italy-middle-padus",
      "punic-italy-venetian-lagoon", "punic-italy-etrurian-uplands", "punic-italy-bruttian-highlands",
    ]));
  });
});

/**
 * The whole drawn map is authoritative state, not an overlay painted over it.
 *
 * These are the invariants that make that claim mean something. Nothing in the
 * engine enforces them at runtime -- `ProvinceGraphSchema` checks ids and
 * settlements but never edges or terrain -- so a scenario could ship a border
 * to a province that does not exist, or a sea lane out of a landlocked upland,
 * and the first sign of it would be an army that cannot move.
 */
describe("the Punic Wars map as authoritative world state", () => {
  const world = punicWarsScenario.initialWorld;
  const provinces = world.map.provinces;
  const byId = new Map(provinces.map((province) => [province.id, province]));
  const terrains = new Map(punicWarsScenario.definition.map.terrains.map((terrain) => [terrain.id, terrain]));

  it("carries every province the map draws a controller for, each with a declared holder", () => {
    // 779 drawn provinces, and Messapia cut from Apulia.
    expect(provinces).toHaveLength(780);
    expect(new Set(provinces.map((province) => province.id)).size).toBe(provinces.length);

    const polityIds = new Set(world.map.polities.map((polity) => polity.id));
    const undeclared = provinces.filter((province) => province.controllerPolityId !== null && !polityIds.has(province.controllerPolityId));
    expect(undeclared.map((province) => province.id)).toEqual([]);
    // v31 merged duplicate peoples (two Treveri, two Danubian Boii) and dropped
    // polities named after modern regions (Ceuta, Melilla, Marne, TIMIS).
    expect(world.map.polities.length).toBeGreaterThanOrEqual(120);
  });

  it("declares the province count the map really has", () => {
    // Nothing in the engine enforced this before, and it had drifted by one.
    const { min, max } = punicWarsScenario.definition.map.provinceCount;
    expect(provinces.length).toBeGreaterThanOrEqual(min);
    expect(provinces.length).toBeLessThanOrEqual(max);
  });

  it("gives every polity that holds ground somewhere to hold", () => {
    const held = new Set(provinces.map((province) => province.controllerPolityId));
    // A city counts. The Campanian legion holds Rhegium inside a province Rome
    // otherwise controls, which is precisely what it did -- and what the
    // Mamertines did at Messana.
    for (const province of provinces) for (const settlement of province.settlements) held.add(settlement.controllerPolityId);
    // One polity is declared without territory on purpose: the Cenomani
    // province was merged away, but the people remain nameable. Every other
    // polity must actually hold something, or it is a name the world can
    // neither show nor act on.
    const landless = world.map.polities.filter((polity) => !held.has(polity.id)).map((polity) => polity.id);
    expect(landless.sort()).toEqual(["cenomani"]);
  });

  it("draws no border to a province that does not exist", () => {
    const dangling = world.map.edges.filter((edge) => !byId.has(edge.from) || !byId.has(edge.to));
    expect(dangling).toEqual([]);
  });

  // packages/shared/src/world/map.ts: "An edge is legal only when its crossing
  // is admitted by the terrain on *both* sides." Nothing checks this at
  // runtime, which is exactly why it is checked here.
  it("only draws a crossing both sides' terrain admits", () => {
    const illegal = world.map.edges.filter((edge) => {
      const from = terrains.get(byId.get(edge.from)!.terrainId);
      const to = terrains.get(byId.get(edge.to)!.terrainId);
      return from === undefined || to === undefined
        || !from.allowedCrossings.includes(edge.crossing)
        || !to.allowedCrossings.includes(edge.crossing);
    });
    expect(illegal.map((edge) => `${edge.from} -${edge.crossing}-> ${edge.to}`)).toEqual([]);
  });

  it("names a terrain the scenario actually defines, for every province", () => {
    const unknown = provinces.filter((province) => !terrains.has(province.terrainId));
    expect(unknown.map((province) => province.id)).toEqual([]);
  });

  // An unreachable province is worse than a missing one: it renders, it can be
  // named in an order, and then nothing can ever march to it.
  it("leaves nowhere unreachable from Rome", () => {
    const neighbours = new Map<string, string[]>(provinces.map((province) => [province.id, []]));
    for (const edge of world.map.edges) {
      neighbours.get(edge.from)!.push(edge.to);
      neighbours.get(edge.to)!.push(edge.from);
    }
    const seen = new Set<string>(["punic-italy-latium"]);
    const queue = ["punic-italy-latium"];
    while (queue.length > 0) {
      for (const next of neighbours.get(queue.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const unreachable = provinces.filter((province) => !seen.has(province.id)).map((province) => province.id);
    expect(unreachable).toEqual([]);
  });

  it("keeps the authored heart of the scenario authoritative over the derived graph", () => {
    // Settlements, garrison positions and hand-set control survive the merge.
    expect(byId.get("punic-italy-latium")?.settlements.map((settlement) => settlement.id)).toEqual(["settlement-rome"]);
    expect(byId.get("ita-72843720b81376294924159-sicily-northeast")?.positions?.map((position) => position.id))
      .toEqual(["position-mount-etna", "position-messana-strait"]);
    expect(byId.get("punic-italy-latium")?.controlFirmnessBps).toBe(9_000);
    expect(byId.get("ita-72843720b81376294924159-sicily-northeast")?.tier).toBe("focus");
  });

  it("carries no province name mangled by the source map's encoding", () => {
    const mangled = provinces.filter((province) => /Ã.|Â.|â€/u.test(province.name));
    expect(mangled.map((province) => province.name)).toEqual([]);
  });
});

describe("the age arrives in an order", () => {
  it("cannot reach the war over the strait until Messana has asked for a protector", () => {
    const pressures = punicWarsScenario.definition.historicalPressures ?? [];
    const war = pressures.find((pressure) => pressure.id === "the-strait-is-crossed")!;
    expect(war.when.afterPressureIds).toContain("messana-invites-a-protector");
    expect(pressures.some((pressure) => pressure.id === "messana-invites-a-protector")).toBe(true);
    // Both parties named by id, so the orchestrator opens the war between the
    // powers that exist rather than inventing one.
    expect(war.target.polityId).toBe("rome");
    expect(war.target.otherPolityId).toBe("carthage");
    expect(war.brief).toContain("agreement_open");
    // And it is unreachable once they are already fighting.
    expect(war.when.atPeace).toEqual([{ polityId: "rome", otherPolityId: "carthage" }]);
  });
});

/**
 * Every built-in scenario, checked against the rule the validator checks.
 *
 * This lives here rather than only in `validate-scenario.ts` because that
 * script runs against authored JSON on demand and has never once been pointed
 * at the built-in scenarios -- which is how eight forces went eight versions
 * with nobody undertaking to pay any of them.
 */
describe("every power's armies have someone answering for their wages", () => {
  for (const [name, scenario] of [["Punic Wars", punicWarsScenario], ["First Punic War", firstPunicWarScenario]] as const) {
    it(`leaves no army of the ${name} scenario outside the arrears rules`, () => {
      expect(findPayProblems(WorldStateSchema.parse(structuredClone(scenario.initialWorld)))).toEqual([]);
    });
  }

  it("leaves the Campanian legion at Rhegium unpaid, because nobody is paying them", () => {
    const legion = punicWarsScenario.initialWorld.material.forces.find((force) => force.id === "campanian-legion")!;
    expect(legion.payObligationId).toBeNull();
    // Not an omission: their own power keeps no chest to pay from, which is
    // what makes "nobody has undertaken to pay them" the true reading.
    expect(punicWarsScenario.initialWorld.material.accounts.some(
      (account) => account.owner.kind === "polity" && account.owner.id === legion.polityId,
    )).toBe(false);
  });
});
