import { CUSTOMARY_TAX_RATE_BPS, type Charge, type ChargeRule } from "@chronica/shared";

/**
 * The charges of the offices the Punic scenario writes out by hand (scenario v55; docs/plans/government.md,
 * "Proposed competence tables" and "H1 as built").
 *
 * An office's `charge` says only what its form does differently from the common run: what is not said here is read from the
 * constitution's parts (the chambers' powers, the head, the levers of the department he staffs). So a king (Hiero, Ptolemy) has
 * no entry: he holds everything alone for as long as no chamber that binds holds a power, and a reform that sets one over him takes
 * it from him without anybody editing this list. The same is true of the Senate and the assemblies: their reach is their `powers`.
 *
 * Each table follows the research and says where the research is thin: H high, M medium, L low confidence. Where the evidence is
 * thin the simplest defensible reading is taken and named.
 *
 * Grades: `alone`, `with_colleague` (either may act, the other may stop him: par potestas, intercessio), `by_the_body` (he moves it
 * in the chamber that holds the power and may not do it), `forbidden`. A figure (`within`) is the most he may do on that footing, in
 * the act's own unit (basis points of the rate or the tariff; months of what the power takes in): what is beyond it is the chamber's.
 */

const CUSTOM = CUSTOMARY_TAX_RATE_BPS;
const alone: ChargeRule = { grade: "alone" };
const colleague: ChargeRule = { grade: "with_colleague" };
const body: ChargeRule = { grade: "by_the_body" };
const forbidden: ChargeRule = { grade: "forbidden" };

export const PUNIC_CHARGES: Readonly<Record<string, Charge>> = {
  // ── Rome ────────────────────────────────────────────────────────────────
  // The consuls (H): imperium, the levy, the army's pay; two, each able to forbid the other. Everything else of the state's money and
  // treaties is the Senate's and the people's (Polybius 6.12-14): they move it, they do not do it. A rate within custom is theirs
  // (with the colleague), a NEW tax or a rate past custom is the Senate's decree (M). Coinage: the Senate, or a consul at the mint for the army's pay (M-L).
  "roman-consul": {
    tax_rate: { grade: "with_colleague", within: CUSTOM, beyond: "by_the_body" },
    customs: body, coinage: body, loans: body, grain: body,
    pacts: body, embargoes: body, war: body, peace: body,
    levy: colleague, appointment: body,
    spending: { grade: "with_colleague", within: 2, beyond: "by_the_body" },
  },
  // The urban praetor (H): the civil law, and a lesser imperium in the consul's absence, so the levy; no purse of his own.
  "roman-praetor": { levy: alone, spending: body },
  // The quaestors (M; four, or eight from about 267): keepers of the treasury in the temple of Saturn, paying out only on a decree of the Senate (H).
  // The rate within custom, with his colleagues, as the officers who keep the roll; every loan, every tariff and every draw is the Senate's; no coin, no bread.
  "roman-quaestor": {
    tax_rate: { grade: "with_colleague", within: CUSTOM, beyond: "by_the_body" },
    customs: body, loans: body, coinage: forbidden, grain: forbidden, spending: body,
  },
  // The aediles, curule and plebeian (M): the city's markets, weights and the price of bread, each pair acting jointly with the power to stop the other;
  // buying grain abroad and large gifts of it are the Senate's.
  "roman-aedile": { grain: { grade: "with_colleague", within: 1, beyond: "by_the_body" }, spending: body },
  "roman-plebeian-aedile": { grain: { grade: "with_colleague", within: 1, beyond: "by_the_body" }, spending: body },
  // The censors (H for the census, the roll of the Senate and the nota; M-L that they let the harbour dues): two, each able to stop the other;
  // the contracts are let with money the Senate votes.
  "roman-censor": {
    customs: { grade: "with_colleague", within: 1_000, beyond: "by_the_body" },
    tax_rate: forbidden, loans: forbidden, grain: forbidden, spending: body, appointment: colleague,
    // Whoever keeps the dues does not speak for the state: the treaties are the Senate's, and the letters about them go to the consuls.
    pacts: forbidden, embargoes: forbidden,
  },
  // The dictator (H for the office, M that the treasury still needed the Senate): supreme imperium, no colleague, named for six months. He holds all
  // alone but the chest: the borrowing and the drawing on it, and the treaties the people ratify, remain with the Senate.
  "roman-dictator": {
    tax_rate: alone, customs: alone, coinage: body, loans: body, grain: alone, pacts: body, embargoes: alone, levy: alone, war: alone, peace: body,
    appointment: alone, spending: body,
  },

  // ── Carthage ────────────────────────────────────────────────────────────
  // The suffetes (M; two, elected for a year, whom the Greeks called kings) are the civil heads: they convene and chair the Council and the people and judge.
  // War, peace, finance and the hiring of men are the elders' (Aristotle, Politics 2.11). They enforce the tariff within custom (M-L).
  "carthaginian-suffete": {
    tax_rate: body, customs: { grade: "with_colleague", within: 1_000, beyond: "by_the_body" }, coinage: body, loans: body, grain: body,
    pacts: body, embargoes: body, war: body, peace: body, levy: body, appointment: body, spending: body,
  },
  // The general in Sicily (M): chosen for the term of the war, not the year. He commands and raises the mercenaries the Council has hired, strikes
  // coin for the army's pay without changing its silver (L-M) and draws on the field chest; peace and every treaty go to the Council (M). Not the head of state.
  "carthaginian-strategos": {
    levy: alone, coinage: { grade: "alone", within: 0, beyond: "by_the_body" }, war: forbidden, peace: body,
    spending: { grade: "alone", within: 1, beyond: "by_the_body" },
  },
  // The officers of the accounts (L-M; a board of three): they count the revenues and keep the treasury's books. The rate and the tariff within custom are theirs,
  // as officers of the Council that collect; the loans and every draw are the elders'; they strike what the elders order.
  "carthaginian-accountant": {
    tax_rate: { grade: "with_colleague", within: CUSTOM, beyond: "by_the_body" },
    customs: { grade: "with_colleague", within: 1_000, beyond: "by_the_body" },
    coinage: { grade: "with_colleague", within: 0, beyond: "by_the_body" },
    loans: body, grain: forbidden, spending: body,
    // They count the dues and do not speak for the city: treaties are the elders' and the suffetes' to carry, and the letters about them go to the suffetes.
    pacts: forbidden, embargoes: forbidden,
  },

  // ── Syracuse (Hiero II) ─────────────────────────────────────────────────
  // The king holds all alone because no chamber that binds holds any power of the state (the friends give their counsel, the assembly only acclaims): read from the
  // parts, so nothing is written for him. His strategoi are a board that carries out the levy and makes no war, no tax and no draw of their own (M).
  "syracusan-strategos": { levy: colleague, tax_rate: forbidden, spending: forbidden },
};
