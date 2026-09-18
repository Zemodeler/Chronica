import { describe, expect, it } from "vitest";
import { ScenarioClockSchema, emitFacts, factsKnownTo, type Fact, type FactDraft } from "@chronica/shared";
import { composeChronicle } from "./chronicle";
import type { SimModelPort } from "./ports";

const clock = ScenarioClockSchema.parse({ epoch: { year: 264, month: 3, day: 1, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 });

let factCounter = 0;

function fact(overrides: Partial<FactDraft>): Fact {
  const draft: FactDraft = {
    time: { day: 0, minute: 0 },
    atStep: 0,
    kind: "event",
    summary: "Something happened.",
    affectedEntities: [],
    resourceChanges: [],
    authorityChange: undefined,
    visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    evidence: null,
    eligibleReactionScopes: [],
    sourceEventId: null,
    sourceActionId: null,
    causalDepth: 0,
    ...overrides,
  };
  return emitFacts([draft], () => `fact-${(factCounter += 1)}`)[0]!;
}

/** Captures what the historian was actually shown, and writes every thread it was given. */
function capturingPort(): SimModelPort & { lastUserMessage: string } {
  const port = {
    lastUserMessage: "",
    complete(_operation: Parameters<SimModelPort["complete"]>[0], _system: string, user: string) {
      port.lastUserMessage = user;
      const threads = [...user.matchAll(/^THREAD (\d+)$/gm)].map((match) => Number(match[1]));
      return Promise.resolve(JSON.stringify({
        entries: threads.map((thread) => ({ thread, title: `Thread ${thread}`, body: "In the spring, Rome began to raise new legions." })),
      }));
    },
  };
  return port;
}

describe("chronicle", () => {
  it("never shows the historian a fact the observer has not discovered", async () => {
    // VISION §25: the simulation knowing a senator is plotting is not a reason
    // for the Chronicle to say so.
    const port = capturingPort();
    const facts = [
      fact({ kind: "mobilization", summary: "Rome begins raising two new legions." }),
      fact({ kind: "conspiracy", summary: "A senator begins quietly courting the army's officers.", visibility: "private", discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] } }),
    ];

    const result = await composeChronicle({
      port,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts,
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [],
      frictions: [],
    });

    expect(port.lastUserMessage).toContain("raising two new legions");
    expect(port.lastUserMessage).not.toContain("courting the army's officers");
    expect(result.entries.flatMap((entry) => entry.factIds)).toHaveLength(1);
  });

  it("gives each entry a title of its own rather than the dates it covers", async () => {
    const result = await composeChronicle({
      port: capturingPort(),
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [fact({})],
      from: { day: 0, minute: 0 },
      to: { day: 31, minute: 0 },
      narrative: [],
      frictions: [],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.title).toBe("Thread 1");
    expect(result.entries[0]!.title).not.toContain("264 BC");
  });

  it("writes one entry per matter, and keeps them apart", async () => {
    // A burst covers a span, not a subject. A Roman march on the Boii and a
    // Carthaginian deliberation about Messana are not one passage.
    const port = capturingPort();
    const result = await composeChronicle({
      port,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [
        fact({ summary: "The legions march north into Boii country.", affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "boii" }] }),
        fact({ summary: "Carthage weighs the strait at Messana.", affectedEntities: [{ kind: "polity", id: "carthage" }] }),
      ],
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [],
      frictions: [],
    });

    expect(result.entries).toHaveLength(2);
    const [own, elsewhere] = result.entries;
    expect(own!.factIds).toHaveLength(1);
    expect(own!.subjects.map((subject) => subject.id)).toContain("boii");
    expect(elsewhere!.subjects.map((subject) => subject.id)).toEqual(["carthage"]);
    // Each thread is rendered on its own, so neither can borrow the other's news.
    expect(port.lastUserMessage).toContain("THREAD 1");
    expect(port.lastUserMessage).toContain("THREAD 2");
  });

  it("tells one war once, however many sides it has", async () => {
    // The Boii defending their strongholds and Rome storming them are the same
    // matter. Grouping only by "does it name Rome" split a single campaign into
    // an entry per participant, and the record read as four accounts of one war.
    const result = await composeChronicle({
      port: capturingPort(),
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [
        fact({ summary: "The legions storm the first stronghold.", affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "boii" }] }),
        fact({ summary: "Brennos withdraws the host along the retreat route.", affectedEntities: [{ kind: "polity", id: "boii" }] }),
        fact({ summary: "Carthage weighs the strait at Messana.", affectedEntities: [{ kind: "polity", id: "carthage" }] }),
      ],
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [],
      frictions: [],
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.factIds).toHaveLength(2);
    expect(result.entries[1]!.subjects.map((subject) => subject.id)).toEqual(["carthage"]);
  });

  it("withholds an account of something the observer never learned", async () => {
    // The facts were always filtered; the accounts beside them were not, and a
    // Roman consul read a Carthaginian's private deliberations in his own record.
    const port = capturingPort();
    const secret = fact({
      summary: "Carthage weighs the strait at Messana.",
      affectedEntities: [{ kind: "polity", id: "carthage" }],
      visibility: "private",
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] },
    });
    await composeChronicle({
      port,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [fact({ summary: "The legions march north." , affectedEntities: [{ kind: "polity", id: "rome" }] }), secret],
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [
        { actorRef: { kind: "character", id: "hanno" }, line: "Hanno quietly investigated whether Rome had left the strait open.", factIds: [secret.id] },
      ],
      frictions: [],
    });

    expect(port.lastUserMessage).not.toContain("Hanno quietly investigated");
  });

  it("strips the engine's own handles out of what the historian reads", async () => {
    const port = capturingPort();
    await composeChronicle({
      port,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [fact({ summary: "Two new legions [project-3] stand ready, 8000 strong." })],
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [],
      frictions: [],
    });

    expect(port.lastUserMessage).toContain("Two new legions stand ready");
    expect(port.lastUserMessage).not.toContain("project-3");
  });

  it("keeps the record when the narration call fails", async () => {
    const failing: SimModelPort = { complete: () => Promise.reject(new Error("provider unavailable")) };
    const result = await composeChronicle({
      port: failing,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [fact({ summary: "Rome begins raising two new legions." })],
      from: { day: 0, minute: 0 },
      to: { day: 30, minute: 0 },
      narrative: [],
      frictions: [],
    });
    expect(result.entries[0]!.body).toContain("raising two new legions");
  });

  it("records nothing at all rather than inventing a period", async () => {
    const port = capturingPort();
    const result = await composeChronicle({
      port,
      clock,
      observer: { kind: "character", id: "marcus-atilius" },
      observerPolityId: "rome",
      facts: [],
      from: { day: 0, minute: 0 },
      to: { day: 5, minute: 0 },
      narrative: [],
      frictions: [],
    });
    expect(result.calls).toBe(0);
    expect(result.entries).toEqual([]);
  });
});

describe("what a government knows of its own business", () => {
  it("tells the ruler what their own polity did", () => {
    // Facts scoped to a polity were invisible to everyone, including that
    // polity, so a government's own dispatches never reached it and whole
    // periods came back as "nothing of note was recorded".
    const dispatch = fact({
      kind: "diplomatic_dispatch",
      summary: "The consul has sent an envoy to Messana.",
      visibility: "polity",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      discovery: { state: "polity", knowableAtInstant: null, discoveredBy: [] },
    });

    expect(factsKnownTo([dispatch], { kind: "character", id: "marcus-atilius" }, "rome", { day: 1, minute: 0 })).toHaveLength(1);
  });

  it("does not tell a foreign ruler the same thing", () => {
    const dispatch = fact({
      kind: "diplomatic_dispatch",
      summary: "The consul has sent an envoy to Messana.",
      visibility: "polity",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      discovery: { state: "polity", knowableAtInstant: null, discoveredBy: [] },
    });

    expect(factsKnownTo([dispatch], { kind: "character", id: "hanno" }, "carthage", { day: 1, minute: 0 })).toHaveLength(0);
  });

  it("still keeps a secret from the ruler's own polity", () => {
    const plot = fact({
      kind: "conspiracy",
      summary: "A senator courts the army's officers.",
      visibility: "private",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] },
    });

    expect(factsKnownTo([plot], { kind: "character", id: "marcus-atilius" }, "rome", { day: 1, minute: 0 })).toHaveLength(0);
  });
});
