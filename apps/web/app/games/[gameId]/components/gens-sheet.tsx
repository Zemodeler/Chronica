"use client";

import type { GensReading } from "@chronica/shared";

/**
 * Your gens: the family you are of, as the city knows it.
 *
 * Who you are in it and what your name is worth to the electors (a noble, of a noble gens, or a new man), the images in
 * the atrium, the rites it keeps, its living men and women, the clients who look to it, the families it has married into and the ones it
 * has a grudge against. Every line is public in the forum, so nothing is withheld; the words are the age's, and there are no figures
 * beyond the ones a Roman would have counted (the consuls, the images, the years).
 */
export function GensSheet({ gens }: { readonly gens: GensReading }) {
  return (
    <div className="standing gens">
      <section className="standing__section sheet-section">
        <h3>{gens.name.replace(/^the /, "The ")}</h3>
        <p>{gens.kindLabel}. {gens.you}</p>
        <p className="gens__name"><strong>{gens.nobilitas.label}.</strong> {gens.nobilitas.sentence}</p>
        <p>{gens.weight}</p>
        {gens.yourHonours !== null && <p>{gens.yourHonours}</p>}
        {gens.imagines !== null && <p>{gens.imagines}</p>}
        {gens.head !== null && <p>{gens.head.you ? "You are the first man of the gens." : `${gens.head.name} is the first man of the gens.`}</p>}
        {gens.clients !== null && <p>{gens.clients}</p>}
      </section>

      {(gens.sacra.length > 0 || gens.tomb !== null) && (
        <section className="standing__section sheet-section">
          <h3>Rites and tomb</h3>
          {gens.sacra.length > 0 && <ul>{gens.sacra.map((rite) => <li key={rite}>{rite[0]!.toUpperCase()}{rite.slice(1)}.</li>)}</ul>}
          {gens.sacraKeeper !== null && <p className="quiet">{gens.sacraKeeper} carries them, and they stay in the gens.</p>}
          {gens.tomb !== null && <p>{gens.tomb[0]!.toUpperCase()}{gens.tomb.slice(1)}.</p>}
        </section>
      )}

      <section className="standing__section sheet-section">
        <h3>Your kin</h3>
        {gens.members.length === 0
          ? <p className="quiet">Nobody of the gens is living that is written down.</p>
          : <ul>
            {gens.members.map((member) => (
              <li key={member.name} className={member.you ? "standing__seat standing__seat--claimed" : "standing__seat"}>
                <strong>{member.name}</strong>
                <span>{member.note ?? "of the gens"}</span>
                <em>{member.age === 1 ? "a year old" : `${member.age} years old`}</em>
              </li>
            ))}
          </ul>}
      </section>

      <section className="standing__section sheet-section">
        <h3>Friends by marriage</h3>
        {gens.alliances.length === 0
          ? <p className="quiet">No family is bound to yours by a marriage that is remembered.</p>
          : <ul>
            {gens.alliances.map((alliance) => (
              <li key={alliance.with} className="standing__seat">
                <strong>{alliance.with.replace(/^the /, "The ")}</strong>
                <span>Bound {alliance.how}.</span>
                <em>{alliance.strength}</em>
              </li>
            ))}
          </ul>}
      </section>

      <section className="standing__section sheet-section">
        <h3>Feuds</h3>
        {gens.feuds.length === 0
          ? <p className="quiet">Your gens has no quarrel with another that is spoken of.</p>
          : <ul>
            {gens.feuds.map((feud) => (
              <li key={feud.against} className="standing__seat">
                <strong>{feud.against.replace(/^the /, "The ")}</strong>
                <span>{feud.why}.</span>
                <em>{feud.heat}</em>
              </li>
            ))}
          </ul>}
      </section>

      {gens.honours.length > 0 && (
        <section className="standing__section sheet-section">
          <h3>Its latest honours</h3>
          <ul>{gens.honours.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
