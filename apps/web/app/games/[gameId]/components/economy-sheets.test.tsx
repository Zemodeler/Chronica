import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureMarkets, ensureProvinceMaterial, readTheBooks } from "@chronica/shared";
import { RegionsSheet, taxOrder } from "./regions-sheet";
import { TradeSheet } from "./trade-sheet";

/**
 * The regional and market pages of the treasury, drawn from the Punic opening
 * as the consul reads it: they render, say what stands, and offer a tax order
 * only to a reader with the fiscal power to give one.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = ensureMarkets(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const consul = readTheBooks(world, "gaius-genucius", definition.government.offices, "kept");
const citizen = readTheBooks(world, "manius-curius", definition.government.offices, "kept");

describe("the regions and the markets of the treasury", () => {
  it("is read for a consul who keeps the treasury, and not for a private man", () => {
    expect(consul.regions).not.toBeNull();
    expect(consul.trade).not.toBeNull();
    expect(consul.coin).not.toBeNull();
    expect(consul.regions!.canSet).toBe(true);
    expect(citizen.regions ?? null).toBeNull();
  });

  it("draws the lands region by region with the ordinary tributum, and a way to change it", () => {
    const html = renderToStaticMarkup(<RegionsSheet regions={consul.regions!} onDraft={() => undefined} />);
    expect(html).toContain("The lands of Roman Republic");
    expect(html).toContain("land levy");
    expect(html).toContain("Draft the order");
    expect(consul.regions!.regions.length).toBeGreaterThan(0);
  });

  it("offers no way to change the tax to a reader without the power", () => {
    const html = renderToStaticMarkup(<RegionsSheet regions={{ ...consul.regions!, canSet: false }} onDraft={() => undefined} />);
    expect(html).not.toContain("Draft the order");
    expect(html).toContain("Only those who hold the treasury");
  });

  it("writes the order a choice drafts in plain words", () => {
    expect(taxOrder({ kind: "province", name: "Capua", polity: "Rome" }, "tithe", 1_200)).toBe("Tax the province of Capua by a tithe of the harvest at 12 in a hundred.");
    expect(taxOrder({ kind: "polity", polity: "Rome" }, "land_levy", 1_000)).toContain("a land levy at 10 in a hundred");
  });

  it("draws the markets: bread in months, the six goods in the chief hubs, and the pacts in force", () => {
    const html = renderToStaticMarkup(<TradeSheet trade={consul.trade!} />);
    expect(html).toContain("Bread");
    for (const good of ["grain", "oil and wine", "metals", "timber and naval stores", "textiles and luxuries", "slaves"]) expect(html).toContain(good);
    expect(html).toContain("Trade pact with Carthage");
  });
});
