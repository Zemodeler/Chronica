import { describe, expect, it } from "vitest";
import { DynamicMapOverlaySchema } from "@chronica/shared";
import { PUNIC_WARS_CONTROL_MANIFEST, PUNIC_WARS_ROMAN_ALLIANCES, punicWarsOpeningOverlay } from "./punic-wars-map-territory";
import { punicWarsGeoJson } from "./punic-wars-geojson";

describe("Punic Wars opening political map", () => {
  it("has one checked controller for every in-scope province without tactical ties", () => {
    const ids = PUNIC_WARS_CONTROL_MANIFEST.map((record) => record.provinceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PUNIC_WARS_CONTROL_MANIFEST.length).toBeGreaterThan(250);
    expect(PUNIC_WARS_CONTROL_MANIFEST.every((record) => punicWarsGeoJson.features.some((feature) => feature.id === record.provinceId))).toBe(true);
    expect(PUNIC_WARS_ROMAN_ALLIANCES.every((relation) => relation.leaderPolityId === "rome")).toBe(true);
    expect(DynamicMapOverlaySchema.safeParse(punicWarsOpeningOverlay(0)).success).toBe(true);
  });

  it("leaves Rome's allies their own ground, and shows them as Rome's allies", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-italy-latium")).toBe("rome");
    expect(controller.get("punic-italy-campanian-plain")).toBe("rome");
    const allies = new Set(PUNIC_WARS_ROMAN_ALLIANCES.map((relation) => relation.memberPolityId));
    for (const provinceId of ["punic-italy-etrurian-uplands", "punic-italy-samnium", "punic-italy-lucanian-uplands", "punic-italy-bruttian-highlands", "punic-italy-apulian-coast"]) {
      expect(allies.has(controller.get(provinceId)!)).toBe(true);
    }
    // Messapia is free, and nobody's ally.
    expect(controller.get("punic-italy-sallentine-peninsula")).toBe("messapians");
    expect(allies.has("messapians")).toBe(false);
    const settlement = (id: string) => punicWarsOpeningOverlay(0).settlements.find((candidate) => candidate.settlementId === id)?.controllerPolityId;
    expect(settlement("settlement-venusia")).toBe("rome");
    expect(settlement("settlement-tarentum")).toBe("apulian-cities");
  });

  it("uses the added northern Italian local territories without changing their polity", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-italy-ligurian-coast")).toBe("ligurians");
    expect(controller.get("punic-italy-insubrian-plain")).toBe("insubres");
    expect(controller.get("punic-italy-middle-padus")).toBe("boii");
    expect(controller.get("punic-italy-venetian-lagoon")).toBe("veneti");
  });

  it("uses substantial Gaulish peoples rather than treating every local boundary as a polity", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-gaul-saone-et-loire")).toBe("gaul-aedui");
    expect(controller.get("punic-gaul-puy-de-dome")).toBe("gaul-arverni");
    expect(controller.get("punic-gaul-moselle")).toBe("gaul-treveri");
    const gaul = PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-gaul-"));
    expect(new Set(gaul.map((record) => record.controllerPolityId)).size).toBeLessThan(gaul.length / 4);
    // North of the Garonne the peoples were Celtic, not Aquitani.
    expect(controller.get("punic-gaul-charente")).toBe("gaul-santones");
    expect(controller.get("punic-gaul-landes")).toBe("gaul-aquitani");
    // No modern department is promoted to a polity of its own.
    expect(gaul.some((record) => ["gaul-marne", "gaul-vosges", "gaul-bas-rhin"].includes(record.controllerPolityId))).toBe(false);
  });

  it("keeps distinct northern and Balkan community owners where they remain politically meaningful", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    expect(controller.get("punic-illyria-xkx-2360587b5118871504069")).toBe("illyria-dardani");
    expect(controller.get("punic-thrace-odrysians")).toBe("thrace-odrysians");
    expect(controller.get("punic-belgica-menapii")).toBe("belgica-menapii");
    // The Batavi and Cananefates are 1st-century-BCE peoples; in 270 the delta is nobody's yet.
    expect(controller.get("punic-low-countries-batavi")).toBe("low-countries-rhine-delta");
    expect(controller.get("punic-germania-cherusci")).toBe("germania-cherusci");
    expect(controller.get("punic-hungary-hun-22733592b86637050333024")).toBe("pannonii");
    expect(controller.get("punic-czechoslovakia-cotini")).toBe("czechoslovakia-cotini");
    // One Treveri, on both banks of the Mosella.
    expect(controller.get("punic-luxembourg-treveri")).toBe("gaul-treveri");
    expect(controller.get("punic-germania-treveri")).toBe("gaul-treveri");
    expect(overlay.polities.map((polity) => polity.name)).toEqual(expect.arrayContaining(["Dardani", "Odrysians", "Menapii", "Rhine delta peoples", "Cherusci", "Pannonii", "Cotini", "Treveri"]));
    expect(overlay.polities.filter((polity) => polity.name === "Treveri")).toHaveLength(1);
  });

  it("uses substantial historical polities for grounded Austrian, Adriatic, British, and Greek local territories", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-austria-aut-97560089b12055607938436")).toBe("boii-middle-danube");
    expect(controller.get("punic-hungary-hun-22733592b30896182433416")).toBe("boii-middle-danube");
    expect(controller.get("punic-illyria-xkx-2360587b5118871504069")).toBe("illyria-dardani");
    // Thebes rejoined the Boeotian League c. 287.
    expect(controller.get("punic-greece-grc-local-53547021b64058474759409")).toBe("boeotian-league");
    expect(controller.get("punic-greece-grc-local-53547021b2738722376900")).toBe("athens");
    expect(controller.get("punic-greece-grc-local-53547021b92158672895518")).toBe("sparta");
    expect(controller.get("punic-greece-grc-local-53547021b34089236971204")).toBe("megalopolis");
    // Hungary, Illyria, and Britain remain many small local territories consolidated under few polities.
    for (const prefix of ["punic-hungary-", "punic-illyria-", "punic-britain-"] as const) {
      const records = PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith(prefix));
      expect(records).not.toHaveLength(0);
      expect(new Set(records.map((record) => record.controllerPolityId)).size).toBeLessThan(records.length / 2);
    }
    expect([...new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-greece-")).map((record) => record.controllerPolityId))]).toEqual(expect.arrayContaining([
      "macedon", "epirus", "acarnania", "aetolian-league", "boeotian-league", "athens", "elis", "messenia", "sparta", "megalopolis", "thracian-communities",
    ]));
  });

  it("gives every southern Greek city-state/league and every Aegean/Ionian island group exactly one region, while the north keeps several", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    const provincesByName = new Map(punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province" && feature.id.startsWith("punic-greece-")).map((feature) => [feature.properties.name, feature.id]));

    // Every southern/Aegean polity is backed by exactly one province.
    const SOUTHERN_AND_ISLAND_POLITIES: Readonly<Record<string, string>> = {
      Athens: "athens", Acarnania: "acarnania", Achaea: "achaean-league", Aetolia: "aetolian-league", Arcadia: "arcadian-league",
      Argos: "argos", Boeotia: "boeotian-league", Elis: "elis",
      Messenia: "messenia", Phocis: "phocian-league", Sparta: "sparta", Megalopolis: "megalopolis",
      "Eastern Crete": "cretan-cities-east", "Western Crete": "cretan-cities-west", Cyclades: "cycladic-islanders",
      Rhodes: "rhodes", Aeolis: "aeolis-communities", Ionia: "ionia-communities", "Ionian Islands": "ionian-islands",
    };
    for (const [regionName, polityId] of Object.entries(SOUTHERN_AND_ISLAND_POLITIES)) {
      const provinceId = provincesByName.get(regionName);
      expect(provinceId, `${regionName} should exist as its own province`).toBeDefined();
      expect(controller.get(provinceId!)).toBe(polityId);
    }
    expect(new Set(Object.values(SOUTHERN_AND_ISLAND_POLITIES)).size).toBe(Object.keys(SOUTHERN_AND_ISLAND_POLITIES).length);

    // A handful of absorbed (non-surviving) southern municipalities no longer exist as separate provinces.
    expect(overlay.provinces.some((province) => province.provinceId === "punic-greece-grc-local-53547021b91453036712640")).toBe(false); // Naxos, absorbed into Cyclades
    // Thessaloniki's own id survives, but only as Amphaxitis's (Macedon's) merged geometry, not as its own city-state.
    expect(controller.get("punic-greece-grc-local-53547021b56010870315220")).toBe("macedon");
    expect(provincesByName.get("Amphaxitis")).toBe("punic-greece-grc-local-53547021b56010870315220");

    expect(overlay.polities.map((polity) => polity.name)).toEqual(expect.arrayContaining(["Argos", "Arcadian cities", "Phocian League", "League of the Islanders", "Rhodes"]));
    // Acrocorinth, Chalcis and Thessaly were Antigonus Gonatas's; Thebes was Boeotian.
    for (const regionName of ["Corinthia", "Euboea"]) expect(controller.get(provincesByName.get(regionName)!)).toBe("macedon");
    expect(controller.get(provincesByName.get("Thebes")!)).toBe("boeotian-league");
    expect(overlay.polities.map((polity) => polity.name)).not.toEqual(expect.arrayContaining(["Corinthian League"]));
  });

  it("splits Macedon, Thessaly, Epirus, and Aegean Thrace into several broad sub-regions instead of one monolith or dozens of modern municipalities", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const provinceIds = new Set(overlay.provinces.map((province) => province.provinceId));
    const provincesByName = new Map(punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province" && feature.id.startsWith("punic-greece-")).map((feature) => [feature.properties.name, feature.id]));
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));

    const kingdoms: Readonly<Record<string, { polity: string; subregions: readonly string[] }>> = {
      macedon: { polity: "macedon", subregions: ["Upper Macedonia", "Bottiaea", "Pieria", "Amphaxitis", "Chalcidice", "Bisaltia"] },
      thessaly: { polity: "macedon", subregions: ["Perrhaebia", "Trikala", "Magnesia", "Sporades"] },
      epirus: { polity: "epirus", subregions: ["Molossia", "Thesprotia", "Ambracia", "Preveza"] },
      thrace: { polity: "thracian-communities", subregions: ["Xanthi", "Rodopi", "Evros", "Nestos"] },
    };
    for (const { polity, subregions } of Object.values(kingdoms)) {
      expect(subregions.length).toBeGreaterThanOrEqual(4);
      for (const subregion of subregions) {
        const provinceId = provincesByName.get(subregion);
        expect(provinceId, `${subregion} should exist as its own province`).toBeDefined();
        expect(controller.get(provinceId!)).toBe(polity);
      }
    }
    // The four kingdoms no longer appear as one single monolithic province each.
    expect(provincesByName.has("Macedon")).toBe(false);
    expect(provincesByName.has("Thessaly")).toBe(false);
    expect(provincesByName.has("Epirus")).toBe(false);
    expect(provincesByName.has("Aegean Thrace")).toBe(false);
    // Absorbed (non-surviving) municipalities no longer exist as separate provinces.
    expect(provinceIds.has("punic-greece-grc-local-53547021b33840684001600")).toBe(false); // Zitsa, absorbed into Molossia
    expect(provinceIds.has("punic-greece-grc-local-53547021b82210761635723")).toBe(false); // Kalamaria, absorbed into Amphaxitis
  });

  it("consolidates Germania and Romania into attested regional powers, and gives Iberia its own peoples", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-germania-teutoburg")).toBe("germania-cherusci");
    expect(controller.get("punic-iberia-castilla-y-leon")).toBe("iberia-vaccei");
    expect(controller.get("punic-thrace-cluj")).toBe("thrace-dacian-highland-communities");
    expect(controller.get("punic-thrace-bucuresti")).toBe("thrace-getae");
    expect(new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-germania-")).map((record) => record.controllerPolityId)).size).toBeLessThan(15);
    // Before 237 Carthage held no Iberian territory: the south and east are Iberian peoples.
    expect(controller.get("punic-iberia-andalucia")).toBe("iberia-turdetani");
    expect(controller.get("punic-iberia-comunitat-valenciana")).toBe("iberia-edetani");
    expect(controller.get("punic-iberia-region-de-murcia")).toBe("iberia-contestani");
    expect(controller.get("punic-iberia-illes-balears")).toBe("balearic-islanders");
    expect(PUNIC_WARS_CONTROL_MANIFEST.some((record) => record.controllerPolityId.startsWith("iberia-ciudad-") || record.controllerPolityId === "iberia-illes-balears")).toBe(false);
    // The Suebi reached the south-west only with Ariovistus.
    expect(PUNIC_WARS_CONTROL_MANIFEST.some((record) => record.controllerPolityId === "germania-suebi")).toBe(false);
    expect(controller.get("punic-germania-neckar-uplands")).toBe("helvetian-peoples");
    expect(new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-thrace-")).map((record) => record.controllerPolityId)).size).toBeLessThan(15);
  });

  it("gives the African and Alpine map actors explicit owners and settlement markers", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    expect(controller.get("dza-43142294b54486011126442")).toBe("numidian-kingdoms");
    expect(controller.get("lby-10800210b23470577588067")).toBe("cyrene");
    // Al Qubbah lies east of Cyrene itself, far past the Arae Philaenorum border.
    expect(controller.get("lby-10800210b44488917334986")).toBe("cyrene");
    expect(controller.get("che-70761945b78940680080703")).toBe("helvetian-peoples");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-utica")?.controllerPolityId).toBe("carthage");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-cirta")?.capitalPolityId).toBe("numidian-kingdoms");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-cyrene")?.capitalPolityId).toBe("cyrene");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-pella")?.capitalPolityId).toBe("macedon");
  });

  it("gives Carthage its islands, its African heartland and the Punic coast, and nothing inland", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("ita-72843720b81376294924159")).toBe("carthage");
    expect(controller.get("punic-gaul-corse-du-sud")).toBe("carthage");
    expect(controller.get("dza-43142294b62233719624556")).toBe("carthage"); // Annaba, Hippo Regius
    expect(controller.get("dza-43142294b64913925424016")).toBe("numidian-kingdoms"); // Tlemcen
    expect(controller.get("tun-13205935b95771050896452")).toBe("gaetuli"); // Tozeur
    expect(controller.get("mar-70788906b66040098455254")).toBe("mauretanian-peoples"); // Tingis
    // Towns held against their hinterland: Gades and Ebusus are Punic, Numantia Celtiberian.
    const settlementController = (id: string) => overlay.settlements.find((settlement) => settlement.settlementId === id)?.controllerPolityId;
    expect(settlementController("settlement-gades")).toBe("carthage");
    expect(settlementController("settlement-ebusus")).toBe("carthage");
    expect(settlementController("settlement-numantia")).toBe("iberia-celtiberi");
    expect(overlay.settlements.some((settlement) => ["settlement-carthago-nova", "settlement-bibracte", "settlement-gergovia"].includes(settlement.settlementId))).toBe(false);
    expect(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-britain-")).every((record) => record.confidence === "cautious")).toBe(true);
  });

  it("assigns terrain by local geography and marks Rhegium, which the Campanians hold", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const terrain = new Map(overlay.provinces.map((province) => [province.provinceId, province.terrainId]));
    expect(terrain.get("lby-10800210b2800497533490")).toBe("desert-steppe");
    expect(terrain.get("punic-gaul-puy-de-dome")).toBe("hills-uplands");
    expect(terrain.get("punic-germania-erzgebirge")).toBe("mountain-pass");
    expect(terrain.get("punic-germania-cimbri")).toBe("coastal-plain");
    // Rhegium is a place the Republic can march on now that the Campanian
    // mutineers hold it as their own power, so the map has to show it: a
    // besiegeable town nobody can see is a town nobody will besiege.
    expect(overlay.settlements.some((settlement) => settlement.settlementId === "settlement-rhegium" || settlement.name === "Rhegium")).toBe(true);
  });

  it("gives every reformed French, Iberian, Italian, Balkan, British, Greek, and Romanian territory one opening controller", () => {
    const controller = new Set(PUNIC_WARS_CONTROL_MANIFEST.map((record) => record.provinceId));
    const reformed = punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province" && [
      "punic-gaul-", "punic-iberia-", "punic-italy-", "punic-hungary-", "punic-illyria-", "punic-thrace-", "punic-austria-", "punic-britain-", "punic-greece-",
    ].some((prefix) => feature.id.startsWith(prefix)));
    expect(reformed.length).toBeGreaterThan(150);
    expect(reformed.every((feature) => controller.has(feature.id))).toBe(true);
  });
});
