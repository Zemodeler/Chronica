"use client";

import { useState } from "react";
import {
  REGIME_WORDS,
  developmentInWords,
  policyInWords,
  scarInWords,
  type ProvinceTaxLine,
  type RegionLine,
  type RegionPolicy,
  type RegionsReading,
  type TaxRegime,
} from "@chronica/shared";
import { Tip, TipCard } from "../../../components/ui/tip";

/**
 * The lands of the power, region by region: how developed each is, what war
 * has left on it, how many live there and how it is taxed. A region is the
 * country of one market (a hub and the provinces that trade in it).
 *
 * Where the reader holds the fiscal power, each line has a way to change how
 * it is taxed. Like every other order in the game that is written, not
 * clicked through: choosing a regime and a rate drafts the order at the desk
 * for the reader to send, and the world carries it out and says what came of
 * it. Where the reader holds no such power, the page is a reading and nothing
 * more.
 */

const REGIMES: readonly TaxRegime[] = ["tithe", "land_levy", "customs", "men"];
const REGIME_SHORT: Readonly<Record<TaxRegime, string>> = { tithe: "tithe", land_levy: "land levy", customs: "customs", men: "men" };
const money = (amount: number): string => amount.toLocaleString("en-GB");
const people = (count: number): string => (count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)} million` : count >= 10_000 ? `${Math.round(count / 1_000).toLocaleString("en-GB")} thousand` : money(count));
const rateWords = (rateBps: number): string => `${(rateBps / 100).toFixed(rateBps % 100 === 0 ? 0 : 1)} in a hundred`;

/** The order a choice of regime and rate drafts, in the words a ruler would write. */
export function taxOrder(target: { readonly kind: "polity"; readonly polity: string } | { readonly kind: "province"; readonly name: string; readonly polity: string }, regime: TaxRegime, rateBps: number): string {
  const how = `${REGIME_WORDS[regime]} at ${rateWords(rateBps)}`;
  return target.kind === "polity"
    ? `Let every province of ${target.polity} that has no tax of its own be taxed by ${how}.`
    : `Tax the province of ${target.name} by ${how}.`;
}

export function RegionsSheet({ regions, onDraft }: { readonly regions: RegionsReading; readonly onDraft?: ((text: string) => void) | undefined }) {
  const [open, setOpen] = useState<string | null>(regions.regions[0]?.id ?? null);
  const canOrder = regions.canSet && onDraft !== undefined;
  return (
    <div className="books regions">
      <section className="books__side">
        <h3>The lands of {regions.polityLabel}</h3>
        <p className="regions__summary">
          {regions.provinceCount} {regions.provinceCount === 1 ? "province" : "provinces"} and {people(regions.population)} people. Development averages{" "}
          <Tip label="Development" note={() => (
            <TipCard kicker="What it is" title="Development">
              <p>The roads, harbours, estates and habit of trade of a place. It sets how many people the ground can carry, what they make and what a government can take. It grows a few hundred points a year in peace under a light tax, and falls much faster in war.</p>
              <p>Out of ten thousand: the most developed province you hold stands at {money(regions.developmentHighBps)}, the least at {money(regions.developmentLowBps)}.</p>
            </TipCard>
          )}>{developmentInWords(regions.developmentMeanBps)}</Tip>
          {regions.scarredProvinces > 0 && <>; {regions.scarredProvinces} {regions.scarredProvinces === 1 ? "province is" : "provinces are"} <span className="is-short">scarred by war</span></>}.
        </p>
      </section>

      <section className="books__side regions__policy">
        <h3>How they are taxed</h3>
        <p>By default, {policyInWords(regions.defaultPolicy)}.{regions.customsRateBps > 0 && <> Customs of {rateWords(regions.customsRateBps)} on foreign goods.</>}</p>
        {canOrder && (
          <>
            <PolicyForm
              label="Every province without a tax of its own"
              initial={regions.defaultPolicy}
              button="Draft the order"
              onDraft={(regime, rate) => onDraft(taxOrder({ kind: "polity", polity: regions.polityLabel }, regime, rate))}
            />
            <CustomsForm
              initial={regions.customsRateBps}
              onDraft={(rate) => onDraft(`Lay customs of ${rateWords(rate)} on goods entering the markets of ${regions.polityLabel} from other powers.`)}
            />
          </>
        )}
        {!regions.canSet && <p className="quiet">Only those who hold the treasury's powers choose how a province is taxed.</p>}
      </section>

      <section className="books__side">
        <h3>Region by region</h3>
        <ul className="ruled regions__list">
          {regions.regions.map((region) => (
            <RegionEntry key={region.id} region={region} polity={regions.polityLabel} open={open === region.id} onToggle={() => setOpen(open === region.id ? null : region.id)} onDraft={canOrder ? onDraft : undefined} />
          ))}
        </ul>
        {regions.regionsOmitted > 0 && <p className="quiet">And {regions.regionsOmitted} smaller {regions.regionsOmitted === 1 ? "region" : "regions"}.</p>}
      </section>
    </div>
  );
}

function RegionEntry({ region, polity, open, onToggle, onDraft }: {
  readonly region: RegionLine;
  readonly polity: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onDraft?: ((text: string) => void) | undefined;
}) {
  const war = scarInWords(region.scarBps, region.warDamageBps);
  return (
    <li className={war !== null && region.scarBps >= 2_000 ? "regions__entry is-strained" : "regions__entry"}>
      <button type="button" className="regions__head" aria-expanded={open} onClick={onToggle}>
        <strong>{region.name}</strong>
        <span>{people(region.population)} people, {developmentInWords(region.developmentBps)}{war !== null && <>, <span className="is-short">{war}</span></>}</span>
        <span>{region.policy === null ? "taxed variously" : policyInWords(region.policy)}{region.monthly > 0 && <>, {money(region.monthly)} a month</>}</span>
      </button>
      {open && (
        <table className="ledger regions__table">
          <thead>
            <tr className="ledger__head"><th scope="col">Province</th><th scope="col">People</th><th scope="col">Development</th><th scope="col">Taxed by</th><th scope="col">A month</th>{onDraft !== undefined && <th scope="col"><span className="visually-hidden">Change</span></th>}</tr>
          </thead>
          <tbody>
            {region.provinces.map((province) => <ProvinceRow key={province.id} province={province} polity={polity} onDraft={onDraft} />)}
          </tbody>
        </table>
      )}
    </li>
  );
}

function ProvinceRow({ province, polity, onDraft }: { readonly province: ProvinceTaxLine; readonly polity: string; readonly onDraft?: ((text: string) => void) | undefined }) {
  const [editing, setEditing] = useState(false);
  const war = scarInWords(province.scarBps, province.warDamageBps);
  return (
    <>
      <tr>
        <th scope="row">{province.name}{war !== null && <span className="is-short"> ({war})</span>}</th>
        <td>{money(province.population)}</td>
        <td>{money(province.developmentBps)}</td>
        <td>{REGIME_SHORT[province.policy.regime]}, {province.policy.rateBps / 100} in 100</td>
        <td>{!province.collected ? "none (held by another)" : province.policy.regime === "men" ? `${money(province.menPerYear)} men a year` : money(province.monthly)}</td>
        {onDraft !== undefined && <td><button type="button" className="btn btn--quiet btn--small" aria-expanded={editing} onClick={() => setEditing(!editing)}>Change</button></td>}
      </tr>
      {editing && onDraft !== undefined && (
        <tr>
          <td colSpan={6}>
            <PolicyForm
              label={province.name}
              initial={province.policy}
              button="Draft the order"
              onDraft={(regime, rate) => { onDraft(taxOrder({ kind: "province", name: province.name, polity }, regime, rate)); setEditing(false); }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function PolicyForm({ label, initial, button, onDraft }: {
  readonly label: string;
  readonly initial: RegionPolicy;
  readonly button: string;
  readonly onDraft: (regime: TaxRegime, rateBps: number) => void;
}) {
  const [regime, setRegime] = useState<TaxRegime>(initial.regime);
  const [rate, setRate] = useState(String(initial.rateBps / 100));
  const rateBps = Math.round(Math.max(0, Math.min(100, Number(rate) || 0)) * 100);
  return (
    <form className="regions__form" onSubmit={(event) => { event.preventDefault(); onDraft(regime, rateBps); }}>
      <label>
        <span>{label}</span>
        <select value={regime} onChange={(event) => setRegime(event.target.value as TaxRegime)}>
          {REGIMES.map((entry) => <option key={entry} value={entry}>{REGIME_WORDS[entry]}</option>)}
        </select>
      </label>
      <label>
        <span>In a hundred</span>
        <input type="number" min={0} max={100} step={0.5} value={rate} onChange={(event) => setRate(event.target.value)} />
      </label>
      <button type="submit" className="btn btn--small">{button}</button>
    </form>
  );
}

function CustomsForm({ initial, onDraft }: { readonly initial: number; readonly onDraft: (rateBps: number) => void }) {
  const [rate, setRate] = useState(String(initial / 100));
  const rateBps = Math.round(Math.max(0, Math.min(50, Number(rate) || 0)) * 100);
  return (
    <form className="regions__form" onSubmit={(event) => { event.preventDefault(); onDraft(rateBps); }}>
      <label>
        <span>Customs on foreign goods, in a hundred</span>
        <input type="number" min={0} max={50} step={0.5} value={rate} onChange={(event) => setRate(event.target.value)} />
      </label>
      <button type="submit" className="btn btn--small">Draft the order</button>
    </form>
  );
}
