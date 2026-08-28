import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createGame } from "../../actions";
import { StatusMessage } from "../../components/status-message";
import { gameRepository } from "../../../lib/game-repository";

export const metadata: Metadata = { title: "Host a game" };

export default async function NewGamePage({ searchParams }: Readonly<{ searchParams: Promise<{ scenario?: string; status?: string }> }>) {
  const { scenario: scenarioId, status } = await searchParams;
  if (scenarioId === undefined) redirect("/worlds");
  const scenario = await gameRepository.getPublicScenario(scenarioId);
  if (scenario === null) notFound();

  return <main id="main-content" className="shell"><header className="page-header"><p className="eyebrow">Shared world · {scenario.period}</p><h1>Host {scenario.title}</h1><p className="lede">Shared by {scenario.authorName}. Your match is saved to one of your active game slots as soon as it is created.</p></header>
    {status === "invalid" && <StatusMessage kind="error">Give the match a title, choose 1–32 players, a continuity allowance, and a coin cap.</StatusMessage>}
    {status === "unavailable" && <StatusMessage kind="error">That world is no longer available to host.</StatusMessage>}
    <section className="panel" aria-labelledby="settings-heading"><h2 id="settings-heading">Match settings</h2><form action={createGame}>
      <input type="hidden" name="scenarioId" value={scenario.scenarioId} />
      <label htmlFor="title">Match title</label><input id="title" name="title" defaultValue={scenario.title} minLength={3} maxLength={120} required />
      <label htmlFor="startingSeatCount">Players</label><input id="startingSeatCount" name="startingSeatCount" type="number" min="1" max="32" defaultValue={1} required /><p className="field-help">Chronica 1.0 is a solo character game.</p>
      <label htmlFor="extraPrincipalsPerPlayer">Extra principal characters per starting seat</label><select id="extraPrincipalsPerPlayer" name="extraPrincipalsPerPlayer" defaultValue="1"><option value="0">0</option><option value="1">1 (default)</option><option value="2">2</option><option value="3">3</option></select><p className="field-help">Pinned when play begins; the global principal cap remains 32.</p>
      <label htmlFor="coinCap">Maximum coins this save may spend</label><input id="coinCap" name="coinCap" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" defaultValue="5" required /><p className="field-help">One coin equals US$1. The cap is pinned when the save is created.</p>
      <dl><dt>Scenario version</dt><dd>{scenario.version}</dd><dt>News readiness timeout</dt><dd>60 seconds</dd></dl><button type="submit">Host and enter map</button></form></section>
  </main>;
}
