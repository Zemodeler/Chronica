import type { Metadata } from "next";
import { Era } from "../../components/ui/era";
import { gameRepository } from "../../../lib/game-repository";
import type { WorldEntry } from "../../../lib/world-catalogue";

export const metadata: Metadata = { title: "Worlds" };

/**
 * The first world leads across the page; the rest sit beside their plates,
 * alternating. Past three of those, alternation turns into a rhythm the eye
 * stops reading, so they fall into a two-column grid instead.
 */
export default async function WorldsPage() {
  const worlds = await gameRepository.listWorlds();
  const [lead, ...rest] = worlds;
  return (
    <main id="main-content" className="worlds-page">
      <header className="worlds-page__head">
        <h1>Worlds</h1>
        <p>Each world begins on a particular day and waits for you. Choose one, then decide who you will be in it.</p>
      </header>
      {lead !== undefined && <LeadWorld world={lead} />}
      {rest.length > 0 && (
        <ol className={rest.length > 3 ? "world-list world-list--grid" : "world-list"}>
          {rest.map((world) => (
            <li key={world.summary.scenarioId} className="world world-card" aria-labelledby={`world-${world.summary.scenarioId}`}>
              <Plate world={world} />
              <WorldWords world={world} />
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function LeadWorld({ world }: { readonly world: WorldEntry }) {
  return (
    <section className="world-lead world-card" aria-labelledby={`world-${world.summary.scenarioId}`}>
      <Plate world={world} />
      <WorldWords world={world} />
    </section>
  );
}

function Plate({ world }: { readonly world: WorldEntry }) {
  const { summary, opensOn, plate } = world;
  if (plate === null) {
    // No key art yet: the world's name and day, set like a title page.
    return (
      <div className="world__plate world__plate--title" aria-hidden="true">
        <span className="world__plate-name">{summary.title}</span>
        {opensOn !== null && <span className="world__plate-date"><Era text={opensOn} /></span>}
      </div>
    );
  }
  return <img className="world__plate" src={plate} alt="" width={1920} height={1200} loading="lazy" />;
}

function WorldWords({ world }: { readonly world: WorldEntry }) {
  const { summary, opensOn, people, premise } = world;
  return (
    <div className="world__words">
      <h2 className="world__title" id={`world-${summary.scenarioId}`}>{summary.title}</h2>
      {opensOn !== null && <p className="world__when">It opens on <Era text={opensOn} />.</p>}
      {premise.length > 0 && <p className="world__premise">{premise}</p>}
      {people.length > 0 && (
        <div className="world__people">
          <p>You might be</p>
          <ul>
            {people.map((person) => (
              <li key={person.name}>
                <span className="world__person">{person.name}</span>
                {person.role !== null && <span className="world__person-role">{person.role}</span>}
              </li>
            ))}
          </ul>
          <p>or anyone else you can describe.</p>
        </div>
      )}
      <a className="btn btn--primary btn--large" href={`/games/new?scenario=${encodeURIComponent(summary.scenarioId)}`}>Begin this world</a>
    </div>
  );
}
