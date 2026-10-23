import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, composeProposal, ensureMarkets, ensureProvinceMaterial, readAbroad, readTradeDesk } from "@chronica/shared";
import { TradeProposalForm } from "./trade-proposal";
import { TreatiesSheet } from "./treaties-sheet";

/**
 * Trade put in a letter, as the consul at the desk sees it: who decides the matter and why,
 * what may be proposed, terms that start from what stands, and no word of it agreed by sending.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = ensureMarkets(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const desk = readTradeDesk(world, "gaius-genucius", definition.government.offices);
const power = (id: string) => desk.powers.find((entry) => entry.polityId === id)!;
const form = (id: string, toId: string, toName: string, extra: Partial<Parameters<typeof TradeProposalForm>[0]> = {}) =>
  renderToStaticMarkup(<TradeProposalForm power={power(id)} toId={toId} toName={toName} posting={false} error={null} sent={null} onSend={() => undefined} {...extra} />);

describe("a proposal of trade in a letter", () => {
  it("says who decides the matter, and why, before a word is written", () => {
    const html = form("syracuse", "hieron-ii", "Hieron II");
    expect(html).toContain("Put trade to Kingdom of Syracuse");
    expect(html).toContain("Hieron II");
    expect(html).toContain("decides this");
    expect(html).not.toContain("does not. The letter may go");
  });

  it("says so, and offers the right man, when the one written to does not decide it", () => {
    const html = form("syracuse", "leptines-syracuse", "Leptines of Syracuse", { onWriteTo: () => undefined });
    expect(html).toContain("You are writing to Leptines of Syracuse, who does not");
    expect(html).toContain("Write to Hieron II instead");
  });

  it("starts a new pact from half the writer's customs and offers only what may be proposed", () => {
    const html = form("syracuse", "hieron-ii", "Hieron II");
    expect(html).toContain("A pact of trade");
    // Rome lays two and a half in a hundred: the lowest cap the desk suggests is three.
    expect(html).toContain('value="3"');
    // No pact stands with Syracuse to revise, and none has laid an embargo on Rome to lift.
    expect(html).toMatch(/disabled=""[^>]*\/>New terms for our pact/);
    expect(html).toContain("No pact stands between you to revise.");
    expect(html).toContain("has laid no embargo on you");
  });

  it("starts a revision from the pact in force", () => {
    const html = form("carthage", "carthage-suffete-34gglr", "Himilco son of Gisgo", { initialKind: "revise" });
    // Carthage's cap is five in a hundred; the revision starts one point tighter.
    expect(html).toContain('value="4"');
    expect(html).toContain("A pact already stands between you: revise it instead.");
  });

  it("says that sending agrees nothing, and that a notice of embargo shuts nothing", () => {
    expect(form("syracuse", "hieron-ii", "Hieron II")).toContain("Sending it agrees nothing");
    const notice = form("syracuse", "hieron-ii", "Hieron II", { initialKind: "embargo" });
    expect(notice).toContain("Nothing is shut by sending it");
    expect(notice).toContain("none chosen forbids every good");
  });

  it("writes the letter in the words of the age, with the terms said plainly", () => {
    const letter = composeProposal({ kind: "pact", trade: { tariffCapBps: 500, mostFavoured: true, exempt: ["grain"], goods: [] }, forDays: 1_825 }, "Syracuse", "We have long traded in grain.");
    expect(letter.letterKind).toBe("trade_offer");
    expect(letter.terms).toContain("We have long traded in grain.");
    expect(letter.terms).toContain("not pass 5 in a hundred");
    expect(letter.terms).toContain("5 years");
    const notice = composeProposal({ kind: "embargo", trade: { tariffCapBps: null, mostFavoured: false, exempt: [], goods: ["grain"] }, forDays: null, demand: "that you lower your customs" }, "Syracuse", "");
    expect(notice.letterKind).toBe("embargo_notice");
    expect(notice.terms).toContain("my markets will be shut to yours");
    expect(notice.terms).toContain("grain");
  });
});

describe("the treaties sheet offers to put trade to a power", () => {
  it("has a Propose trade beside Write to, for those who can give orders, and neither for those who cannot", () => {
    const state = readAbroad(world, "gaius-genucius", definition.government.offices);
    const withBoth = renderToStaticMarkup(<TreatiesSheet abroad={state} onWriteTo={() => undefined} onProposeTrade={() => undefined} />);
    expect(withBoth).toMatch(/Write to /);
    expect(withBoth).toMatch(/Propose (new terms of )?trade/);
    const without = renderToStaticMarkup(<TreatiesSheet abroad={state} />);
    expect(without).not.toMatch(/Propose (new terms of )?trade/);
  });
});
