"use client";

import { inTalents, type GoodPrice, type HubLine, type TradeReading } from "@chronica/shared";
import { Tip, TipCard } from "../../../components/ui/tip";

/**
 * The markets of the power and the trade between them: bread in the granaries,
 * the six goods in the hubs its people buy and sell in against what they
 * ordinarily cost, the lanes that carry the most, the customs it lays, and the
 * pacts and embargoes that stand. A reading; whatever is to be done about it
 * is written as an order at the desk.
 */

const money = (amount: number): string => amount.toLocaleString("en-GB");
const rateWords = (rateBps: number): string => `${(rateBps / 100).toFixed(rateBps % 100 === 0 ? 0 : 1)} in a hundred`;
const months = (value: number): string => (value >= 10 ? `${Math.round(value)} months` : value >= 1.5 ? `${value.toFixed(1)} months` : value >= 0.5 ? "about a month" : "less than a month");
const versus = (bps: number): string => (bps >= 10_500 ? `${(bps / 10_000).toFixed(1)} times ordinary` : bps <= 9_500 ? `${Math.round(bps / 100)} in a hundred of ordinary` : "ordinary");

export function TradeSheet({ trade }: { readonly trade: TradeReading }) {
  return (
    <div className="books trade">
      <section className="books__side">
        <h3>Bread</h3>
        <p>
          {trade.grainMonths === null ? "No grain is reckoned in your markets." : <>Your granaries hold <strong>{months(trade.grainMonths)}</strong> of what your people eat, and grain sells at {versus(trade.grainBps)}.</>}
          {trade.shortHubs > 0 && <> <span className="is-short">{trade.shortHubs} of {trade.hubs} markets are short of grain.</span></>}
        </p>
      </section>

      <section className="books__side">
        <h3>Prices in your chief markets, against ordinary</h3>
        <table className="ledger trade__table">
          <thead>
            <tr className="ledger__head">
              <th scope="col">Market</th>
              {trade.main[0]?.goods.map((good) => <th key={good.good} scope="col" className="trade__good">{good.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {trade.main.map((hub) => <HubRow key={hub.hubId} hub={hub} />)}
          </tbody>
        </table>
      </section>

      {(trade.lanes.length > 0 || trade.customsRateBps > 0) && (
        <section className="books__side">
          <h3>Trade between powers</h3>
          {trade.lanes.length > 0 && (
            <ul className="ruled books__list">
              {trade.lanes.map((lane) => (
                <li key={`${lane.withLabel}:${lane.direction}`}>
                  <strong>{lane.direction === "to_us" ? `From ${lane.withLabel}` : `To ${lane.withLabel}`}</strong>
                  <span>{inTalents(lane.value)} of goods last month.</span>
                </li>
              ))}
            </ul>
          )}
          {trade.customsRateBps > 0 && <p>You lay customs of {rateWords(trade.customsRateBps)} on goods entering your markets from other powers.</p>}
        </section>
      )}

      {trade.pacts.length > 0 && (
        <section className="books__side">
          <h3>Pacts and embargoes in force</h3>
          <ul className="ruled books__list">
            {trade.pacts.map((pact) => (
              <li key={pact.key} className={pact.kind === "embargo" ? "is-strained" : undefined}>
                <strong>{pact.kind === "trade_pact" ? `Trade pact with ${pact.withLabel}` : pact.byUs ? `Your embargo on ${pact.withLabel}` : `Embargo laid by ${pact.withLabel}`}</strong>
                <span>{pact.terms.charAt(0).toUpperCase()}{pact.terms.slice(1)}{pact.heldByWar ? ". Held by the war; it comes back with the peace" : ""}.</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HubRow({ hub }: { readonly hub: HubLine }) {
  return (
    <tr>
      <th scope="row">
        <Tip label={hub.name} note={() => (
          <TipCard kicker="A market" title={hub.name}>
            <p>{money(hub.people)} of your people buy and sell here.</p>
            <p>{hub.grainMonths === null ? "No grain is reckoned." : `Grain in store for ${months(hub.grainMonths)}.`}{hub.short && " It is short of grain."}</p>
            <ul className="why">
              {hub.goods.map((good) => <li key={good.good} className="why__sum"><span>{good.name}, a {good.unit}</span><span>{good.price.toLocaleString("en-GB", { maximumFractionDigits: 2 })} (ordinary {good.base})</span></li>)}
            </ul>
          </TipCard>
        )}>{hub.name}</Tip>
        {hub.short && <span className="is-short"> (short)</span>}
      </th>
      {hub.goods.map((good) => <PriceCell key={good.good} good={good} />)}
    </tr>
  );
}

function PriceCell({ good }: { readonly good: GoodPrice }) {
  const dear = good.bps >= 14_000;
  const cheap = good.bps <= 7_000;
  return <td className={dear ? "is-short" : undefined} title={`${good.name}: ${versus(good.bps)}`}>{(good.bps / 100).toFixed(0)}%{dear && <span className="visually-hidden"> (dear)</span>}{cheap && <span className="visually-hidden"> (cheap)</span>}</td>;
}
