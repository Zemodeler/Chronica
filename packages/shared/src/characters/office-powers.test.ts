import { describe, expect, it } from "vitest";
import { BASE_OFFICE_ACTIONS, deriveOfficeActions } from "./office-powers";

describe("what an office a government invents actually confers", () => {
  it("reads the powers out of the name when the caller states none", () => {
    // The whole reason this exists: across a full match every office the world
    // made came back with an empty list, so five men held five titles and
    // breached the first time they did the thing they were made to do.
    expect(deriveOfficeActions("Quaestor of the war chest")).toContain("money_transfer");
    expect(deriveOfficeActions("Prefect of the levy")).toContain("force_create");
    expect(deriveOfficeActions("Envoy to Syracuse")).toContain("diplomatic_message_send");
    expect(deriveOfficeActions("Governor of Sicily")).toContain("province_material_shift");
    expect(deriveOfficeActions("Pontifex Maximus")).toContain("belief_set");
  });

  it("takes what the caller said as an addition, never as the whole of it", () => {
    const actions = deriveOfficeActions("Quaestor of the fleet", ["force_engage"]);
    expect(actions).toContain("force_engage");
    expect(actions).toContain("money_transfer");
  });

  it("gives an office whose name says nothing the floor and no more", () => {
    const actions = deriveOfficeActions("Keeper of the Sibylline Books");
    // "keeper" is sacral; nothing in it spends, commands or binds anybody.
    expect(actions).not.toContain("money_transfer");
    expect(actions).not.toContain("force_create");
    for (const action of BASE_OFFICE_ACTIONS) expect(actions).toContain(action);
  });

  it("confers nothing for an op that is not in the union", () => {
    expect(deriveOfficeActions("Warden of the March", ["fly_to_the_moon"])).not.toContain("fly_to_the_moon");
  });

  it("is order-stable, so two offices of the same name are the same office", () => {
    expect(deriveOfficeActions("Consul", ["belief_set", "force_create"]))
      .toEqual(deriveOfficeActions("Consul", ["force_create", "belief_set"]));
  });
});
