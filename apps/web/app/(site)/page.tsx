import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusMessage } from "../components/status-message";
import { DeleteSaveForm } from "../components/delete-save-form";
import { Era } from "../components/ui/era";
import { gameRepository, type GameSummaryRow, type SaveFacts } from "../../lib/game-repository";
import { roomStyleFor } from "../games/[gameId]/components/office-objects";
import { Landing } from "./landing";

export const metadata: Metadata = { title: "Chronica" };

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const params = await searchParams;
  let saves: Awaited<ReturnType<typeof gameRepository.listGames>>;
  try {
    saves = await gameRepository.listGames();
  } catch (error) {
    // Signed out: the first screen says what Chronica is, rather than
    // sending a stranger straight to a login form.
    if (error instanceof Error && error.message === "An account is required to list saves.") {
      return <Landing worlds={await gameRepository.previewWorlds()} />;
    }
    throw error;
  }
  const { hosted, activeHostedCount } = saves;
  const atCap = activeHostedCount >= 3;

  return (
    <main id="main-content" className="hub">
      {params.status === "left" && (
        <StatusMessage id="status">The save is no longer open.</StatusMessage>
      )}
      {params.status === "deleted" && (
        <StatusMessage id="status">The save and all of its game data were permanently deleted.</StatusMessage>
      )}

      <div className="hub__head">
        <h1>Your games</h1>
        {hosted.length > 0 && !atCap && <a className="btn btn--quiet" href="/worlds">Begin another world</a>}
      </div>

      {hosted.length === 0 ? (
        <EmptyShelf />
      ) : (
        <Suspense fallback={<ShelfSkeleton rows={hosted.length - 1} />}>
          <Shelf hosted={hosted} />
        </Suspense>
      )}

      {atCap && (
        <p className="hub__cap">You have three saves open, which is the most an account can keep. Delete one to begin another world.</p>
      )}
    </main>
  );
}

/** The saves, once their facts are read: the one to go back to, then the rest. */
async function Shelf({ hosted }: { readonly hosted: readonly GameSummaryRow[] }) {
  const facts = await gameRepository.describeSaves(hosted.map((game) => game.gameId));
  const open = hosted.filter((game) => game.status === "lobby" || game.status === "active");
  const featured = open[0] ?? null;
  const shelf = hosted.filter((game) => game !== featured);
  return (
    <>
      {featured !== null && <FeaturedSave game={featured} facts={facts.get(featured.gameId)} />}
      {shelf.length > 0 && (
        <section aria-labelledby="shelf-heading" className="shelf">
          <h2 id="shelf-heading" className="shelf__heading">{featured === null ? "Your saves" : "Your other saves"}</h2>
          <ol className="shelf__rows">
            {shelf.map((game) => <SaveRow key={game.gameId} game={game} facts={facts.get(game.gameId)} />)}
          </ol>
        </section>
      )}
    </>
  );
}

/** No saves: the player's room, not yet lit, and the way to a world. */
function EmptyShelf() {
  return (
    <section className="save-room" aria-labelledby="shelf-empty-heading">
      <img className="save-room__art" src="/office/neutral-room-empty.webp" alt="" width={1280} height={720} />
      <div className="save-room__words">
        <h2 id="shelf-empty-heading" className="save-room__name">Nobody yet.</h2>
        <p className="save-room__last">Choose a world, then decide who you will be in it: a consul, a merchant, a soldier in the ranks, or someone of your own invention.</p>
        <div className="save-room__actions">
          <a className="btn btn--primary btn--large" href="/worlds">Find a world</a>
        </div>
      </div>
    </section>
  );
}

/** The save to go back to: its room, who you are there, and where the story stands. */
function FeaturedSave({ game, facts }: { readonly game: GameSummaryRow; readonly facts: SaveFacts | undefined }) {
  const character = facts?.character ?? null;
  const waiting = character === null;
  const role = character?.role ?? null;
  return (
    <section className="save-room" aria-labelledby="featured-save-heading">
      <img className="save-room__art" src={roomImage(facts)} alt="" width={1280} height={720} />
      <details className="save-menu">
        <summary className="btn btn--quiet btn--small">Manage</summary>
        <div className="save-menu__list">
          <DeleteSaveForm gameId={game.gameId} title={game.title} />
        </div>
      </details>
      <div className="save-room__words">
        <p className="save-room__where">
          {role === null ? game.title : `${role}, in ${game.title}`}
          {facts !== undefined && <>. It is <Era text={facts.dateLabel} />.</>}
        </p>
        <h2 id="featured-save-heading" className="save-room__name">{waiting ? "Nobody yet" : character.name}</h2>
        {waiting ? (
          <p className="save-room__last">This world is waiting for you to decide who you will be in it.</p>
        ) : facts?.lastRecorded !== null && facts?.lastRecorded !== undefined ? (
          <p className="save-room__last">The Chronicle last recorded <q>{facts.lastRecorded}</q>.</p>
        ) : (
          <p className="save-room__last">Nothing has been recorded yet. The world is waiting for your first order.</p>
        )}
        <div className="save-room__actions">
          <a className="btn btn--primary btn--large" href={`/games/${game.gameId}`}>
            {waiting ? "Choose who you will be" : `Continue as ${firstName(character.name)}`}
          </a>
        </div>
      </div>
    </section>
  );
}

/** Every other save, one ruled row each. */
function SaveRow({ game, facts }: { readonly game: GameSummaryRow; readonly facts: SaveFacts | undefined }) {
  const character = facts?.character ?? null;
  const over = game.status === "finished" || game.status === "abandoned";
  return (
    <li className="save-row" data-over={over ? "true" : undefined}>
      <img className="save-row__thumb" src={roomImage(facts)} alt="" width={320} height={180} loading="lazy" />
      <div className="save-row__body">
        <h3 className="save-row__title">{character?.name ?? game.title}</h3>
        <p className="save-row__meta">{describeRow(game, facts)}</p>
      </div>
      <div className="save-row__actions">
        <a className="btn btn--quiet btn--small" href={`/games/${game.gameId}`}>{over ? "Read it" : character === null ? "Choose who you will be" : "Continue"}</a>
        <DeleteSaveForm gameId={game.gameId} title={game.title} />
      </div>
    </li>
  );
}

/** The shelf's shape while the saves' facts are read. */
function ShelfSkeleton({ rows }: { readonly rows: number }) {
  return (
    <div className="shelf-skeleton" aria-busy="true" aria-label="Loading your games">
      <div className="skeleton save-room" />
      {rows > 0 && (
        <div className="shelf__rows">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="save-row">
              <div className="skeleton save-row__thumb" />
              <div className="save-row__body">
                <div className="skeleton skeleton--line" />
                <div className="skeleton skeleton--line skeleton--short" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function describeRow(game: GameSummaryRow, facts: SaveFacts | undefined): string {
  const where = facts === undefined ? game.title : `${game.title}, ${facts.dateLabel}`;
  if (game.status === "finished") return `${where}. The story is over.`;
  if (game.status === "abandoned") return `${where}. Left unfinished.`;
  const character = facts?.character ?? null;
  if (character === null) return `${where}. Waiting for a character.`;
  return character.role === null ? `${where}.` : `${character.role} in ${where}.`;
}

function roomImage(facts: SaveFacts | undefined): string {
  const character = facts?.character ?? null;
  const style = character === null ? "neutral" : roomStyleFor(character.cultureId, character.polityId);
  return `/office/${style}-room-empty.webp`;
}

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}
