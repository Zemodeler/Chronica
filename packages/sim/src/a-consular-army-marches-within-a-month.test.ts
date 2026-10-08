import { describe, expect, it } from "vitest";
import { aMonth, atWar, forceOf, romeAndCarthageAlone } from "./war-plan-kit";

/**
 * A consular army marches within a month, though the consul is a man the model plays.
 *
 * The playtests found the Roman field army at the Almo for years under "orders" the rules had written in the consul's name: the rules stood back
 * from every army a played man commands, and the played man, asked, answered that he did nothing. The army sat, and the orders ("winter", in May)
 * stood because a played head's orders stand until they run out.
 */
describe("a consular army marches within a month", () => {
  const at = atWar(120);
  const played = new Set(["gaius-genucius"]);
  const WAR = romeAndCarthageAlone(at).polityAgreements.find((agreement) => agreement.kind === "war" && agreement.status === "active" && [agreement.polityId, agreement.otherPolityId].includes("carthage"))!.id;

  it("is marched by the rules when the orders on it are the rules' own, whoever the consul is", () => {
    const month = aMonth(romeAndCarthageAlone(at), { playedByModel: played });
    const orders = month.world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
    expect(orders.byRule).toBe(true);
    expect(orders.forCommanderId).toBe(forceOf(at, "roman-field-army").commanderCharacterId);
    expect(month.decisions.some((decision) => decision.polityId === "rome" && decision.act === "march" && decision.actorCharacterId === "gaius-genucius")).toBe(true);
  });

  it("does not keep the rules' own winter orders into the campaigning season because the consul is played", () => {
    const winterOrders = { forceId: "roman-field-army", polityId: "rome", warId: WAR, theatreId: null, objective: { kind: "province" as const, provinceId: forceOf(at, "roman-field-army").locationId }, baseProvinceId: null, fallbackProvinceId: null, mode: "winter" as const, issuedByCharacterId: "gaius-genucius", issuedStep: 100, expiresStep: 200, byRule: true, forCommanderId: "gaius-genucius" };
    const summer = { ...romeAndCarthageAlone(at), campaigns: [winterOrders] };
    const month = aMonth(summer, { playedByModel: played });
    const orders = month.world.campaigns.find((entry) => entry.forceId === "roman-field-army")!;
    // Either still good in this month's season, or replaced: never silently kept past its season while an army of the enemy lies in the field.
    expect(orders.byRule).toBe(true);
  });

  it("leaves a played man's own order to him", () => {
    const own = { forceId: "roman-field-army", polityId: "rome", warId: WAR, theatreId: null, objective: { kind: "province" as const, provinceId: forceOf(at, "roman-field-army").locationId }, baseProvinceId: null, fallbackProvinceId: null, mode: "garrison" as const, issuedByCharacterId: "gaius-genucius", issuedStep: 100, expiresStep: 220 };
    const month = aMonth({ ...romeAndCarthageAlone(at), campaigns: [own] }, { playedByModel: played });
    expect(month.world.campaigns.find((entry) => entry.forceId === "roman-field-army")).toEqual(own);
    expect(month.decisions.some((decision) => decision.act === "march" && decision.actorCharacterId === "gaius-genucius")).toBe(false);
  });
});
