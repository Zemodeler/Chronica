import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { adviceOnALetter, letterVerdict } from "./letter-verdict";
import { createIdFactory } from "./ports";

/**
 * Loop 3: Epirus asked Macedon for a year's truce with no war between them, and the printed counsel to Antigonus read "no (not beaten)":
 * counsel for a surrender, to a power nobody was fighting. A truce between powers at peace is a quiet border and is weighed as one.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string, now: WorldState["instant"]): ApplyContext => ({
  now, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory(`quiet-${actor}`), gameId: "game-quiet", playerCharacterId: "epirus-ruler-1e36qe",
});

describe("a truce offered to a power one is not fighting", () => {
  it("is counselled as a quiet border, never as 'not beaten'", () => {
    const start = world();
    const epirus = start.characters.find((character) => character.polityId === "epirus" && character.alive);
    const macedon = start.characters.find((character) => character.polityId === "macedon" && character.alive);
    expect(epirus).toBeDefined();
    expect(macedon).toBeDefined();
    expect(start.polityAgreements.some((agreement) => agreement.kind === "war" && agreement.status === "active"
      && [agreement.polityId, agreement.otherPolityId].includes("epirus") && [agreement.polityId, agreement.otherPolityId].includes("macedon"))).toBe(false);
    const sent: WorldDelta = {
      op: "diplomatic_message_send", localId: "truce", kind: "peace_offer", fromPolityId: "epirus", fromCharacterRef: epirus!.id, toPolityId: "macedon", toCharacterRef: macedon!.id,
      subject: "A year of truce", terms: "Epirus and Macedon keep the peace for a year.", replyWithinDays: 45, inReplyToRef: null, visibility: "public", proposes: ["truce"], forDays: 365, reason: "Alexander offers.",
    };
    const asked = applyDeltas(start, [sent], context(epirus!.id, start.instant));
    expect(asked.rejected).toEqual([]);
    const letter = asked.world.diplomacy.at(-1)!;
    const verdict = letterVerdict(asked.world, letter, macedon!);
    expect(verdict).not.toBeNull();
    const counsel = adviceOnALetter(verdict!);
    expect(counsel).not.toMatch(/not beaten/);
    expect(counsel).toMatch(/quiet border|no reason to bind ourselves|an old grievance/);
  });
});
