import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import { whatComesNext } from "./calendar";
import { ProjectSchema } from "../world/project";
import type { WorldState } from "../world/world-state";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const heldSeat = (state: WorldState) => state.material.officeSeats.find((seat) => seat.status === "held" && seat.holderCharacterId !== null && seat.termExpiresAtStep !== null)!;

describe("what is coming, as a person could know it", () => {
  it("tells an officeholder when his term ends", () => {
    const state = world();
    const seat = heldSeat(state);
    const next = whatComesNext(state, seat.holderCharacterId, offices, clock, 10);
    const term = next.find((item) => item.label.startsWith("Your term as"));
    expect(term).toBeDefined();
    expect(term!.inDays).toBe(seat.termExpiresAtStep! - state.elapsedStep);
  });

  it("does not tell anyone else about another man's term", () => {
    const state = world();
    const seat = heldSeat(state);
    for (const other of state.characters.filter((character) => character.alive && character.id !== seat.holderCharacterId)) {
      expect(whatComesNext(state, other.id, offices, clock, 50).some((item) => item.key === `seat:${seat.id}`)).toBe(false);
    }
  });

  it("keeps another power's undertakings to that power", () => {
    const state = world();
    const seat = heldSeat(state);
    const holder = state.characters.find((character) => character.id === seat.holderCharacterId)!;
    const foreign = state.map.polities.find((polity) => polity.id !== holder.polityId)!;
    const withForeignProject: WorldState = {
      ...state,
      projects: [...state.projects, ProjectSchema.parse({
        id: "secret-fleet", kind: "construction", sponsorEntityRef: { kind: "polity", id: foreign.id }, label: "A hidden fleet",
        status: "in_progress", reservationId: null,
        milestones: [{ id: "keels", label: "The hidden keels are laid", requiredAtElapsedOffset: 5, costAmount: 0, status: "pending" }],
        startedAtStep: state.elapsedStep,
      })],
    };
    const next = whatComesNext(withForeignProject, holder.id, offices, clock, 10);
    expect(next.some((item) => item.label.includes("hidden"))).toBe(false);
  });

  it("puts a letter awaiting your own answer on the calendar, and marks it as wanting you", () => {
    const state = world();
    const seat = heldSeat(state);
    const holder = state.characters.find((character) => character.id === seat.holderCharacterId)!;
    const sender = state.characters.find((character) => character.polityId !== holder.polityId)!;
    const letter = {
      id: "letter-1", kind: "letter", fromPolityId: sender.polityId, fromCharacterId: sender.id, toPolityId: holder.polityId,
      toCharacterId: holder.id, subject: "Messana", terms: "Leave Messana to Syracuse.", sentAtStep: state.elapsedStep,
      replyDueByStep: state.elapsedStep + 9, status: "awaiting_reply", visibility: "private",
    };
    const withLetter = WorldStateSchema.parse({ ...state, diplomacy: [...state.diplomacy, letter] });
    const item = whatComesNext(withLetter, holder.id, offices, clock, 10).find((candidate) => candidate.key === "letter:letter-1");
    expect(item).toMatchObject({ inDays: 9, needsYou: true, whenLabel: "in 9 days" });
    expect(item!.label).toContain(sender.name);
  });

  it("gives a far-off date as a date, and never says 'in 300 days'", () => {
    const state = world();
    const seat = heldSeat(state);
    for (const item of whatComesNext(state, seat.holderCharacterId, offices, clock, 10)) {
      if (item.inDays > 60) expect(item.whenLabel).toMatch(/^on \d+ \w+ \d+ (BC|AD)$/);
    }
  });

  it("shows nothing to someone with no character", () => {
    expect(whatComesNext(world(), null, offices, clock)).toEqual([]);
  });
});
