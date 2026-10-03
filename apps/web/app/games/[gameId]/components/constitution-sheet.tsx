"use client";

import type { ConstitutionReading, StateReading } from "@chronica/shared";
import { Era } from "../../../components/ui/era";
import { Explains, Linkify, LinkedName } from "./notes";
import { Fact, Facts, Registry, RegistryRow, Unknown } from "./registry";

/**
 * How the state is governed, and how it came to be so.
 *
 * Public to anyone of the power: a citizen with no office reads it the same
 * as a consul. The present government is the state's own reading
 * (`readTheState`); the timeline is its stored history of changes
 * (`readConstitutionHistory`), newest first, and says plainly where the record
 * runs out.
 */
export function ConstitutionSheet({ state, constitution, onOpenLaw }: {
  readonly state: StateReading;
  readonly constitution: ConstitutionReading;
  /** Open the measure that made a change, where the record kept it. */
  readonly onOpenLaw?: ((procedureId: string) => void) | undefined;
}) {
  const government = state.government;
  return (
    <div className="standing constitution">
      <section className="standing__section sheet-section">
        <h3>{state.polityLabel === null ? "How it is governed" : `How ${state.polityLabel} is governed`}</h3>
        {government === null
          ? <p className="quiet">No constitution has been written down for this power.</p>
          : <>
            <p>
              It is <Explains k={`form:${government.form}`}>{government.formLabel}</Explains>
              {government.rulerLabel !== null ? <>, headed by its <Linkify text={government.rulerLabel} /></> : null}.
              {government.sovereignLabel !== null && <> The <Linkify text={government.sovereignLabel} /> may change how it is governed.</>}
            </p>
            {constitution.sinceLabel !== null && <p className="quiet"><Era text={constitution.sinceLabel} />.</p>}
          </>}
      </section>

      <section className="standing__section sheet-section">
        <h3>How it came to be</h3>
        {constitution.entries.length === 0
          ? <p className="quiet">No change to the constitution is recorded.</p>
          : <Registry label="Changes to the constitution, newest first">
            {constitution.entries.map((entry) => (
              <RegistryRow
                key={entry.key}
                id={entry.key}
                title={entry.headline}
                meta={<Era text={entry.dateLabel} />}
                sentence={<>{entry.how}{entry.by !== null && <>. <LinkedName linked={entry.by} /></>}</>}
              >
                <Facts>
                  <Fact term="What changed">{entry.what}</Fact>
                  {entry.detail.voteLabel !== null && <Fact term="The vote">{entry.detail.voteLabel}</Fact>}
                  {entry.detail.fromLabel !== null && <Fact term="Before">{capitalise(entry.detail.fromLabel)}</Fact>}
                  <Fact term="After">{capitalise(entry.detail.toLabel)}</Fact>
                </Facts>
                {entry.detail.procedureId !== null && onOpenLaw !== undefined && (
                  <button type="button" className="registry__link" onClick={() => onOpenLaw(entry.detail.procedureId!)}>See the measure</button>
                )}
                <Unknown lines={entry.detail.unknown} />
              </RegistryRow>
            ))}
          </Registry>}
        {constitution.beforeRecord !== null && <p className="registry__beyond">{constitution.beforeRecord}</p>}
      </section>
    </div>
  );
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
