import { describe, expect, it } from "vitest";
import {
  HouseKindSchema,
  economyOf,
  firmCultureOf,
  firmNameFor,
  firmTitle,
  modernWordsIn,
  type FirmCulture,
  type WorldState,
} from "@chronica/shared";
import { foundTheHouse } from "./house-founding";
import { openVictualling } from "./army-victualling";
import { createIdFactory } from "./ports";
import { withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";

/**
 * The firms keep their period names (v58; docs/economy.md, "Firms and their names").
 *
 * A gens and a royal house own the word "house". A firm is called what its own people called it: at Rome publicani, negotiatores, argentarii; among the Greeks
 * emporoi, naukleroi, trapezitai, sitonai; at Carthage merchants and shipmen, as the Greek and Latin writers have them, with the uncertainty said; in Egypt licensed
 * trapezitai beside the king's own bank. The code keeps `MerchantHouse`; what is read does not say "house" of a firm.
 */

const CULTURES: readonly FirmCulture[] = ["roman", "greek", "punic", "ptolemaic"];
const KINDS = HouseKindSchema.options;
const houseWord = /\bhouses?\b/i;

describe("the firms keep their period names", () => {
  it("has a name for every kind of firm in every culture, and none of them says house", () => {
    for (const culture of CULTURES) {
      for (const kind of KINDS) {
        const name = firmNameFor(kind, culture);
        for (const text of [name.one, name.folk, name.gloss, name.uncertain ?? ""]) {
          expect(text, `${culture} ${kind}`).not.toMatch(houseWord);
          expect(modernWordsIn(text), `${culture} ${kind}: ${text}`).toEqual([]);
        }
        expect(name.folk.length).toBeGreaterThan(3);
      }
    }
  });

  it("calls them what the age did: publicani, negotiatores and argentarii at Rome; emporoi, naukleroi, trapezitai and sitonai among the Greeks", () => {
    expect(firmNameFor("publicani", "roman").folk).toBe("publicani");
    expect(firmNameFor("maritime", "roman").folk).toBe("negotiatores");
    expect(firmNameFor("banking", "roman").folk).toBe("argentarii");
    expect(firmNameFor("maritime", "greek").folk).toBe("emporoi");
    expect(firmNameFor("banking", "greek").folk).toBe("trapezitai");
    expect(firmNameFor("grain", "greek").folk).toBe("sitonai");
    expect(firmNameFor("publicani", "roman").gloss).toMatch(/contracts/);
    expect(firmTitle("maritime", "greek", "Kallias")).toBe("The emporoi of Kallias");
    expect(firmTitle("publicani", "roman", "the Aerarium")).toBe("The publicani of the Aerarium");
  });

  it("says where the sources are thin: Carthage's firms have no Punic name on record, and Egypt's bankers are licensed beside the king's own bank", () => {
    for (const kind of KINDS) expect(firmNameFor(kind, "punic").uncertain, kind).toBeDefined();
    expect(firmNameFor("banking", "ptolemaic").uncertain).toMatch(/royal bank/);
    expect(firmNameFor("banking", "ptolemaic").one).toMatch(/licensed/);
    expect(firmNameFor("maritime", "punic").gloss).toMatch(/emporoi/);
    expect(firmNameFor("maritime", "punic").gloss).toMatch(/mercatores/);
  });

  it("reads a firm's culture by the power whose law it lives under", () => {
    expect(firmCultureOf("rome")).toBe("roman");
    expect(firmCultureOf("carthage")).toBe("punic");
    expect(firmCultureOf("syracuse")).toBe("greek");
    expect(firmCultureOf("ptolemaic-egypt")).toBe("ptolemaic");
    expect(firmCultureOf(null, "carthaginian")).toBe("punic");
  });

  it("names the seventeen firms of the opening in their own people's word, and none after a house", () => {
    const world = stockedWorld();
    const names = economyOf(world).houses.map((house) => house.name);
    expect(names.length).toBe(17);
    for (const name of names) {
      expect(name, name).not.toMatch(/^The house of/);
      expect(name, name).not.toMatch(houseWord);
      expect(modernWordsIn(name)).toEqual([]);
    }
    expect(names).toContain("The publicani of the Aerarium");
    expect(names).toContain("The emporoi of Kallias");
    expect(names).toContain("The sitonai of Dion");
    expect(names).toContain("The trapezitai of Neapolis");
  });

  it("names a firm founded by rule after its kind and its city's word, and says firm, not house, when it refuses", () => {
    const world = stockedWorld();
    const roman = world.characters.find((character) => character.polityId === "rome" && character.alive && character.gender === "male" && character.personalAccountId !== null)!;
    const greek = world.characters.find((character) => character.polityId === "syracuse" && character.alive && character.gender === "male" && character.personalAccountId !== null)!;
    const rich = (state: WorldState, man: typeof roman): WorldState => ({ ...state, material: { ...state.material, accounts: state.material.accounts.map((account) => (account.id === man.personalAccountId ? { ...account, balance: 300_000 } : account)) } });
    const found = (state: WorldState, man: typeof roman, kind: "banking" | "maritime" | "grain") => foundTheHouse(rich(state, man), { founder: man, head: null, heirId: null, name: "", kind, homeProvinceId: man.locationProvinceId, capital: 60_000 }, 200, createIdFactory("rule"), false);
    const bank = found(world, roman, "banking");
    if ("refusal" in bank) throw new Error(bank.refusal);
    expect(bank.house.name).toMatch(/^The argentarii of /);
    expect(bank.fact.summary.replace(bank.house.name, "")).not.toMatch(houseWord);
    const traders = found(world, greek, "maritime");
    if ("refusal" in traders) throw new Error(traders.refusal);
    expect(traders.house.name).toMatch(/^The emporoi of /);
    const corn = found(world, greek, "grain");
    if ("refusal" in corn) throw new Error(corn.refusal);
    expect(corn.house.name).toMatch(/^The sitonai of /);
    // A refusal says firm.
    const poor = foundTheHouse(world, { founder: roman, head: null, heirId: null, name: "", kind: "maritime", homeProvinceId: roman.locationProvinceId, capital: 1 }, 200, createIdFactory("poor"), false);
    if ("refusal" in poor) expect(poor.refusal).not.toMatch(houseWord);
  });

  it("tells of a firm that feeds an army as a firm, in the words of the age", () => {
    const world = withWar(stockedWorld(150, 2.2, [], 3_000_000), "rome", "carthage");
    const army = world.material.forces.find((force) => force.id === "roman-field-army")!;
    const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "rome")!.id;
    const opened = openVictualling(world, army, 180, treasury, 150, createIdFactory("names"));
    if ("refusal" in opened) throw new Error(opened.refusal);
    for (const fact of opened.facts) {
      expect(fact.summary.replace(opened.house.name, "")).not.toMatch(houseWord);
      expect(modernWordsIn(fact.summary)).toEqual([]);
    }
    expect(opened.contract.label.replace(opened.house.name, "")).not.toMatch(houseWord);
  });
});
