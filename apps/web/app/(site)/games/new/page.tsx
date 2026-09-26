import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createGame } from "../../../actions";
import { StatusMessage } from "../../../components/status-message";
import { gameRepository } from "../../../../lib/game-repository";

export const metadata: Metadata = { title: "Start a game" };

export default async function NewGamePage({ searchParams }: Readonly<{ searchParams: Promise<{ scenario?: string; status?: string }> }>) {
  const { scenario: scenarioId, status } = await searchParams;
  if (scenarioId === undefined) redirect("/worlds");
  const scenario = await gameRepository.getPublicScenario(scenarioId);
  if (scenario === null) notFound();

  return <main id="main-content" className="shell"><header className="page-header"><p className="eyebrow">{scenario.period}</p><h1>Begin {scenario.title}</h1><p className="lede">Create your single-player save and enter the world.</p></header>
    {status === "invalid" && <StatusMessage kind="error">Give the save a title and a coin cap.</StatusMessage>}
    {status === "save-limit" && <StatusMessage kind="error">You already have three active saves. End or replace one before starting another.</StatusMessage>}
    {status === "unavailable" && <StatusMessage kind="error">That world is no longer available to host.</StatusMessage>}
    <section className="panel" aria-labelledby="settings-heading"><h2 id="settings-heading">Save settings</h2><form action={createGame}>
      <input type="hidden" name="scenarioId" value={scenario.scenarioId} />
      <label htmlFor="title">Match title</label><input id="title" name="title" defaultValue={scenario.title} minLength={3} maxLength={120} required />
      <label htmlFor="coinCap">Maximum coins this save may spend</label><input id="coinCap" name="coinCap" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" defaultValue="5" required /><p className="field-help">One coin equals US$1. The cap is pinned when the save is created.</p>
      <dl><dt>Scenario version</dt><dd>{scenario.version}</dd><dt>Mode</dt><dd>Single-player</dd></dl><button type="submit">Start and enter map</button></form></section>
  </main>;
}
