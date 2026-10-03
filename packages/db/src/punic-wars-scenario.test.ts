import { describe, expect, it } from "vitest";
import { FERRY_GATHER_KM, findPayProblems, kmBetween, WorldStateSchema } from "@chronica/shared";
import { readFileSync } from "node:fs";
import { firstPunicWarScenario, FIRST_PUNIC_IDS } from "./built-in-scenarios";
import { punicWarsScenario } from "./punic-wars-scenario";
import { PUNIC_IDS } from "./punic-ids";
import { POLITY_META, PUNIC_OLD_REGION_PROVINCES, PUNIC_WARS_GRAPH_POLITIES } from "./punic-wars-map-graph";

describe("Punic Wars built-in scenario", () => {
  it("opens in 270 BCE as a tense peace with the Messana crisis", () => {
    expect(punicWarsScenario.definition.clock.epoch).toMatchObject({ year: 270, month: 3, day: 1, era: "BCE" });
    expect(punicWarsScenario.initialWorld.conflicts.wars).toEqual([]);
    expect(punicWarsScenario.initialWorld.storylines?.map((storyline) => storyline.id)).toContain("mamertine-syracusan-crisis");
    expect(punicWarsScenario.initialWorld.map.politicalRelations).toEqual([]);
  });

  it("keeps the four key actors and their historical capitals in authoritative state", () => {
    expect(punicWarsScenario.initialWorld.map.polities.filter((polity) => ["rome", "carthage", "syracuse", "mamertines"].includes(polity.id))).toHaveLength(4);
    // Five armies in the west -- the four powers' own, and the Campanian legion
    // holding Rhegium against the Republic -- three in the Hellenistic east,
    // and the ships that decide who can cross to Sicily at all. Only the
    // Campanians and the Mamertines are foot and nothing else now (v42). The
    // consul's army is half allies, as a consular army was, drawn up as a
    // legion and an ala.
    const forces = punicWarsScenario.initialWorld.material.forces;
    expect(forces.filter((force) => force.personnel.every((category) => category.categoryId === "infantry")).map((force) => force.id).sort()).toEqual(["campanian-legion", "mamertine-garrison"]);
    expect(forces.find((force) => force.id === "roman-field-army")!.personnel.map((category) => category.label)).toEqual([
      "Hastati of Legio I", "Principes of Legio I", "Triarii of Legio I", "Velites of Legio I", "Equites of Legio I",
      "Allied cohorts of the first Ala of the allies", "Extraordinarii of the first Ala of the allies", "Allied horse of the first Ala of the allies",
    ]);
    // Three war fleets, and the allied Greek hulls, which carry and do not fight.
    expect(forces.filter((force) => force.personnel.some((category) => category.categoryId === "warship"))).toHaveLength(3);
    expect(forces.find((force) => force.id === "allied-greek-hulls")?.personnel.map((category) => category.categoryId)).toEqual(["transport"]);
  });

  it("makes Sicily an island", () => {
    // Authored as land edges because nothing could tell the difference, so a
    // legion walked to Sicily and a naval war needed no ships.
    const { edges } = punicWarsScenario.initialWorld.map;
    const crossing = (from: string, to: string): string | undefined =>
      edges.find((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))?.crossing;
    expect(crossing(PUNIC_IDS.rhegium, PUNIC_IDS.messana)).toBe("strait");

    // Nothing on foot gets from Messana to Rome or from Carthage to Lilybaeum...
    const roads = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.crossing !== "land" && edge.crossing !== "pass") continue;
      roads.set(edge.from, [...(roads.get(edge.from) ?? []), edge.to]);
      roads.set(edge.to, [...(roads.get(edge.to) ?? []), edge.from]);
    }
    const onFoot = (start: string): Set<string> => {
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length > 0) {
        for (const next of roads.get(queue.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
      return seen;
    };
    const fromMessana = onFoot(PUNIC_IDS.messana);
    expect(fromMessana.has(PUNIC_IDS.lilybaeum)).toBe(true);
    expect(fromMessana.has(PUNIC_IDS.rome)).toBe(false);
    expect(fromMessana.has(PUNIC_IDS.carthage)).toBe(false);
    // ...and Africa is joined to Sicily by sea lanes.
    const africa = onFoot(PUNIC_IDS.carthage);
    expect(africa.has(PUNIC_IDS.lilybaeum)).toBe(false);
    expect(edges.some((edge) => edge.crossing === "sea_lane" && ((africa.has(edge.from) && fromMessana.has(edge.to)) || (africa.has(edge.to) && fromMessana.has(edge.from))))).toBe(true);
  });

  it("holds Messana for the Mamertines and Rhegium's town for the Campanian legion", () => {
    const { provinces } = punicWarsScenario.initialWorld.map;
    const messana = provinces.find((province) => province.id === PUNIC_IDS.messana)!;
    expect(messana.controllerPolityId).toBe("mamertines");
    expect(messana.settlements.find((settlement) => settlement.id === "settlement-messana")?.controllerPolityId).toBe("mamertines");
    const rhegium = provinces.find((province) => province.id === PUNIC_IDS.rhegium)!;
    expect(rhegium.settlements.find((settlement) => settlement.id === "settlement-rhegium")?.controllerPolityId).toBe("rhegium-campanians");
    // Its province is the Bruttians' ground, as the Sila always was.
    expect(rhegium.controllerPolityId).toBe("bruttians");
  });

  it("keeps Hanno at Carthage, Hieron at Syracuse and the Mamertine garrison at Messana", () => {
    const { characters, material } = punicWarsScenario.initialWorld;
    const at = (id: string) => characters.find((character) => character.id === id)!.locationProvinceId;
    expect(at("hanno-carthage")).toBe(PUNIC_IDS.carthage);
    expect(at("hieron-ii")).toBe(PUNIC_IDS.syracuse);
    expect(at("gaius-genucius")).toBe(PUNIC_IDS.rome);
    expect(material.forces.find((force) => force.id === "mamertine-garrison")!.locationId).toBe(PUNIC_IDS.messana);
    expect(material.forces.find((force) => force.id === "roman-field-army")!.locationId).toBe(PUNIC_IDS.rome);
  });

  it("governs Latium and Campania from Rome, and the rest of Italy through allies bound by foedus", () => {
    const world = punicWarsScenario.initialWorld;
    const controller = new Map(world.map.provinces.map((province) => [province.id, province.controllerPolityId]));
    expect(controller.get(PUNIC_IDS.rome)).toBe("rome");
    expect(controller.get(PUNIC_IDS.capua)).toBe("rome");
    expect(controller.get(PUNIC_IDS.volsinii)).toBe("etruscan-cities");
    expect(controller.get(PUNIC_IDS.bovianum)).toBe("samnites");
    expect(controller.get(PUNIC_IDS.brundisium)).toBe("messapians");
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
      provinceId: PUNIC_IDS.felsina,
      controllerPolityId: "boii",
    });
    expect(settlements.get("settlement-volsinii")).toMatchObject({
      provinceId: PUNIC_IDS.volsinii,
      controllerPolityId: "etruscan-cities",
    });
    // Rome's Latin colonies stand inside its allies' land as its own.
    expect(settlements.get("settlement-luceria")).toMatchObject({ controllerPolityId: "rome" });
    expect(settlements.get("settlement-luceria")!.provinceId).not.toBe(PUNIC_IDS.tarentum);
    expect(settlements.get("settlement-lilybaeum")?.provinceId).toBe(PUNIC_IDS.lilybaeum);
    expect(settlements.get("settlement-panormus")?.provinceId).toBe(PUNIC_IDS.panormus);
  });

  it("keeps the towns the story is about at the size and walls the story needs", () => {
    const towns = new Map(punicWarsScenario.initialWorld.map.provinces.flatMap((province) => province.settlements.map((settlement) => [settlement.id, settlement] as const)));
    expect(towns.get("settlement-rome")).toMatchObject({ kind: "city", size: 100, fortificationLevel: 6 });
    expect(towns.get("settlement-volsinii")).toMatchObject({ kind: "city", size: 35, fortificationLevel: 4 });
    // Ports, so that a merchant of Syracuse can trade to Messana by sea.
    expect(towns.get("settlement-syracuse")).toMatchObject({ kind: "port", size: 90, fortificationLevel: 5 });
    expect(towns.get("settlement-messana")).toMatchObject({ kind: "port", size: 50, fortificationLevel: 3 });
    // The map's other towns keep the map's own sizes.
    expect(towns.get("settlement-athens")!.size).toBeGreaterThan(0);
  });

  it("holds every place the scenario and its tests name, each in the province with its town", () => {
    const provinces = new Map(punicWarsScenario.initialWorld.map.provinces.map((province) => [province.id, province]));
    for (const [place, id] of Object.entries(PUNIC_IDS)) expect(provinces.has(id), `${place} is a province of the map`).toBe(true);
    const townOf: Record<string, string> = {
      rome: "settlement-rome", capua: "settlement-capua", volsinii: "settlement-volsinii", iguvium: "settlement-iguvium", asculum: "settlement-asculum",
      corfinium: "settlement-corfinium", bovianum: "settlement-bovianum", tarentum: "settlement-tarentum", grumentum: "settlement-grumentum",
      rhegium: "settlement-rhegium", brundisium: "settlement-brundisium", genua: "settlement-genua", mediolanum: "settlement-mediolanum",
      felsina: "settlement-bononia", patavium: "settlement-patavium", carthage: "settlement-carthage", lilybaeum: "settlement-lilybaeum",
      panormus: "settlement-panormus", agrigentum: "settlement-agrigentum", syracuse: "settlement-syracuse", messana: "settlement-messana",
    };
    for (const [place, settlementId] of Object.entries(townOf)) {
      expect(provinces.get(PUNIC_IDS[place as keyof typeof PUNIC_IDS])!.settlements.map((settlement) => settlement.id), place).toContain(settlementId);
    }
  });

  it("keeps the ground the story is about in the hands the story says", () => {
    const controller = new Map(punicWarsScenario.initialWorld.map.provinces.map((province) => [province.id, province.controllerPolityId]));
    const heldBy = (region: string, polityId: string): number => (PUNIC_OLD_REGION_PROVINCES[region] ?? []).filter((id) => controller.get(id) === polityId).length;
    // The old Latium and Campania were Rome's, but for a few border provinces.
    expect(heldBy("punic-italy-latium", "rome")).toBeGreaterThanOrEqual(35);
    expect(heldBy("punic-italy-campanian-plain", "rome")).toBeGreaterThanOrEqual(30);
    expect(controller.get(PUNIC_IDS.carthage)).toBe("carthage");
    expect(controller.get(PUNIC_IDS.syracuse)).toBe("syracuse");
  });

  it("keeps the second scenario's own ids on its own map", () => {
    const provinces = new Set(firstPunicWarScenario.initialWorld.map.provinces.map((province) => province.id));
    for (const [place, id] of Object.entries(FIRST_PUNIC_IDS)) expect(provinces.has(id), `${place} is a province of the Numidian Decision`).toBe(true);
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

  it("leaves unowned exactly the open desert: desert-steppe with no town in it", () => {
    const unowned = provinces.filter((province) => province.controllerPolityId === null);
    expect(unowned.length).toBeGreaterThan(0);
    expect(unowned.filter((province) => province.terrainId !== "desert-steppe" || province.settlements.length > 0).map((province) => province.id)).toEqual([]);
    // And it is never a place the story stands in.
    for (const place of Object.values(PUNIC_IDS)) expect(byId.get(place)!.controllerPolityId, place).not.toBeNull();
  });

  it("carries every owned province with a declared holder", () => {
    expect(provinces.length).toBeGreaterThan(4_000);
    expect(new Set(provinces.map((province) => province.id)).size).toBe(provinces.length);
    // Every province knows how big it is, and where.
    expect(provinces.filter((province) => province.areaKm2 === undefined || province.geo === undefined).map((province) => province.id)).toEqual([]);

    const polityIds = new Set(world.map.polities.map((polity) => polity.id));
    const undeclared = provinces.filter((province) => province.controllerPolityId !== null && !polityIds.has(province.controllerPolityId));
    expect(undeclared.map((province) => province.id)).toEqual([]);
    // Every polity the map lists, and the four the scenario writes out beside them.
    expect(world.map.polities.length).toBeGreaterThanOrEqual(PUNIC_WARS_GRAPH_POLITIES.length);
  });

  it("gives Anatolia its powers, each holding ground and a government", () => {
    const holders = new Map<string, number>();
    for (const province of provinces) if (province.controllerPolityId !== null) holders.set(province.controllerPolityId, (holders.get(province.controllerPolityId) ?? 0) + 1);
    const anatolian = ["seleucid-empire", "ptolemaic-egypt", "pergamon", "bithynia", "pontus", "cappadocia", "armenia", "paphlagonia", "colchis", "pisidia-isauria", "heraclea-pontica",
      "hellespont-propontic-cities", "euxine-greek-cities", "galatians-tolistobogii", "galatians-tectosages", "galatians-trocmi"];
    for (const id of anatolian) {
      expect(holders.get(id) ?? 0, `${id} holds a province`).toBeGreaterThanOrEqual(1);
      expect(world.map.polities.find((polity) => polity.id === id)?.governmentForm, `${id} has a government`).toBeTruthy();
    }
    // A kingdom's cohesion is the map's; a tribal confederation's is low.
    expect(world.map.polities.find((polity) => polity.id === "seleucid-empire")!.cohesionBps).toBe(5_500);
    expect(world.map.polities.find((polity) => polity.id === "galatians-trocmi")!.cohesionBps).toBe(2_500);
  });

  it("gives the east its powers too, each with ground, a cohesion and a government of its own", () => {
    const holders = new Set(provinces.map((province) => province.controllerPolityId));
    const east = ["armenia", "atropatene", "caspian-peoples", "caucasian-albania", "caucasian-iberia", "gerrha", "hejaz-tribes", "ituraeans", "judea", "kush", "lihyan",
      "makran-tribes", "marsh-peoples", "scenitae-arabs", "zagros-tribes", "minaeans", "nabataeans", "najd-tribes", "qedar", "saba"];
    for (const id of east) {
      const polity = world.map.polities.find((candidate) => candidate.id === id);
      expect(polity, `${id} is a polity of the world`).toBeDefined();
      expect(holders.has(id), `${id} holds a province`).toBe(true);
      expect(polity!.governmentForm, `${id} has a government`).toBeTruthy();
      expect(polity!.cohesionBps).toBe(POLITY_META[id]!.cohesionBps);
    }
    expect(world.map.polities.find((polity) => polity.id === "judea")!.governmentForm).toBe("temple_state");
  });

  it("seats the known kings of Anatolia in their chairs", () => {
    const seated = (polityId: string) => world.characters.find((character) => character.polityId === polityId && character.officeId?.startsWith(`${polityId}:`))?.name;
    expect(seated("seleucid-empire")).toBe("Antiochus I Soter");
    expect(seated("ptolemaic-egypt")).toBe("Ptolemy II Philadelphus");
    expect(seated("pergamon")).toBe("Philetaerus");
    expect(seated("bithynia")).toBe("Nicomedes I");
    expect(seated("pontus")).toBe("Mithridates I Ktistes");
    expect(seated("caucasian-iberia")).toBe("Pharnavaz I");
    // In the province holding the capital, which is Pergamon itself.
    const philetaerus = world.characters.find((character) => character.name === "Philetaerus")!;
    expect(byId.get(philetaerus.locationProvinceId!)!.settlements.some((settlement) => settlement.id === "settlement-pergamon")).toBe(true);
  });

  it("puts every fleet in a port on the sea, near the army it would carry", () => {
    const fleets = world.material.forces.filter((force) => force.personnel.some((category) => category.categoryId === "warship"));
    expect(fleets.length).toBeGreaterThan(0);
    for (const fleet of fleets) {
      const province = byId.get(fleet.locationId)!;
      expect(province.terrainId, `${fleet.name} lies in ${province.name}`).toBe("coastal-plain");
    }
    // The Carthaginian fleet lies in Lilybaeum's harbour, and the garrison it would carry stands within the reach of the ships sent for.
    const lilybaeum = byId.get(PUNIC_IDS.lilybaeum)!;
    expect(lilybaeum.terrainId).toBe("coastal-plain");
    expect(lilybaeum.settlements.find((settlement) => settlement.id === "settlement-lilybaeum")?.kind).toBe("port");
    expect(world.material.forces.find((force) => force.id === "carthaginian-fleet")!.locationId).toBe(PUNIC_IDS.lilybaeum);
    expect(kmBetween(world, PUNIC_IDS.carthage, PUNIC_IDS.lilybaeum)).toBeLessThanOrEqual(FERRY_GATHER_KM);
  });

  it("names every province differently", () => {
    const seen = new Map<string, string>();
    const clashes = provinces.filter((province) => {
      const other = seen.get(province.name);
      seen.set(province.name, province.id);
      return other !== undefined;
    });
    expect(clashes.map((province) => province.name)).toEqual([]);
  });

  it("declares the province count of the asset it is drawn on", () => {
    const geojson = JSON.parse(readFileSync(new URL("../../../apps/web/public/maps/punic-wars-provinces.geojson", import.meta.url), "utf8")) as { features: { id: string; properties: { kind: string } }[] };
    const drawn = geojson.features.filter((feature) => feature.properties.kind === "province").map((feature) => feature.id).sort();
    expect(drawn).toEqual(provinces.map((province) => province.id).sort());
    const { min, max } = punicWarsScenario.definition.map.provinceCount;
    expect([min, max]).toEqual([drawn.length, drawn.length]);
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
    // Brixia now gives the Cenomani their historical seat as well. Every
    // declared power holds a city or ground it can actually act on.
    const landless = world.map.polities.filter((polity) => !held.has(polity.id)).map((polity) => polity.id);
    expect(landless).toEqual([]);
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
    const seen = new Set<string>([PUNIC_IDS.rome]);
    const queue: string[] = [PUNIC_IDS.rome];
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

  it("keeps Rome's town in Rome's province, and Etna and the strait in Messana's", () => {
    expect(byId.get(PUNIC_IDS.rome)?.settlements.map((settlement) => settlement.id)).toEqual(["settlement-rome"]);
    expect(byId.get(PUNIC_IDS.messana)?.positions?.map((position) => position.id))
      .toEqual(["position-mount-etna", "position-messana-strait"]);
    expect(provinces.filter((province) => (province.positions ?? []).length > 0).map((province) => province.id)).toEqual([PUNIC_IDS.messana]);
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
