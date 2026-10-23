import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { modernWordsIn, readOffice, type OfficeView, type WorldState } from "@chronica/shared";
import { government, opening } from "../../../../../../packages/sim/src/competence-test-kit";
import { OfficeSheet } from "./office-sheet";

/**
 * Your charge, drawn from the Punic opening for the three kinds of office the page was built for: a consul (his colleague, the Senate, the quaestors,
 * the tribunes' reach), a king (his friends and officers) and a suffete (his colleague, the Elders and the Hundred and Four), and for a man with no office.
 */
const world = opening(200);
const read = (id: string, from: WorldState = world): OfficeView => readOffice(from, id, government.offices, undefined, government.successionRules);
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const POWERS = ["Carthage", "Syracuse"];

function privateMan(): { world: WorldState; id: string } {
  const model = world.characters.find((character) => character.id === "gnaeus-cornelius")!;
  return { id: "nobody-of-rome", world: { ...world, characters: [...world.characters, { ...model, id: "nobody-of-rome", name: "Nobody of Rome", officeId: null, officesHeld: [], relations: [] }] } };
}

describe("your charge", () => {
  it("shows a consul what is his alone, with his colleague and by the Senate, the chambers, the quaestors and the tribunes' reach", () => {
    const html = renderToStaticMarkup(<OfficeSheet office={read("gnaeus-cornelius")} powers={POWERS} onDraft={() => undefined} />);
    const plain = text(html);
    expect(plain).toContain("Your charge");
    expect(plain).toContain("Roman consul");
    expect(plain).toContain("With your colleague");
    expect(plain).toContain("To 12 in a hundred");
    expect(plain).toContain("Laid before the Senate");
    expect(plain).toContain("The chambers you sit in and answer to");
    expect(plain).toContain("Whose word reaches over you");
    expect(plain).toContain("Tribune of the plebs");
    expect(plain).toContain("Roman quaestor");
    expect(plain).toContain("Your colleague and the magistrates");
    expect(plain).toContain("He may draw");
    expect(plain).toContain("Make war");
    // The acts are drafted as orders for the desk, and the ones that are the Senate's say so.
    expect(plain).toContain("Draft the order");
    expect(plain).toContain("lay it before the Senate");
    expect(plain).toContain("Power");
  });

  it("shows a king his friends and officers, every act his own, and nobody whose word stops his", () => {
    const html = renderToStaticMarkup(<OfficeSheet office={read("hieron-ii")} powers={POWERS} onDraft={() => undefined} />);
    const plain = text(html);
    expect(plain).toContain("Your friends and your officers");
    expect(plain).toContain("The king&#x27;s friends");
    expect(plain).toContain("Syracusan strategos");
    expect(plain).toContain("Yours alone");
    expect(plain).not.toContain("Whose word reaches over you");
    expect(plain).not.toContain("With your colleague");
    expect(plain).toContain("a monarchy");
  });

  it("shows a suffete his colleague, the Council of Elders that holds his acts and the Hundred and Four who try him", () => {
    const html = renderToStaticMarkup(<OfficeSheet office={read("carthage-suffete-34gglr")} powers={POWERS} />);
    const plain = text(html);
    expect(plain).toContain("Carthaginian suffete");
    expect(plain).toContain("Council of Elders");
    expect(plain).toContain("Tribunal of the Hundred and Four");
    expect(plain).toContain("Carthaginian suffete");
    expect(plain).toContain("Officer of the Accounts");
    // Without a desk to write at there are no buttons to draft an order.
    expect(plain).not.toContain("Draft the order");
  });

  it("shows an elder his seat and no charge, and a private man what binds him and who could move a chamber", () => {
    const elder = text(renderToStaticMarkup(<OfficeSheet office={read("carthage-elder-1k7ahq")} />));
    expect(elder).toContain("a voice and a seat");
    const { world: there, id } = privateMan();
    const html = renderToStaticMarkup(<OfficeSheet office={read(id, there)} />);
    const plain = text(html);
    expect(plain).toContain("Your place in Roman Republic");
    expect(plain).toContain("You hold no charge in Roman Republic");
    expect(plain).toContain("What a patron could move");
    expect(plain).not.toContain("Draft the order");
  });

  it("says nothing of a man who belongs to no power", () => {
    expect(text(renderToStaticMarkup(<OfficeSheet office={readOffice(world, "nobody-at-all", government.offices)} />))).toContain("belong to no power");
  });

  it("uses no modern word anywhere on the page", () => {
    const { world: there, id } = privateMan();
    for (const [from, who] of [[world, "gnaeus-cornelius"], [world, "rome-quaestor-gosxrz"], [world, "rome-tribune-ujbc0s"], [world, "carthage-suffete-34gglr"], [world, "hieron-ii"], [there, id]] as const) {
      const html = renderToStaticMarkup(<OfficeSheet office={read(who, from)} powers={POWERS} onDraft={() => undefined} onOpenBooks={() => undefined} />);
      expect(modernWordsIn(text(html)), who).toEqual([]);
    }
  });
});
