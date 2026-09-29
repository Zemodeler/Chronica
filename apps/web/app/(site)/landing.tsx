import { Era } from "../components/ui/era";
import type { WorldEntry } from "../../lib/world-catalogue";

/**
 * Who a player might be, as the landing page shows them. Each picture is
 * `public/stations/<slug>.webp`, made from the corresponding 270 BC paintings
 * in `public/images/history-270bc/`.
 */
const STATIONS = [
  { slug: "consul", title: "A consul of Rome", line: "Command the legions for a year, then answer to the Senate for what you did with them." },
  { slug: "senator", title: "A senator short of money", line: "Your vote is worth something. So are your debts." },
  { slug: "merchant", title: "A merchant of Carthage", line: "Ships, credit and a war that could ruin you." },
  { slug: "legionary", title: "A legionary in the ranks", line: "Your orders come from above. What you do with them is yours." },
] as const;

/**
 * What a stranger sees: what Chronica is, who you could be in it, how one
 * turn goes, and the worlds it has.
 *
 * The site is an invited playtest, so this explains rather than sells. The
 * Chronicle passage is the example from docs/VISION.md, and says so.
 */
export function Landing({ worlds }: { readonly worlds: readonly WorldEntry[] }) {
  const [lead, ...others] = STATIONS;
  const [wide, ...pair] = others;
  return (
    <main id="main-content" className="landing">
      <section className="landing-hero" aria-labelledby="landing-heading">
        <img className="landing-hero__room" src="/office/roman-room.webp" alt="" width={1920} height={1080} fetchPriority="high" />
        <div className="landing-wrap landing-hero__words">
          <h1 id="landing-heading">Play anyone.</h1>
          <p>Choose who you are in the Mediterranean of <Era text="270 BC" />. Write what you want. Read what the world did.</p>
          <div className="landing-hero__actions">
            <a className="btn btn--primary btn--large" href="/sign-up">Create an account</a>
          </div>
        </div>
      </section>

      <section className="landing-block landing-wrap" aria-labelledby="stations-heading">
        <h2 id="stations-heading">Who you could be</h2>
        <div className="stations">
          <Station station={lead} shape="tall" />
          <div className="stations__side">
            <Station station={wide} shape="wide" />
            <div className="stations__pair">
              {pair.map((station) => <Station key={station.slug} station={station} shape="square" />)}
            </div>
          </div>
        </div>
        <p className="stations__more">Or anyone else you can describe.</p>
      </section>

      <section className="landing-block landing-wrap" aria-labelledby="turn-heading">
        <h2 id="turn-heading">How a turn goes</h2>
        <div className="turn">
          <div className="turn__order">
            <h3>You write an order</h3>
            <p>There is no menu of verbs. Say what you want in plain words.</p>
            <p className="turn__wax">Raise two new legions.</p>
          </div>
          <div className="turn__answer">
            <div className="turn__step">
              <h3>The world moves</h3>
              <p>Nothing happens until you send it. Then word travels, people answer, and the calendar runs on.</p>
              <ol className="turn__trail" aria-label="An example of the world moving">
                <li>Recruiting officers ride into Latium and Campania</li>
                <li>The Senate hears what it will cost</li>
                <li>Word reaches Sicily</li>
              </ol>
            </div>
            <div className="turn__step">
              <h3>You read what happened</h3>
              <p>A Chronicle written only from what your character could know.</p>
              <figure className="turn__chronicle">
                <p className="turn__chronicle-date"><Era text="March to April 264 BC" /></p>
                <blockquote>
                  <p>Following the decision to expand the army, recruitment began throughout Latium and Campania. Two additional legions were ordered formed, financed through treasury reserves and short-term credit provided by prominent Roman merchants.</p>
                  <p>News of the mobilization reached Sicily within weeks. Carthaginian authorities responded by quietly strengthening their forces in the west of the island, while Syracuse dispatched envoys to determine Rome&rsquo;s intentions.</p>
                </blockquote>
                <figcaption>An example of the Chronicle.</figcaption>
              </figure>
            </div>
          </div>
        </div>
      </section>

      {worlds.length > 0 && (
        <section className="landing-block landing-wrap" aria-labelledby="worlds-heading">
          <h2 id="worlds-heading">Worlds</h2>
          <ul className="landing-worlds">
            {worlds.slice(0, 3).map(({ summary, opensOn, plate }) => (
              <li key={summary.scenarioId} className="landing-world">
                <img src={plate!} alt="" width={1920} height={1200} loading="lazy" />
                <h3>{summary.title}</h3>
                {opensOn !== null && <p>It opens on <Era text={opensOn} />.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="landing-close landing-wrap" aria-label="Create an account">
        <p>Choose who you will be.</p>
        <a className="btn btn--primary btn--large" href="/sign-up">Create an account</a>
      </section>
    </main>
  );
}

function Station({ station, shape }: { readonly station: (typeof STATIONS)[number]; readonly shape: "tall" | "wide" | "square" }) {
  return (
    <article className="station" data-shape={shape}>
      <img src={`/stations/${station.slug}.webp`} alt="" width={1600} height={900} loading="lazy" />
      <div className="station__words">
        <h3>{station.title}</h3>
        <p>{station.line}</p>
      </div>
    </article>
  );
}
