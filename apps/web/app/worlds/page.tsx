import type { Metadata } from "next";
import Image from "next/image";
import { gameRepository } from "../../lib/game-repository";

export const metadata: Metadata = { title: "Worlds" };

export default async function WorldsPage() {
  const worlds = await gameRepository.listPublicScenarios();
  return (
    <main id="main-content" className="dashboard-shell">
      <div className="world-rail">
        <h1 className="world-rail-label">Shared worlds</h1>
        <p className="worlds-hero-meta">Worlds other players have shared publicly. Local testing may also show DEMO World.</p>
        {worlds.length === 0 ? <section className="panel"><h2>No shared worlds yet</h2><p>When another player publishes a validated world, it will appear here.</p></section> : (
        <div className="world-grid">
          {worlds.map((world) => (
            <article key={world.scenarioId} className="world-card">
              <Image className="world-thumb" src="/images/basic-scenario-map.png" alt="" width={1280} height={720} unoptimized />
              <div className="world-card-body">
                <h3 className="world-card-title">{world.title}</h3>
                <p className="world-card-meta">{world.period} · by {world.authorName} · {world.recommendedPlayers} players recommended</p>
                {world.scenarioId.startsWith("private-") && <p className="field-help">Local testing fixture — never shown in production.</p>}
                <a className="button sm" href={`/games/new?scenario=${encodeURIComponent(world.scenarioId)}`}>Host this world</a>
              </div>
            </article>
          ))}
        </div>
        )}
      </div>
    </main>
  );
}
