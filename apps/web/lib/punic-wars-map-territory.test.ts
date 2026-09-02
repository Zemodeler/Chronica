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
    expect(PUNIC_WARS_ROMAN_ALLIANCES).toEqual([]);
    expect(DynamicMapOverlaySchema.safeParse(punicWarsOpeningOverlay(0)).success).toBe(true);
  });

  it("makes Roman client regions direct territory of the Roman Republic", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    for (const provinceId of ["punic-italy-etrurian-uplands", "punic-italy-samnium", "punic-italy-lucanian-uplands", "punic-italy-bruttian-highlands", "punic-italy-apulian-coast"]) {
      expect(controller.get(provinceId)).toBe("rome");
    }
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
    expect(new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-gaul-")).map((record) => record.controllerPolityId)).size).toBeLessThan(20);
  });

  it("keeps distinct northern and Balkan community owners where they remain politically meaningful", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    expect(controller.get("punic-illyria-xkx-2360587b5118871504069")).toBe("illyria-dardani");
    expect(controller.get("punic-thrace-odrysians")).toBe("thrace-odrysians");
    expect(controller.get("punic-belgica-menapii")).toBe("belgica-menapii");
    expect(controller.get("punic-low-countries-batavi")).toBe("low-countries-batavi");
    expect(controller.get("punic-germania-cherusci")).toBe("germania-cherusci");
    expect(controller.get("punic-hungary-hun-22733592b86637050333024")).toBe("pannonii");
    expect(controller.get("punic-czechoslovakia-cotini")).toBe("czechoslovakia-cotini");
    expect(controller.get("punic-luxembourg-treveri")).toBe("germania-treveri");
    expect(overlay.polities.map((polity) => polity.name)).toEqual(expect.arrayContaining(["Dardani", "Odrysians", "Menapii", "Batavi", "Cherusci", "Pannonii", "Cotini", "Treveri"]));
  });

  it("uses substantial historical polities for grounded Austrian, Adriatic, British, and Greek local territories", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-austria-aut-97560089b12055607938436")).toBe("boii-middle-danube");
    expect(controller.get("punic-hungary-hun-22733592b30896182433416")).toBe("boii-middle-danube");
    expect(controller.get("punic-illyria-xkx-2360587b5118871504069")).toBe("illyria-dardani");
    expect(controller.get("punic-greece-grc-local-53547021b64058474759409")).toBe("thebes");
    expect(controller.get("punic-greece-grc-local-53547021b2738722376900")).toBe("athens");
    expect(controller.get("punic-greece-grc-local-53547021b92158672895518")).toBe("sparta");
    expect(controller.get("punic-greece-grc-local-53547021b34089236971204")).toBe("megalopolis");
    const groups = ["punic-hungary-", "punic-illyria-", "punic-britain-", "punic-greece-"] as const;
    for (const prefix of groups) {
      const records = PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith(prefix));
      expect(records).not.toHaveLength(0);
      expect(new Set(records.map((record) => record.controllerPolityId)).size).toBeLessThan(records.length / 2);
    }
    expect([...new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-greece-")).map((record) => record.controllerPolityId))]).toEqual(expect.arrayContaining([
      "macedon", "epirus", "acarnania", "aetolian-league", "boeotian-league", "thebes", "athens", "elis", "messenia", "sparta", "megalopolis", "thracian-communities",
    ]));
  });

  it("gives the southern Greek mainland and the Aegean their own fragmented polities rather than one catch-all bucket", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    // Central/southern mainland leagues and city-states carved out of the old achaean-league catch-all.
    expect(controller.get("punic-greece-grc-local-53547021b76628339296380")).toBe("argos"); // Argos-Mykines
    expect(controller.get("punic-greece-grc-local-53547021b7583828069802")).toBe("corinthian-league"); // Corinth
    expect(controller.get("punic-greece-grc-local-53547021b21928215171810")).toBe("arcadian-league"); // Tripoli
    expect(controller.get("punic-greece-grc-local-53547021b62210225540795")).toBe("phocian-league"); // Delphi
    expect(controller.get("punic-greece-grc-local-53547021b4929221298038")).toBe("euboean-cities"); // Chalcis
    // The Aegean and Ionian Sea are fragmented into several island polities, not one "hellenic-islanders" blob.
    expect(controller.get("punic-greece-grc-local-53547021b4893314686518")).toBe("ionian-islands"); // Corfu
    expect(controller.get("punic-greece-grc-local-53547021b91453036712640")).toBe("cycladic-islanders"); // Naxos and Lesser Cyclades
    expect(controller.get("punic-greece-grc-local-53547021b33259065854290")).toBe("dodecanese-islanders"); // Rhodes
    expect(controller.get("punic-greece-grc-local-53547021b48314635979132")).toBe("aeolis-communities"); // Lesbos
    expect(controller.get("punic-greece-grc-local-53547021b1583318227364")).toBe("ionia-communities"); // Samos
    expect(controller.get("punic-greece-grc-local-53547021b22915983963117")).toBe("cretan-cities-east"); // Heraklion
    expect(controller.get("punic-greece-grc-local-53547021b84334822638882")).toBe("cretan-cities-west"); // Chania
    const greekPolities = new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-greece-")).map((record) => record.controllerPolityId));
    expect(greekPolities.size).toBeGreaterThan(20);
    expect(overlay.polities.map((polity) => polity.name)).toEqual(expect.arrayContaining(["Argos", "Corinthian League", "Arcadian League", "Phocian League", "Euboean cities"]));
  });

  it("merges Macedon, Thessaly, Epirus, and Aegean Thrace into single broad provinces instead of dozens of modern municipalities", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const provinceIds = new Set(overlay.provinces.map((province) => province.provinceId));
    const byName = new Map(punicWarsGeoJson.features.filter((feature) => feature.properties.kind === "province" && feature.id.startsWith("punic-greece-")).map((feature) => [feature.properties.name, feature.id]));
    expect(byName.get("Macedon")).toBe("punic-greece-grc-local-53547021b48713005805080");
    expect(byName.get("Thessaly")).toBe("punic-greece-grc-local-53547021b50324925273652");
    expect(byName.get("Epirus")).toBe("punic-greece-grc-local-53547021b74781806510115");
    expect(byName.get("Aegean Thrace")).toBe("punic-greece-grc-local-53547021b38986077120400");
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    expect(controller.get("punic-greece-grc-local-53547021b48713005805080")).toBe("macedon");
    expect(controller.get("punic-greece-grc-local-53547021b50324925273652")).toBe("thessalian-league");
    expect(controller.get("punic-greece-grc-local-53547021b74781806510115")).toBe("epirus");
    expect(controller.get("punic-greece-grc-local-53547021b38986077120400")).toBe("thracian-communities");
    // Absorbed municipalities (Trikala into Thessaly, Ioannina's Zitsa into Epirus, Thessaloniki's Kalamaria into Macedon) no longer exist as separate provinces.
    expect(provinceIds.has("punic-greece-grc-local-53547021b2020511099741")).toBe(false);
    expect(provinceIds.has("punic-greece-grc-local-53547021b33840684001600")).toBe(false);
    expect(provinceIds.has("punic-greece-grc-local-53547021b82210761635723")).toBe(false);
  });

  it("consolidates Germania, Iberia, and Romania into attested regional powers", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("punic-germania-teutoburg")).toBe("germania-cherusci");
    expect(controller.get("punic-iberia-castilla-y-leon")).toBe("iberia-vaccei");
    expect(controller.get("punic-thrace-cluj")).toBe("thrace-dacian-highland-communities");
    expect(controller.get("punic-thrace-bucuresti")).toBe("thrace-getae");
    expect(new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-germania-")).map((record) => record.controllerPolityId)).size).toBeLessThan(15);
    expect(new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-iberia-")).map((record) => record.controllerPolityId)).size).toBeLessThan(15);
    expect(new Set(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-thrace-")).map((record) => record.controllerPolityId)).size).toBeLessThan(15);
  });

  it("gives the African and Alpine map actors explicit owners and settlement markers", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const controller = new Map(overlay.provinces.map((province) => [province.provinceId, province.controllerPolityId]));
    expect(controller.get("dza-43142294b54486011126442")).toBe("numidian-kingdoms");
    expect(controller.get("lby-10800210b23470577588067")).toBe("ptolemaic-cyrenaica");
    expect(controller.get("che-70761945b78940680080703")).toBe("helvetian-peoples");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-utica")?.controllerPolityId).toBe("carthage");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-cirta")?.capitalPolityId).toBe("numidian-kingdoms");
    expect(overlay.settlements.find((settlement) => settlement.settlementId === "settlement-cyrene")?.capitalPolityId).toBe("ptolemaic-cyrenaica");
  });

  it("uses the supplied Carthaginian opening extent for its island, African, and southern Iberian holdings", () => {
    const controller = new Map(PUNIC_WARS_CONTROL_MANIFEST.map((record) => [record.provinceId, record.controllerPolityId]));
    expect(controller.get("ita-72843720b81376294924159")).toBe("carthage");
    expect(controller.get("punic-gaul-corse-du-sud")).toBe("carthage");
    expect(controller.get("punic-iberia-andalucia")).toBe("carthage");
    expect(controller.get("punic-iberia-region-de-murcia")).toBe("carthage");
    expect(PUNIC_WARS_CONTROL_MANIFEST.filter((record) => record.provinceId.startsWith("punic-britain-")).every((record) => record.confidence === "cautious")).toBe(true);
  });

  it("assigns terrain by local geography and omits the Rhegium city marker", () => {
    const overlay = punicWarsOpeningOverlay(0);
    const terrain = new Map(overlay.provinces.map((province) => [province.provinceId, province.terrainId]));
    expect(terrain.get("lby-10800210b2800497533490")).toBe("desert-steppe");
    expect(terrain.get("punic-gaul-puy-de-dome")).toBe("hills-uplands");
    expect(terrain.get("punic-germania-erzgebirge")).toBe("mountain-pass");
    expect(terrain.get("punic-germania-cimbri")).toBe("coastal-plain");
    expect(overlay.settlements.some((settlement) => settlement.settlementId === "settlement-rhegium" || settlement.name === "Rhegium")).toBe(false);
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
