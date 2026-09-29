import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema } from "../world/scenario";
import { WorldStateSchema, type WorldState } from "../world/world-state";
import { assessOrderStanding } from "./order-standing";

/**
 * Consul to consul.
 *
 * Clepsina told his colleague Blasio to keep asking after the ships, and the
 * record said "Gaius Genucius Clepsina, Roman consul, under whom you serve":
 * the consul's command over Rome reached every Roman, his equal in the other
 * chair included. Blasio took it as binding and spent the season on it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const standing = (issuer: string, recipient: string, state: WorldState = world()) => assessOrderStanding({
  world: state,
  offices: definition.government.offices,
  issuerRef: { kind: "character", id: issuer },
  recipientRef: { kind: "character", id: recipient },
});

describe("an order between magistrates", () => {
  it("is a request from one consul to the other", () => {
    const verdict = standing("gaius-genucius", "gnaeus-cornelius");
    expect(verdict.standing).toBe("requested");
    expect(verdict.reason).toMatch(/colleague/);
    expect(verdict.reason).not.toMatch(/under whom you serve/);
  });

  it("still binds a Roman who holds no magistracy", () => {
    expect(standing("gaius-genucius", "manius-curius").standing).toBe("binding");
  });

  it("does not bind a magistrate above the one giving it", () => {
    // Blasio made praetor for the test: a consul may command a praetor, and a
    // praetor may not command a consul.
    const state = world();
    const consulSeat = state.material.officeSeats.find((seat) => seat.holderCharacterId === "gnaeus-cornelius" && seat.officeId === "roman-consul")!;
    const praetor: WorldState = {
      ...state,
      material: {
        ...state.material,
        officeSeats: [
          ...state.material.officeSeats.filter((seat) => seat !== consulSeat),
          { ...consulSeat, id: "roman-praetor:seat:0", officeId: "roman-praetor", seatIndex: 0 },
        ],
      },
    };
    expect(standing("gnaeus-cornelius", "gaius-genucius", praetor).standing).toBe("requested");
    expect(standing("gaius-genucius", "gnaeus-cornelius", praetor).standing).toBe("binding");
  });
});
