import type { Metadata } from "next";
import Image from "next/image";
import { gameRepository } from "../../lib/game-repository";

export const metadata: Metadata = { title: "Worlds" };

export default async function WorldsPage() {
  const worlds = await gameRepository.listPublicScenarios();
  return (
    <main id="main-content" className="dashboard-shell">
      <div className="world-rail">
        <h1 className="world-rail-label">Scenarios</h1>
        <p className="worlds-hero-meta">Choose a scenario and begin a single-player historical world.</p>
        {worlds.length === 0 ? <section className="panel"><h2>No scenarios yet</h2><p>Add a validated scenario to begin a game.</p></section> : (
        <div className="world-grid">
          {worlds.map((world) => (
            <article key={world.scenarioId} className="world-card">
              <Image className="world-thumb" src="/images/basic-scenario-map.png" alt="" width={1280} height={720} unoptimized />
              <div className="world-card-body">
                <h3 className="world-card-title">{world.title}</h3>
                <p className="world-card-meta">{world.period} · {world.authorName}</p>
                <a className="button sm" href={`/games/new?scenario=${encodeURIComponent(world.scenarioId)}`}>Begin scenario</a>
              </div>
            </article>
          ))}
        </div>
        )}
      </div>
    </main>
  );
}
