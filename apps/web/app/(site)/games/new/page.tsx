import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createGame } from "../../../actions";
import { StatusMessage } from "../../../components/status-message";
import { gameRepository } from "../../../../lib/game-repository";
import { Era } from "../../../components/ui/era";

export const metadata: Metadata = { title: "Begin a world" };

export default async function NewGamePage({ searchParams }: Readonly<{ searchParams: Promise<{ scenario?: string; status?: string }> }>) {
  const { scenario: scenarioId, status } = await searchParams;
  if (scenarioId === undefined) redirect("/worlds");
  const world = await gameRepository.describeScenario(scenarioId);
  if (world === null) notFound();
  const scenario = world.summary;

  return (
    <main id="main-content" className="shell narrow begin-page">
      {world.plate !== null && <img className="begin-page__band" src={world.plate} alt="" width={1920} height={1200} />}
      <header className="page-header">
        <h1>Begin {scenario.title}</h1>
        {world.opensOn !== null && <p className="lede">The world opens on <Era text={world.opensOn} />. Next you will decide who you are in it.</p>}
      </header>
      {status === "invalid" && <StatusMessage kind="error">Give the save a name and a coin cap.</StatusMessage>}
      {status === "save-limit" && <StatusMessage kind="error">You already have three saves open. Delete one from Your games before beginning another.</StatusMessage>}
      {status === "unavailable" && <StatusMessage kind="error">That world is no longer available.</StatusMessage>}
      <form className="begin" action={createGame}>
        <input type="hidden" name="scenarioId" value={scenario.scenarioId} />
        <div className="begin__field">
          <label htmlFor="title">Name this save</label>
          <input id="title" name="title" defaultValue={scenario.title} minLength={3} maxLength={120} required />
        </div>
        <div className="begin__field">
          <label htmlFor="coinCap">The most this save may spend, in coins</label>
          <input id="coinCap" name="coinCap" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" defaultValue="5" required aria-describedby="coinCap-help" />
          <p className="field-help" id="coinCap-help">A coin is one US dollar. When the save has spent this much, it stops.</p>
          <details className="begin__more">
            <summary>How spending works</summary>
            <p>Every order is paid for by how much the world&rsquo;s people have to think about it, so no two cost the same; the desk tells you what each one came to. When this save has spent its cap it asks nothing more of your wallet. The cap is fixed once the save begins.</p>
          </details>
        </div>
        <button type="submit" className="btn btn--primary btn--large">Choose who you will be</button>
      </form>
    </main>
  );
}
