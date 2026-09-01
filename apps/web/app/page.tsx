import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { StatusMessage } from "./components/status-message";
import { DeleteSaveForm } from "./components/delete-save-form";
import { gameRepository } from "../lib/game-repository";

export const metadata: Metadata = { title: "Chronica" };

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const params = await searchParams;
  let saves: Awaited<ReturnType<typeof gameRepository.listGames>>;
  try {
    saves = await gameRepository.listGames();
  } catch (error) {
    if (error instanceof Error && error.message === "An account is required to list saves.") {
      redirect("/login?returnTo=%2F");
    }
    throw error;
  }
  const { hosted, activeHostedCount } = saves;
  const featured = hosted.find((game) => game.status === "lobby" || game.status === "active") ?? null;
  const atCap = activeHostedCount >= 3;

  return (
    <main id="main-content" className="dashboard-shell">
      {params.status === "left" && (
        <StatusMessage id="status">The save is no longer open.</StatusMessage>
      )}
      {params.status === "deleted" && (
        <StatusMessage id="status">The save and all of its game data were permanently deleted.</StatusMessage>
      )}

      <div className="dashboard-heading">
        <h1>Your Games</h1>
        <a className="button" href="/worlds">Find a world</a>
      </div>

      {featured !== null && (
        <section className="featured-card" aria-label="Continue playing">
          <Image className="featured-thumb" src="/images/basic-scenario-map.png" alt="" width={1280} height={720} unoptimized />
          <div className="featured-content">
            <h2 className="featured-title">{featured.title}</h2>
            <p className="featured-meta">
              {saveStatusLabel(featured.status)}
            </p>
            <div className="featured-actions">
              <a className="button" href={`/games/${featured.gameId}`}>Continue</a>
            </div>
          </div>
        </section>
      )}

      <section aria-label="Your saves">
        <div className="slot-rail">
          {hosted.map((game, i) => (
            <article key={game.gameId} className="slot-card">
              <div className="slot-thumb">
                <Image src="/images/basic-scenario-map.png" alt="" width={1280} height={720} unoptimized />
                <span className="slot-number">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="slot-body">
                <h3 className="slot-title">{game.title}</h3>
                <p className="slot-meta">
                  {saveStatusLabel(game.status)}
                </p>
                <div className="slot-actions">
                  <a className="button sm" href={`/games/${game.gameId}`}>{game.status === "finished" || game.status === "abandoned" ? "View" : "Continue"}</a>
                  <DeleteSaveForm gameId={game.gameId} title={game.title} />
                </div>
              </div>
            </article>
          ))}
          {!atCap && (
            <article className="slot-card slot-card-new">
              <div className="slot-thumb slot-thumb-new">
                <span className="slot-number">{String(activeHostedCount + 1).padStart(2, "0")}</span>
              </div>
              <div className="slot-body">
                <h3 className="slot-title">New save</h3>
                <p className="slot-meta">Start a world</p>
                <div className="slot-actions">
                  <a className="button sm" href="/worlds">Find a world</a>
                </div>
              </div>
            </article>
          )}
        </div>
      </section>

    </main>
  );
}

function saveStatusLabel(status: string): string {
  switch (status) {
    case "lobby": return "Preparing your character";
    case "active": return "Paused · ready to continue";
    case "finished": return "Finished";
    case "abandoned": return "Abandoned";
    default: return status;
  }
}
