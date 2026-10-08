import type { HouseKind } from "./houses";

/**
 * What a firm is called in its own age (docs/economy.md, "Firms and their names").
 *
 * The code keeps `MerchantHouse` and `HouseKind`; what a player or a model reads does not say "house": a gens and a royal house own that word
 * (docs/plans/gentes.md), and a firm is called what its own people called it, by its culture and its kind:
 *
 * - **Rome**: the *publicani* (a *societas publicanorum*, a company that took the state's contracts, rents and taxes: Polybius 6.17, Livy 23.48-49 and 25.3), the
 *   *negotiatores* (merchants, who lent money on the side), the *argentarii* (private bankers, who took deposits, changed money and acted at auctions),
 *   and *mercatores* (traders in a small way, often freedmen). Grain dealers are *negotiatores frumentarii*.
 * - **The Greeks**: *emporoi* (merchants who sailed with their goods, hiring room in another's ship), *naukleroi* (shipowners, in the main emporoi who owned
 *   hulls), *trapezitai* (bankers, from the *trapeza*, the table), *sitonai* (buyers of grain: at Athens an office of the city as well, here the dealer), *telonai*
 *   (tax-farmers).
 * - **Carthage and the Phoenician cities**: the Greeks and Romans call their merchants *emporoi* and *mercatores*, and the sources give no Punic name for a firm. The
 *   one Punic word that is sometimes read as "merchant" (*gugga*, in Plautus's *Poenulus*, and perhaps in an inscription of Cirta) is doubtful, and is not used. A Punic firm
 *   is therefore "merchants" or "shipmen" and "factors", as the Greek and Latin writers have them; the uncertainty is the age's and is said here.
 * - **Egypt**: banking was the king's: the royal bank (the *basilike trapeza*) under the *dioiketes*, with private *trapezitai* licensed beside it. A Ptolemaic "house of bankers"
 *   is a licensed *trapezitai*, never the crown's own bank.
 *
 * Sources: https://en.wikipedia.org/wiki/Banking_in_ancient_Rome (argentarii, mensarii, nummularii, societates argentariae); https://www.worldhistory.org/article/974/banking-in-the-roman-world/;
 * https://brewminate.com/business-and-commerce-in-ancient-rome/ (negotiatores, mercatores); https://bmcr.brynmawr.edu/?p=85372 and https://www.degruyterbrill.com/document/doi/10.1515/jah-2015-0005/pdf
 * (emporos and naukleros: the naukleros as a ship-owning emporos); https://www.penn.museum/sites/expedition/traders-and-trading/ (emporos, naukleros and the moneylender in a venture);
 * https://www.worldhistory.org/article/115/trade-in-ancient-greece (the sitones, the grain buyers of Athens); https://en.wikipedia.org/wiki/Punic_people and
 * https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5245619/ (the Phoenician and Carthaginian merchants, as the Greek and Latin sources have them).
 */

export type FirmCulture = "roman" | "greek" | "punic" | "ptolemaic";

export interface FirmName {
  /** What one such firm is called: "a company of publicani", "a firm of emporoi". */
  readonly one: string;
  /** The people of it, as a name begins: "publicani", "emporoi". */
  readonly folk: string;
  /** A gloss for a reader who does not know the word, in a few words. */
  readonly gloss: string;
  /** Said where the sources are thin. */
  readonly uncertain?: string;
}

const TABLE: Readonly<Record<FirmCulture, Readonly<Record<HouseKind, FirmName>>>> = {
  roman: {
    publicani: { one: "a company of publicani", folk: "publicani", gloss: "a company that takes the state's contracts, rents and taxes" },
    maritime: { one: "a company of negotiatores", folk: "negotiatores", gloss: "merchants who send goods by sea and lend at interest" },
    grain: { one: "a company of negotiatores frumentarii", folk: "negotiatores frumentarii", gloss: "dealers in grain" },
    silver: { one: "a company of negotiatores", folk: "negotiatores", gloss: "merchants in silver and metals" },
    banking: { one: "a company of argentarii", folk: "argentarii", gloss: "bankers, who take deposits, change money and keep accounts" },
  },
  greek: {
    publicani: { one: "a company of telonai", folk: "telonai", gloss: "farmers of the tax" },
    maritime: { one: "a firm of emporoi", folk: "emporoi", gloss: "sea-merchants, who sail with their goods" },
    grain: { one: "a firm of sitonai", folk: "sitonai", gloss: "buyers of grain" },
    silver: { one: "a firm of emporoi", folk: "emporoi", gloss: "merchants in silver and metals" },
    banking: { one: "a firm of trapezitai", folk: "trapezitai", gloss: "bankers, from the table they sit at" },
  },
  punic: {
    publicani: { one: "a company of tribute-farmers", folk: "tribute-farmers", gloss: "those who take the tribute for the Council", uncertain: "No Punic name for it is known." },
    maritime: { one: "a firm of merchants", folk: "merchants", gloss: "sea-merchants, whom the Greeks call emporoi and the Romans mercatores", uncertain: "The sources give no Punic word for a firm; the Greek and Latin ones are used." },
    grain: { one: "a firm of grain-merchants", folk: "grain-merchants", gloss: "dealers in the grain and oil of Africa", uncertain: "The sources give no Punic word for a firm." },
    silver: { one: "a firm of silver-merchants", folk: "silver-merchants", gloss: "dealers in the silver of Iberia", uncertain: "The sources give no Punic word for a firm." },
    banking: { one: "a firm of moneychangers", folk: "moneychangers", gloss: "those who change and lend money", uncertain: "Punic banking is thinly known." },
  },
  ptolemaic: {
    publicani: { one: "a company of telonai", folk: "telonai", gloss: "farmers of the king's taxes" },
    maritime: { one: "a firm of emporoi", folk: "emporoi", gloss: "sea-merchants" },
    grain: { one: "a firm of sitonai", folk: "sitonai", gloss: "buyers of grain" },
    silver: { one: "a firm of emporoi", folk: "emporoi", gloss: "merchants in silver" },
    banking: { one: "a licensed firm of trapezitai", folk: "trapezitai", gloss: "private bankers licensed beside the king's own bank", uncertain: "The royal bank under the dioiketes is the crown's, not a firm." },
  },
};

/** What a firm of this kind is called in this culture's own tongue; the one place a name for a firm is read. */
export function firmNameFor(kind: HouseKind, culture: FirmCulture): FirmName {
  return TABLE[culture][kind];
}

/** The culture of a firm's city, by the power whose law it lives under: Rome's, Carthage's and the Phoenician cities', Egypt's, else the Greeks'. */
export function firmCultureOf(polityId: string | null, cultureId?: string | null): FirmCulture {
  if (cultureId === "roman" || polityId === "rome") return "roman";
  if (cultureId === "carthaginian" || cultureId === "punic" || cultureId === "phoenician" || polityId === "carthage") return "punic";
  if (polityId === "ptolemaic-egypt") return "ptolemaic";
  return "greek";
}

/** A firm's name as it is written over its door: "The publicani of the Aerarium", "The emporoi of Kallias". */
export function firmTitle(kind: HouseKind, culture: FirmCulture, of: string): string {
  const folk = firmNameFor(kind, culture).folk;
  return `The ${folk} of ${of}`;
}
