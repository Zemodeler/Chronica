"use client";

import { useState, type ReactNode } from "react";
import { spanInWords, type Abroad, type PolityAgreementKind, type TreatyLine, type TreatyMoment, type TreatyPosture, type TreatyPower } from "@chronica/shared";
import { Era } from "../../../components/ui/era";
import { Tip, TipCard } from "../../../components/ui/tip";

/**
 * Where your power stands with every other: one card per power, grouped by
 * where you stand with it, and beside them the chosen power's dossier.
 *
 * Every word worth asking about has a note behind it -- a kind of treaty, a
 * day, a power, the government's regard, the letter a treaty came from --
 * and the notes have words of their own. The sheet says what is so; the
 * notes say what it means and how it came to be.
 */

const GROUP_ORDER: readonly Exclude<TreatyPosture, "ended">[] = ["war", "answer_to", "bound_to_us", "equals", "none"];
/** A truce or a dated treaty this close to its end is said on its card. */
const SOON_DAYS = 90;

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

function groupTitle(posture: TreatyPosture, polityLabel: string): string {
  switch (posture) {
    case "war": return "At war";
    case "answer_to": return `${polityLabel} answers to`;
    case "bound_to_us": return `Bound to ${polityLabel}`;
    case "equals": return "Between equals";
    case "none": return "No treaty";
    case "ended": return "Treaties that have ended";
  }
}

function postureLine(power: TreatyPower, polityLabel: string): string {
  switch (power.posture) {
    case "war": return power.lines.find((line) => line.kind === "war")?.throughLabel != null ? `At war, through ${power.lines.find((line) => line.kind === "war")!.throughLabel}` : "At war";
    case "answer_to": return `${polityLabel} answers to them`;
    case "bound_to_us": return `Bound to ${polityLabel}`;
    case "equals": return "Treaties between equals";
    case "none": return "No treaty stands";
    case "ended": return "Every treaty with them has ended";
  }
}

export function TreatiesSheet({ abroad, onWriteTo, onOpenLetters }: {
  readonly abroad: Abroad;
  /** Start a letter to them at the desk; absent for those who cannot give orders. */
  readonly onWriteTo?: ((polityLabel: string) => void) | undefined;
  readonly onOpenLetters?: (() => void) | undefined;
}) {
  const polityLabel = abroad.polityLabel ?? "Your power";
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = abroad.powers.find((power) => power.polityId === chosenId) ?? abroad.powers[0] ?? null;
  const byLabel = new Map(abroad.powers.map((power) => [power.label, power]));
  const ask: Ask = { abroad, polityLabel, byLabel };

  if (abroad.powers.length === 0 && abroad.between.length === 0) {
    return <p className="quiet">{polityLabel} has no dealings abroad that you know of.</p>;
  }

  const ended = abroad.powers.filter((power) => power.posture === "ended");
  return (
    <div className="treaties">
      <nav className="treaties__powers" aria-label="Powers">
        {GROUP_ORDER.map((posture) => {
          const powers = abroad.powers.filter((power) => power.posture === posture);
          if (powers.length === 0) return null;
          return (
            <section key={posture} className={`treaties__group treaties__group--${posture}`}>
              <h3>{groupTitle(posture, polityLabel)}{powers.length > 2 && <span className="treaties__count"> · {powers.length}</span>}</h3>
              <ul>
                {powers.map((power) => <PowerCard key={power.polityId} power={power} chosen={chosen?.polityId === power.polityId} onChoose={() => setChosenId(power.polityId)} ask={ask} />)}
              </ul>
            </section>
          );
        })}
        {(ended.length > 0 || abroad.between.length > 0) && (
          <p className="treaties__more">
            {ended.length > 0 && (
              <Tip label="Treaties that have ended" note={() => (
                <TipCard kicker="Treaties that have ended" title={`${ended.length} ${ended.length === 1 ? "power" : "powers"}`}>
                  <ul className="treaties__list">
                    {ended.map((power) => <li key={power.polityId}><button type="button" className="word-button" onClick={() => setChosenId(power.polityId)}>{power.label}</button></li>)}
                  </ul>
                </TipCard>
              )}>Ended · {ended.length}</Tip>
            )}
            {abroad.between.length > 0 && (
              <Tip label="Between other powers" note={() => (
                <TipCard kicker="Between other powers" title={`${abroad.between.length} ${abroad.between.length === 1 ? "dealing" : "dealings"}`}>
                  <ul className="treaties__between">
                    {abroad.between.map((entry) => (
                      <li key={entry.key} className={entry.kind === "war" ? "is-war" : undefined}>
                        <span><KindTip kind={entry.kind} ask={ask} /></span>
                        <strong>{entry.betweenLabel}</strong>
                        <em>since <MomentTip moment={entry.since} /></em>
                      </li>
                    ))}
                  </ul>
                </TipCard>
              )}>Between others · {abroad.between.length}</Tip>
            )}
          </p>
        )}
      </nav>

      {chosen !== null && (
        <Dossier key={chosen.polityId} power={chosen} ask={ask} onWriteTo={onWriteTo} onOpenLetters={onOpenLetters} />
      )}
    </div>
  );
}

interface Ask {
  readonly abroad: Abroad;
  readonly polityLabel: string;
  readonly byLabel: ReadonlyMap<string, TreatyPower>;
}

function postureWord(posture: TreatyPosture): string {
  switch (posture) {
    case "war": return "at war";
    case "answer_to": return "overlord";
    case "bound_to_us": return "bound";
    case "equals": return "equals";
    case "none": return "no treaty";
    case "ended": return "ended";
  }
}

function PowerCard({ power, chosen, onChoose, ask }: {
  readonly power: TreatyPower;
  readonly chosen: boolean;
  readonly onChoose: () => void;
  readonly ask: Ask;
}) {
  const kinds = [...new Set((power.posture === "ended" ? power.ended : power.lines).map((line) => line.kind))];
  const soon = power.lines.find((line) => line.until !== null && line.until.days >= 0 && line.until.days <= SOON_DAYS);
  const through = power.lines.find((line) => line.throughLabel !== null)?.throughLabel ?? null;
  return (
    <li className={["treaty-card", chosen ? "is-chosen" : null, power.posture === "war" ? "is-war" : null].filter(Boolean).join(" ")}>
      <button type="button" className="treaty-card__name" aria-pressed={chosen} onClick={onChoose}>
        {power.label}
        {power.letters.length > 0 && <span className="seal-dot"><span className="visually-hidden"> (a letter waits on your answer)</span></span>}
      </button>
      <span className="treaty-card__regard">
        <Tip label={`${power.label}: what stands`} note={() => (
          <TipCard kicker={postureLine(power, ask.polityLabel)} title={power.label}>
            {kinds.length > 0 && <p>{kinds.map((kind, index) => <span key={kind}>{index > 0 && ", "}<KindTip kind={kind} ask={ask} /></span>)}{through !== null && <> through <PowerName label={through} ask={ask} /></>}.</p>}
            {soon?.until != null && <p>Ends in <MomentTip moment={soon.until} words={spanInWords(soon.until.days)} />.</p>}
          </TipCard>
        )}>{postureWord(power.posture)}</Tip>
      </span>
    </li>
  );
}

function Dossier({ power, ask, onWriteTo, onOpenLetters }: {
  readonly power: TreatyPower;
  readonly ask: Ask;
  readonly onWriteTo?: ((polityLabel: string) => void) | undefined;
  readonly onOpenLetters?: (() => void) | undefined;
}) {
  return (
    <article className="treaties__dossier" aria-label={`${power.label}: where you stand`}>
      <header className="dossier__header">
        <p className="dossier__kicker">{postureLine(power, ask.polityLabel)}</p>
        <h3 className="dossier__title"><PowerTip power={power} ask={ask} /></h3>
        {power.regard !== null && <p className="dossier__regard"><RegardTip power={power} ask={ask} /></p>}
      </header>

      {power.letters.length > 0 && (
        <section className="dossier__section dossier__letters">
          <h4>Waiting on your answer</h4>
          <ul>
            {power.letters.map((letter) => (
              <li key={letter.id}>
                {letter.subject}
                {letter.previousRejection != null && <p><strong>Your earlier peace terms were rejected.</strong> {letter.previousRejection.reason}</p>}
                {letter.replyByLabel !== null && <em> Answer by <Era text={letter.replyByLabel} />.</em>}
              </li>
            ))}
          </ul>
          {onOpenLetters !== undefined && <button type="button" className="word-button" onClick={onOpenLetters}>Read it at the letter tray</button>}
        </section>
      )}

      {power.lines.length > 0 && (
        <section className="dossier__section">
          <h4>In force</h4>
          {power.lines.map((line) => <LineEntry key={line.key} line={line} power={power} ask={ask} />)}
        </section>
      )}

      {power.ended.length > 0 && (
        <p className="dossier__history">
          <Tip label="Before" note={() => (
            <TipCard kicker="Treaties that have ended" title={`Before (${power.ended.length})`}>
              <ol className="treaties__list">
                {power.ended.map((line) => (
                  <li key={line.key}>
                    <span className="dossier__years"><MomentTip moment={line.since} short />–{line.ended !== null && <MomentTip moment={line.ended.at} short />}</span>{" "}
                    <KindTip kind={line.kind} ask={ask} />{line.ended?.reason != null && <>. {line.ended.reason}</>}
                  </li>
                ))}
              </ol>
            </TipCard>
          )}>Before ({power.ended.length})</Tip>
        </p>
      )}

      {power.lines.length === 0 && power.ended.length === 0 && power.letters.length === 0 && (
        <p className="quiet">No treaty has ever stood between you that you know of.</p>
      )}

      {onWriteTo !== undefined && (
        <footer className="dossier__actions">
          <button type="button" className="btn" onClick={() => onWriteTo(power.label)}>Write to {power.label}</button>
        </footer>
      )}
    </article>
  );
}

function LineEntry({ line, power, ask }: { readonly line: TreatyLine; readonly power: TreatyPower; readonly ask: Ask }) {
  return (
    <div className={line.kind === "war" ? "treaty-line is-war" : "treaty-line"}>
      <p className="treaty-line__head">
        <KindTip kind={line.kind} ask={ask} capital line={line} power={power} />
        <span> · since <MomentTip moment={line.since} /></span>
        {line.until !== null && <span> · until <MomentTip moment={line.until} /></span>}
        {line.secret && <span> · <SecretTip ask={ask} power={power} /></span>}
      </p>
      <p className="treaty-line__summary">{line.summary}.</p>
    </div>
  );
}

/* ─── The notes ─────────────────────────────────────────────────────── */

function KindTip({ kind, ask, capital = false, line, power }: { readonly kind: PolityAgreementKind; readonly ask: Ask; readonly capital?: boolean; readonly line?: TreatyLine; readonly power?: TreatyPower }) {
  const entry = ask.abroad.glossary[kind];
  if (entry === undefined) return <>{kind}</>;
  const words = capital ? capitalise(entry.label) : entry.label;
  return (
    <Tip label={`What a ${entry.label} is`} note={() => (
      <TipCard kicker="A kind of treaty" title={capitalise(entry.label)}>
        <p>{entry.explained}</p>
        {line !== undefined && (
          <>
            {line.terms.length > 0 && <p className="tip__rule"><em>{line.terms}</em></p>}
            {line.throughLabel !== null && <p>Through <PowerName label={line.throughLabel} ask={ask} />.</p>}
            {line.kind === "war" && power?.sides != null && (power.sides.yours.length > 0 || power.sides.theirs.length > 0) && (
              <p>
                {power.sides.yours.length > 0 && <span>Beside {line.throughLabel ?? ask.polityLabel}: <Names labels={power.sides.yours} ask={ask} />. </span>}
                {power.sides.theirs.length > 0 && <span>Beside {power.label}: <Names labels={power.sides.theirs} ask={ask} />.</span>}
              </p>
            )}
            {line.letter !== null && <p>Made by <LetterTip line={line} />.</p>}
          </>
        )}
      </TipCard>
    )}>{words}</Tip>
  );
}

const yearOf = (label: string): string => label.split(" ").slice(-2).join(" ");

function MomentTip({ moment, words, short = false }: { readonly moment: TreatyMoment; readonly words?: string; readonly short?: boolean }) {
  if (moment.label === null) return null;
  const shown = moment.beforeTheStory ? (short ? "before" : "before these annals") : words ?? (short ? yearOf(moment.label) : moment.label);
  const distance = moment.days === 0 ? "Today." : moment.days < 0 ? `${capitalise(spanInWords(moment.days))} ago.` : `In ${spanInWords(moment.days)}.`;
  return (
    <Tip label="When" note={() => (
      <TipCard kicker="A day" title={moment.beforeTheStory ? "Before these annals begin" : <Era text={moment.label!} />}>
        <p>{moment.beforeTheStory ? "It was made before the story opens, and stood when it began. Its terms say when, if they say." : distance}</p>
      </TipCard>
    )}><Era text={shown} /></Tip>
  );
}

function RegardTip({ power, ask }: { readonly power: TreatyPower; readonly ask: Ask }) {
  const regard = power.regard;
  if (regard === null) return null;
  return (
    <Tip label={`How ${ask.polityLabel}'s government regards ${power.label}`} note={() => (
      <TipCard kicker={`${ask.polityLabel}'s government`} title={capitalise(regard.inWords)}>
        <p>{regard.why}</p>
        <p className="tip__rule">So since <MomentTip moment={regard.at} />. Known to those who govern.</p>
      </TipCard>
    )}>{regard.inWords}</Tip>
  );
}

function SecretTip({ ask, power }: { readonly ask: Ask; readonly power: TreatyPower }) {
  return (
    <Tip label="Made in private" note={() => (
      <TipCard kicker="Secret" title="Made in private">
        <p>Known only to those who govern {ask.polityLabel} or {power.label}, and to those who did while it stood. A war, a peace or a truce can never be kept this way.</p>
      </TipCard>
    )}>made in private</Tip>
  );
}

function LetterTip({ line }: { readonly line: TreatyLine }) {
  const letter = line.letter!;
  return (
    <Tip label="The letter it came from" note={() => (
      <TipCard kicker="A letter" title={letter.subject}>
        <p>From {letter.fromLabel}, sent <MomentTip moment={letter.sent} />.</p>
        {letter.answerLabel !== null && <p>{letter.answerLabel}.</p>}
      </TipCard>
    )}>a letter from {letter.fromLabel}</Tip>
  );
}

/** A power's name, with its own note where the sheet knows it. */
function PowerName({ label, ask }: { readonly label: string; readonly ask: Ask }) {
  const power = ask.byLabel.get(label);
  return power === undefined ? <>{label}</> : <PowerTip power={power} ask={ask} />;
}

function Names({ labels, ask }: { readonly labels: readonly string[]; readonly ask: Ask }) {
  const parts: ReactNode[] = [];
  labels.forEach((label, index) => {
    if (index > 0) parts.push(index === labels.length - 1 ? " and " : ", ");
    parts.push(<PowerName key={label} label={label} ask={ask} />);
  });
  return <>{parts}</>;
}

function PowerTip({ power, ask }: { readonly power: TreatyPower; readonly ask: Ask }) {
  return (
    <Tip label={power.label} note={() => <PowerNote power={power} ask={ask} />}>{power.label}</Tip>
  );
}

function PowerNote({ power, ask }: { readonly power: TreatyPower; readonly ask: Ask }) {
  const kinds = [...new Set(power.lines.map((line) => line.kind))];
  // Its dealings with others, a kind at a time: "foedus with the Samnites,
  // the Lucanians and six more" reads; eight lines of foedus do not.
  const elsewhere = new Map<PolityAgreementKind, string[]>();
  for (const entry of power.elsewhere) elsewhere.set(entry.kind, [...(elsewhere.get(entry.kind) ?? []), entry.withLabel]);
  return (
    <TipCard kicker={postureLine(power, ask.polityLabel)} title={power.label}>
      {kinds.length > 0 && (
        <p>With {ask.polityLabel}: {kinds.map((kind, index) => <span key={kind}>{index > 0 && ", "}<KindTip kind={kind} ask={ask} /></span>)}.</p>
      )}
      {power.regard !== null && <p>Held <RegardTip power={power} ask={ask} /> by {ask.polityLabel}&rsquo;s government.</p>}
      {elsewhere.size > 0 && (
        <ul className="tip__rule">
          {[...elsewhere].map(([kind, labels]) => (
            <li key={kind}>
              <KindTip kind={kind} ask={ask} capital /> with {labels.length > 3 ? `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more` : labels.join(labels.length === 2 ? " and " : ", ")}
            </li>
          ))}
        </ul>
      )}
      {power.letters.length > 0 && <p>{power.letters.length === 1 ? "A letter from them waits on your answer." : `${power.letters.length} letters from them wait on your answer.`}</p>}
    </TipCard>
  );
}
