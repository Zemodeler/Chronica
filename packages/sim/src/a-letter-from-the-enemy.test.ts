import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DiplomaticMessageSchema, ScenarioDefinitionSchema, WorldStateSchema, openWar, type WorldState } from "@chronica/shared";
import { renderCharacterPortrait } from "./cognition";

/**
 * A letter from the enemy reads as one.
 *
 * Carthage at war with Rome wrote to Syracuse, and Syracuse answered it as a
 * letter from a neutral, because the letter said nothing of whose it was and
 * the reader's portrait put the war and the letter in different places. The
 * letter now carries the war on it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);

function aLetterFromCarthage(atWarWithIt: boolean): WorldState {
  const world = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
  const letter = DiplomaticMessageSchema.parse({
    id: "letter-1", kind: "trade_offer", fromPolityId: "carthage", fromCharacterId: "hanno-carthage", toPolityId: "syracuse", toCharacterId: "hieron-ii",
    subject: "Grain for the winter", terms: "Carthage will buy your grain.", sentAtStep: 0,
  });
  return {
    ...world,
    diplomacy: [...world.diplomacy, letter],
    polityAgreements: atWarWithIt
      ? openWar(world.polityAgreements, { id: "war-cs", polityId: "carthage", otherPolityId: "syracuse", terms: "War.", atStep: 0, sourceMessageId: null, reason: "War." })
      : world.polityAgreements,
  };
}

describe("a letter from the enemy", () => {
  it("says it is from the enemy, when their powers are at war", () => {
    const portrait = renderCharacterPortrait("hieron-ii", "Hieron", aLetterFromCarthage(true), definition.clock);
    expect(portrait).toMatch(/\[letter-1\][^\n]*the enemy/);
  });

  it("says nothing of the kind in peace", () => {
    const portrait = renderCharacterPortrait("hieron-ii", "Hieron", aLetterFromCarthage(false), definition.clock);
    expect(portrait).toContain("[letter-1]");
    expect(portrait).not.toMatch(/\[letter-1\][^\n]*the enemy/);
  });
});
