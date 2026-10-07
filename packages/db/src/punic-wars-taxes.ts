import type { WorldState } from "@chronica/shared";
import { withMerchantHouses } from "./punic-wars-houses";

/**
 * How the provinces of 270 BCE were taxed, where the sources say (v51).
 *
 * The power-wide defaults are in `punic-wars-scenario.ts` (`economy.taxPolicies`):
 * Rome's tributum, Syracuse's tithe, the allies' tribute of men. What a country
 * did differently province by province is here, as the custom of that province
 * (`economy.provinceTaxPolicies`), which stays with the ground when it changes
 * hands, as the custom of a country did, and which a province's own word
 * (`tax_policy_set`) overrides.
 *
 *  - **Sicily** paid the tithe, the decuma, under Carthage, under Hiero (the
 *    lex Hieronica, which Rome kept after 241 and 211) and in the cities the
 *    Romans took. Every Sicilian province carries it whoever holds it.
 *  - **Carthage's African subjects** were its heavy hand: by Polybius' account
 *    (1.72) the country people paid half of what they produced and the towns
 *    double their tribute in the last years of the First War, and the
 *    resentment was what the rising of 241 was made of. The rural provinces of
 *    Africa are taxed by a levy half as heavy again as the ordinary one, in an
 *    ordinary year; the towns' tribute and the harbour dues are the income
 *    sources already authored, and the customs on goods entering Carthage's
 *    markets are `economy.customsRates`.
 */

/** The heavy levy on Carthage's rural Libyan provinces, in basis points of what they can bear. */
export const LIBYAN_LEVY_BPS = 1_500;
/** The tithe of Sicily: a tenth of the harvest. */
export const SICILIAN_TITHE_BPS = 1_000;

/**
 * The world with the custom of each province written down, and (v53) the merchant houses that carry its trade
 * seated in it (`punic-wars-houses.ts`): both are the economy's own opening, and both are built on the finished map.
 */
export function withRegionalTaxes(world: WorldState): WorldState {
  return withMerchantHouses(withCustomsOfTheProvinces(world));
}

/** The custom of each province alone: what v51 wrote. */
function withCustomsOfTheProvinces(world: WorldState): WorldState {
  const customs: { provinceId: string; regime: "tithe" | "land_levy"; rateBps: number }[] = [];
  for (const province of world.map.provinces) {
    if (province.id.startsWith("sic-")) customs.push({ provinceId: province.id, regime: "tithe", rateBps: SICILIAN_TITHE_BPS });
    else if (province.controllerPolityId === "carthage" && province.id.startsWith("afr-")) customs.push({ provinceId: province.id, regime: "land_levy", rateBps: LIBYAN_LEVY_BPS });
  }
  return { ...world, economy: { ...world.economy!, provinceTaxPolicies: customs } };
}
