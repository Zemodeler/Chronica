import { describe, expect, it } from "vitest";
import { ScenarioClockSchema, emitFacts, factsKnownTo, type Fact, type FactDraft, type WorldStoryline } from "@chronica/shared";
import { DEFAULT_ENTRY_THRESHOLD, OWN_BUSINESS_FLOOR, composeChronicle } from "./chronicle";
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
function capturingPort(): SimModelPort & { lastUserMessage: string; userMessages: string[] } {
  const port = {
    lastUserMessage: "",
    // One per call. A report is now written a passage at a time, so "what the
    // historian was shown" is a list rather than a string.
    userMessages: [] as string[],
    complete(_operation: Parameters<SimModelPort["complete"]>[0], _system: string, user: string) {
      port.lastUserMessage = user;
      port.userMessages.push(user);
      const threads = [...user.matchAll(/^THREAD (\d+)/gm)].map((match) => Number(match[1]));
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
    // Each thread is written on its own, so neither can borrow the other's
    // news -- now because each one is a separate request holding a single
    // matter, rather than because the prompt asked the model to keep them
    // apart within one.
    expect(port.userMessages).toHaveLength(2);
    for (const message of port.userMessages) {
      expect([...message.matchAll(/^THREAD \d+$/gm)]).toHaveLength(1);
    }
    const [marching, weighing] = port.userMessages;
    expect(marching).toContain("The legions march north into Boii country.");
    expect(marching).not.toContain("Messana");
    expect(weighing).toContain("Carthage weighs the strait at Messana.");
    expect(weighing).not.toContain("Boii country");
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

describe("a passage that continues a longer matter", () => {
  const storyline: WorldStoryline = {
    id: "plague-1", title: "The Sickness in Latium", participantIds: ["quintus-fabius", "marcus-atilius"], provinceId: "latium", phase: "escalating",
    stakes: "Whether Rome can feed itself through the summer.", history: [], nextDevelopment: "The sickness spreads or burns out.",
    visibility: "public", origin: "world", openedByRef: null, openedAtStep: 0, updatedAtStep: 0, closedAtStep: null, causalFactIds: [], seedKey: "seed-1",
  };
  const facts = [fact({ summary: "The sickness reaches the Aventine.", affectedEntities: [{ kind: "province", id: "latium" }, { kind: "character", id: "quintus-fabius" }] })];
  const compose = (port: SimModelPort, storylines: WorldStoryline[]) =>
    composeChronicle({
      port, clock, observer: { kind: "character", id: "marcus-atilius" }, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [], storylines,
    });

  it("tells the historian which matter a thread belongs to when the observer may know of it", async () => {
    const port = capturingPort();
    await compose(port, [storyline]);
    expect(port.lastUserMessage).toContain('Part of a longer matter: "The Sickness in Latium" (escalating)');
  });

  it("says nothing of a secret matter the observer is not part of", async () => {
    const port = capturingPort();
    await compose(port, [{ ...storyline, visibility: "private", participantIds: ["quintus-fabius", "hanno"] }]);
    expect(port.lastUserMessage).not.toContain("Part of a longer matter");
  });
});

describe("the world elsewhere", () => {
  const OBSERVER = { kind: "character" as const, id: "marcus-atilius" };
  const ROMAN_SIDE = new Set(["marcus-atilius", "rome", "quintus-fabius", "latium"]);
  /**
   * Far away, and loose in the world: Rome has not seen it, but it is abroad
   * and a report of it can reach the court.
   *
   * This helper used to be called `secret` and to model a poisoning at a
   * public banquet as `discovery: "private"` -- and the distant-news band,
   * which checked distance and nothing else, let it through on distance
   * alone. A live game then published a Carthaginian's private conspiracy in
   * a Roman consul's Chronicle. Far and hidden are different things, and the
   * fixtures now say which they mean.
   */
  const distant = (overrides: Partial<Parameters<typeof fact>[0]> = {}) =>
    fact({
      kind: "assassination",
      summary: "Agathocles of Syracuse is poisoned at a banquet by his own nephew.",
      affectedEntities: [{ kind: "polity", id: "syracuse" }],
      visibility: "private",
      discovery: { state: "rumoured", knowableAtInstant: null, discoveredBy: [] },
      ...overrides,
    });

  /** Far away, and hidden: something nobody in the world can come to know. */
  const secret = (overrides: Partial<Parameters<typeof fact>[0]> = {}) =>
    distant({
      visibility: "private",
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] },
      ...overrides,
    });

  const compose = (port: SimModelPort, facts: Fact[], extra: Partial<Parameters<typeof composeChronicle>[0]> = {}) =>
    composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: ROMAN_SIDE,
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, 70])),
      ...extra,
    });

  it("lets weighty news of somewhere else reach the court, marked as hearsay", async () => {
    // A record that is correct and parochial is a record of a dead world. What
    // happens in Syracuse cannot be acted on from Rome, so knowing it costs
    // nothing and not knowing it costs the whole feeling of a world.
    const port = capturingPort();
    const result = await compose(port, [distant()]);
    expect(port.lastUserMessage).toContain("news reaching the court");
    expect(port.lastUserMessage).toContain("Reported to have happened:");
    expect(port.lastUserMessage).toContain("poisoned at a banquet");
    expect(result.entries).toHaveLength(1);
  });

  it("keeps a foreign secret secret, which distance alone used to publish", async () => {
    // From a live game. Hanno of Carthage began cultivating a faction against
    // his own government -- `visibility: "private"`, `discovery: "private"`,
    // known to the one man who began it -- and the whole of it was written
    // into a Roman consul's Chronicle, because it named nothing Roman and
    // the distant-news band checked only distance. News is a report of
    // something that can be seen happening; no distance makes a private fact
    // reportable.
    const port = capturingPort();
    const plot = secret({
      kind: "secret_political_action",
      summary: "Hanno of Carthage has begun secretly cultivating a private faction against his own government.",
      affectedEntities: [{ kind: "character", id: "hanno-carthage" }, { kind: "polity", id: "carthage" }],
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [{ via: "witnessed", atInstant: { day: 1, minute: 0 }, observerRef: { kind: "character", id: "hanno-carthage" } }] },
    });
    const result = await compose(port, [plot]);
    expect(result.entries).toHaveLength(0);
    expect(port.lastUserMessage ?? "").not.toContain("Hanno");
  });

  it("keeps a secret that touches the reader's own side, however weighty", async () => {
    const port = capturingPort();
    const plot = secret({
      kind: "conspiracy_begun",
      summary: "Quintus Fabius begins quietly gathering senators against the consul.",
      affectedEntities: [{ kind: "character", id: "quintus-fabius" }],
    });
    const result = await compose(port, [plot]);
    expect(result.entries).toHaveLength(0);
  });

  it("carries no distant news at all when nobody said where the reader's reach ends", async () => {
    // The strict answer, not a guess: a wrong guess here publishes a plot
    // against the reader as local colour.
    const port = capturingPort();
    const facts = [distant()];
    const result = await composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, 70])),
    });
    expect(result.entries).toHaveLength(0);
  });

  it("does not carry foreign trivia, only what would travel", async () => {
    const port = capturingPort();
    const gossip = distant({ summary: "A Syracusan magistrate loses a lawsuit over a vineyard." });
    const result = await compose(port, [gossip], { significanceByFactId: new Map([[gossip.id, 10]]) });
    expect(result.entries).toHaveLength(0);
  });

  it("waits for word to arrive when the news has a road to travel", async () => {
    const port = capturingPort();
    const slow = distant({ discovery: { state: "rumoured", knowableAtInstant: { day: 90, minute: 0 }, discoveredBy: [] } });
    expect((await compose(port, [slow])).entries).toHaveLength(0);
    expect((await compose(port, [slow], { to: { day: 120, minute: 0 } })).entries).toHaveLength(1);
  });

  it("does not hand the court an actor's own account of something it merely heard about", async () => {
    // The court learned that Agathocles was killed. It did not learn what his
    // nephew was thinking, and an account is the one thing hearsay never brings.
    const port = capturingPort();
    const distant = secret();
    await compose(port, [distant], {
      narrative: [{ actorRef: { kind: "character", id: "archagathus" }, line: "Archagathus judged the moment had come to take the tyranny.", factIds: [distant.id] }],
    });
    expect(port.lastUserMessage).not.toContain("take the tyranny");
  });
});

describe("the bar an entry has to clear", () => {
  const OBSERVER = { kind: "character" as const, id: "marcus-atilius" };
  // The bar only means something once the reader's side has been named: with no
  // "elsewhere" there is nothing for it to cull.
  const compose = (port: SimModelPort, facts: Fact[], weights: ReadonlyMap<string, number>) =>
    composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      significanceByFactId: weights,
      ownEntityIds: new Set(["marcus-atilius", "rome"]),
    });

  it("leaves a slight matter elsewhere unwritten", async () => {
    const own = fact({ summary: "The legions march north.", affectedEntities: [{ kind: "polity", id: "rome" }] });
    const slight = fact({ summary: "A Boii headman repairs his hall.", affectedEntities: [{ kind: "polity", id: "boii" }] });
    const result = await compose(capturingPort(), [own, slight], new Map([[own.id, 70], [slight.id, 5]]));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.subjects.map((subject) => subject.id)).toContain("rome");
  });

  it("always answers the reader's own order, however small the outcome", async () => {
    // An order that produced little still has to be answered, or the player
    // gave an order and heard nothing back.
    const own = fact({ summary: "The quaestor finds the money, slowly.", affectedEntities: [{ kind: "polity", id: "rome" }] });
    const result = await compose(capturingPort(), [own], new Map([[own.id, 3]]));
    expect(result.entries).toHaveLength(1);
  });
});

describe("what an entry carries beside the prose", () => {
  const OBSERVER = { kind: "character" as const, id: "marcus-atilius" };
  const compose = (port: SimModelPort, facts: Fact[], extra: Partial<Parameters<typeof composeChronicle>[0]> = {}) =>
    composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [], ...extra,
    });

  it("lists only the changes its own facts name", async () => {
    // The change block is the one place a leak would be invisible: the prose is
    // carefully gated and a row of chips beside it is not, unless it is.
    const own = fact({ summary: "Vatluna falls.", affectedEntities: [{ kind: "province", id: "vatluna" }, { kind: "polity", id: "rome" }] });
    const result = await compose(capturingPort(), [own], {
      changes: [
        { kind: "province", id: "vatluna", label: "Vatluna", detail: "passes from Etruria to Rome" },
        { kind: "force", id: "secret-fleet", label: "Punic Fleet", detail: "raised at Carthage" },
      ],
    });
    expect(result.entries[0]!.changes.map((change) => change.id)).toEqual(["vatluna"]);
  });

  it("shows four subjects at most, the one who acted first and the reader's own government among them, under the names they are known by", async () => {
    const own = fact({
      summary: "Rome storms the Etruscan towns.",
      affectedEntities: [
        { kind: "polity", id: "rome" }, { kind: "polity", id: "etruria" },
        { kind: "province", id: "vatluna" }, { kind: "province", id: "rusellae" }, { kind: "character", id: "corvus" },
      ],
    });
    const names: Record<string, string> = { etruria: "Etruscan Confederation", vatluna: "Vatluna", rusellae: "Rusellae" };
    const result = await compose(capturingPort(), [own], { nameOf: (ref) => names[ref.id] ?? null });
    expect(result.entries[0]!.subjects.length).toBeGreaterThan(4);
    expect(result.entries[0]!.tags).toHaveLength(4);
    // Sorted last, the reader's own power was the first dropped.
    expect(result.entries[0]!.tags.map((tag) => tag.id)).toEqual(["corvus", "rome", "etruria", "rusellae"]);
    // An id is the engine's handle. The reader was being offered
    // "force-e98084fc-0494-4fab-ad92-7c3473be9afe-4" as a way into the record.
    expect(result.entries[0]!.tags.map((tag) => tag.label)).toContain("Etruscan Confederation");
  });

  it("does not tag the engine's own bookkeeping, or a handle that resolved to nothing", async () => {
    const own = fact({
      summary: "The Senate opens a motion to reward the cohort.",
      affectedEntities: [
        { kind: "procedure", id: "procedure-62af32f4-4cf3-417e-9b0f-f67345bbce84-1" },
        { kind: "force", id: "local:campanian_rebel_host" },
        { kind: "institution", id: "roman-senate" },
      ],
    });
    const result = await compose(capturingPort(), [own], { nameOf: () => "Roman Senate" });
    expect(result.entries[0]!.tags.map((tag) => tag.id)).toEqual(["roman-senate"]);
  });

  it("prints one quotation per report, on the matter that earned it", async () => {
    const heavy = fact({ summary: "Sutrium falls to Corvus.", affectedEntities: [{ kind: "polity", id: "rome" }] });
    const light = fact({ summary: "The Boii burn a farmstead.", affectedEntities: [{ kind: "polity", id: "boii" }] });
    const result = await compose(capturingPort(), [heavy, light], {
      significanceByFactId: new Map([[heavy.id, 90], [light.id, 60]]),
      utterances: [
        { actorRef: { kind: "character", id: "corvus" }, speaker: "Marcus Valerius Corvus", line: "The walls were old and the men behind them older.", occasion: "on taking Sutrium", factIds: [heavy.id] },
        { actorRef: { kind: "character", id: "boiorix" }, speaker: "Boiorix", line: "Let them count the barns.", occasion: "on the raid", factIds: [light.id] },
      ],
    });
    const quoted = result.entries.filter((entry) => entry.quote !== null);
    expect(quoted).toHaveLength(1);
    expect(quoted[0]!.quote!.speaker).toBe("Marcus Valerius Corvus");
  });

  /** A historian who gives every passage a line, said by `speaker`. */
  const quotingPort = (speaker: string): SimModelPort & { userMessages: string[] } => {
    const userMessages: string[] = [];
    return {
      userMessages,
      complete(_operation, _system, user) {
        userMessages.push(user);
        return Promise.resolve(JSON.stringify({ entries: [{ thread: 1, title: "A Title", body: "A passage.", quote: { speaker, line: "\u201cThey made the ring long, so they made it thin.\u201d", occasion: "to his guard at the ford" } }] }));
      },
    };
  };
  const names: Record<string, string> = { "marcus-atilius": "Marcus Atilius", hanno: "Hanno" };

  it("lets the historian quote the one whose reign it is, when the moment is his and the words are on record", async () => {
    const surrounded = fact({ summary: "Marcus Atilius is surrounded at Messana.", affectedEntities: [{ kind: "character", id: "marcus-atilius" }, { kind: "polity", id: "rome" }] });
    const port = quotingPort("Marcus Atilius");
    const result = await compose(port, [surrounded], {
      significanceByFactId: new Map([[surrounded.id, 94]]),
      nameOf: (ref) => names[ref.id] ?? null,
      describePerson: (id) => names[id] ?? null,
      utterances: [{ actorRef: { kind: "character", id: "marcus-atilius" }, speaker: "Marcus Atilius", line: "They made the ring long, so they made it thin.", occasion: "at the ford", factIds: [surrounded.id] }],
    });
    expect(result.entries[0]!.quote).toEqual({ speaker: "Marcus Atilius", line: "They made the ring long, so they made it thin.", occasion: "to his guard at the ford" });
    expect(port.userMessages[0]).toContain("the one whose reign this history is");
  });

  // R24: a generic broken promise became Fabricius calling Clepsina a traitor
  // on the Almo, in quotation marks, when the record had him saying the opposite.
  it("prints no quotation that nobody is recorded saying", async () => {
    const surrounded = fact({ summary: "Marcus Atilius is surrounded at Messana.", affectedEntities: [{ kind: "character", id: "marcus-atilius" }, { kind: "polity", id: "rome" }] });
    const result = await compose(quotingPort("Marcus Atilius"), [surrounded], {
      significanceByFactId: new Map([[surrounded.id, 94]]),
      nameOf: (ref) => names[ref.id] ?? null,
      describePerson: (id) => names[id] ?? null,
    });
    expect(result.entries[0]!.quote).toBeNull();
  });

  it("drops a quotation put in the mouth of somebody not in the matter", async () => {
    const surrounded = fact({ summary: "Marcus Atilius is surrounded at Messana.", affectedEntities: [{ kind: "character", id: "marcus-atilius" }, { kind: "polity", id: "rome" }] });
    const result = await compose(quotingPort("Scipio Africanus"), [surrounded], {
      significanceByFactId: new Map([[surrounded.id, 94]]),
      nameOf: (ref) => names[ref.id] ?? null,
    });
    expect(result.entries[0]!.quote).toBeNull();
  });

  it("shows the historian the words recorded at the time", async () => {
    const taken = fact({ summary: "Hanno yields at the ford.", affectedEntities: [{ kind: "character", id: "hanno" }, { kind: "polity", id: "rome" }] });
    const port = quotingPort("Hanno");
    await compose(port, [taken], {
      significanceByFactId: new Map([[taken.id, 92]]),
      nameOf: (ref) => names[ref.id] ?? null,
      utterances: [{ actorRef: { kind: "character", id: "hanno" }, speaker: "Hanno", line: "I will give my sword to your commander, not to you.", occasion: "to the Roman officers", factIds: [taken.id] }],
    });
    expect(port.userMessages[0]).toContain("Words recorded at the time:");
    expect(port.userMessages[0]).toContain("I will give my sword to your commander");
  });
});

describe("what makes two things one matter", () => {
  const OBSERVER = { kind: "character" as const, id: "marcus-atilius" };
  const compose = (facts: Fact[]) =>
    composeChronicle({
      port: capturingPort(), clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["marcus-atilius", "rome"]),
      significanceByFactId: new Map(facts.map((fact) => [fact.id, 60])),
    });

  it("does not make an embassy and a rebellion one matter because both name Rome", async () => {
    // The report that prompted this told the Campanian rising for the first
    // time, in the second half of a paragraph about an overture to Syracuse,
    // because the two facts shared the word "Rome" and nothing else.
    const embassy = fact({
      summary: "Publius Valerius Falto carries an overture to Syracuse.",
      affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "syracuse" }, { kind: "character", id: "falto" }],
    });
    const rising = fact({
      summary: "Campania rises under Decimus Vibius Virius.",
      affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "character", id: "virius" }, { kind: "province", id: "campania" }],
    });

    const result = await compose([embassy, rising]);
    expect(result.entries).toHaveLength(2);
    const bySubject = result.entries.map((entry) => entry.subjects.map((subject) => subject.id));
    expect(bySubject.some((subjects) => subjects.includes("syracuse") && !subjects.includes("campania"))).toBe(true);
    expect(bySubject.some((subjects) => subjects.includes("campania") && !subjects.includes("syracuse"))).toBe(true);
  });

  it("still tells one war once, because a foreign power is a matter and your own is not", async () => {
    const storming = fact({ summary: "The legions storm the stronghold.", affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "boii" }] });
    const withdrawal = fact({ summary: "Brennos withdraws the host.", affectedEntities: [{ kind: "polity", id: "boii" }] });
    const result = await compose([storming, withdrawal]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.factIds).toHaveLength(2);
  });

  const separateAffairs = () => [
    fact({ summary: "The garrison at Rhegium is reinforced.", affectedEntities: [{ kind: "province", id: "rhegium" }] }),
    fact({ summary: "The Senate rewards the loyal cohort.", affectedEntities: [{ kind: "institution", id: "roman-senate" }] }),
    fact({ summary: "An envoy departs for Syracuse.", affectedEntities: [{ kind: "character", id: "falto" }, { kind: "polity", id: "syracuse" }] }),
  ];
  const composeOwn = (facts: Fact[], weight: number) =>
    composeChronicle({
      port: capturingPort(), clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["marcus-atilius", "rome", "rhegium", "roman-senate", "falto"]),
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, weight])),
    });

  it("gives the reign's own separate affairs an entry each", async () => {
    // The old rule fused everything naming the ruler's side into one passage,
    // so a reign doing four things read as one thing.
    const result = await composeOwn(separateAffairs(), DEFAULT_ENTRY_THRESHOLD);
    expect(result.entries).toHaveLength(3);
    expect(result.carried).toHaveLength(0);
  });

  it("gathers the reign's small affairs into one passage rather than a headline each", async () => {
    // "Titus Genucius Sponsors His Own Nomination" and "Rome Begins Surveying
    // Messana's Defences" were entries of a sentence each.
    const port = capturingPort();
    const facts = separateAffairs();
    const result = await composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["marcus-atilius", "rome", "rhegium", "roman-senate", "falto"]),
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, OWN_BUSINESS_FLOOR])),
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.factIds).toHaveLength(3);
    expect(result.carried).toHaveLength(0);
    expect(port.lastUserMessage).toContain("several small matters of the same days");
  });

  it("holds the reign's slight affairs for the matter they belong to, rather than telling each the moment it happens", async () => {
    // Written window by window, "whatever they weigh" meant an entry for
    // every remittance as it landed. Under the floor they are carried, and a
    // span that told nothing else still tells the weightiest of them.
    const result = await composeOwn(separateAffairs(), OWN_BUSINESS_FLOOR - 1);
    expect(result.entries).toHaveLength(1);
    expect(result.carried).toHaveLength(2);
    const facts = separateAffairs();
    const withoutFallback = await composeChronicle({
      port: capturingPort(), clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["marcus-atilius", "rome", "rhegium", "roman-senate", "falto"]),
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, OWN_BUSINESS_FLOOR - 1])),
      fallback: false,
    });
    expect(withoutFallback.entries).toHaveLength(0);
    expect(withoutFallback.calls).toBe(0);
    expect(withoutFallback.carried).toHaveLength(3);
  });
});

describe("the engine's own bookkeeping", () => {
  it("never shows the historian a breach, whoever committed it", async () => {
    // "Fiscal Record Grants No Spending Power to the Declared Character" was a
    // real headline, on a real entry, written from an audit line about grants
    // and account ids. While one entry held the reader's whole side of the
    // world it sank without trace; told matter by matter, it surfaced.
    const port = capturingPort();
    const breach = fact({
      kind: "authority_breach",
      summary: 'No active grant gave "declared-a4810007" the power to spend from account "gaius-purse".',
      affectedEntities: [{ kind: "character", id: "marcus-atilius" }],
      visibility: "private",
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [{ observerRef: { kind: "character", id: "marcus-atilius" }, atInstant: { day: 0, minute: 0 }, via: "witnessed" }] },
    });
    const real = fact({ summary: "The consul marches for Campania.", affectedEntities: [{ kind: "polity", id: "rome" }] });

    const result = await composeChronicle({
      port, clock, observer: { kind: "character", id: "marcus-atilius" }, observerPolityId: "rome", facts: [breach, real],
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
    });

    expect(port.lastUserMessage).not.toContain("gaius-purse");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.factIds).toEqual([real.id]);
  });
});

describe("a record read by station", () => {
  const OBSERVER = { kind: "character" as const, id: "manius-curius" };
  const SHIELD = new Set(["manius-curius", "rome", "quintus-fabius", "latium", "legio-i"]);

  const compose = (facts: Fact[], extra: Partial<Parameters<typeof composeChronicle>[0]> = {}) =>
    composeChronicle({
      port: capturingPort(), clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: SHIELD,
      // A private man: his own person and nothing else.
      personalEntityIds: new Set(["manius-curius"]),
      significanceByFactId: new Map(facts.map((fact) => [fact.id, 5])),
      ...extra,
    });

  it("answers the order whatever it weighed", async () => {
    // The guarantee, and the reason it is a floor under the answer rather than
    // under a category: the weight-floor version was tried and reverted.
    const own = fact({ summary: "The quaestor finds the money, slowly.", affectedEntities: [{ kind: "polity", id: "rome" }] });
    const result = await compose([own], { orderFactIds: new Set([own.id]) });
    expect(result.entries).toHaveLength(1);
  });

  it("brings the realm's doings as news competing on weight, not as his own business", async () => {
    const light = fact({ summary: "A routine levy is collected in Latium.", affectedEntities: [{ kind: "province", id: "latium" }] });
    const heavy = fact({ summary: "Legio I is broken at Latium.", affectedEntities: [{ kind: "force", id: "legio-i" }] });
    const result = await compose([light, heavy], { significanceByFactId: new Map([[light.id, 5], [heavy.id, 70]]) });
    // The heavy one clears the home bar; the routine one does not.
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.factIds).toContain(heavy.id);
  });

  it("keeps the shield whole while the exemption narrows", async () => {
    // The bug this split exists to prevent: a secret naming the reader's polity
    // but not the reader must publish nowhere -- not as hearsay, not as home news.
    const plot = fact({
      kind: "conspiracy_begun",
      summary: "A senator begins gathering the patrician bloc against the consul.",
      affectedEntities: [{ kind: "character", id: "quintus-fabius" }],
      visibility: "private",
      discovery: { state: "private", knowableAtInstant: null, discoveredBy: [] },
    });
    const result = await compose([plot], { significanceByFactId: new Map([[plot.id, 90]]) });
    expect(result.entries).toHaveLength(0);
  });

  it("does not go blank when nothing personal happened", async () => {
    const far = fact({ summary: "A farmstead burns in Latium.", affectedEntities: [{ kind: "province", id: "latium" }] });
    const result = await compose([far], { significanceByFactId: new Map([[far.id, 1]]) });
    // Below every bar, and still one entry: a record that goes blank teaches
    // the reader to stop opening it.
    expect(result.entries).toHaveLength(1);
  });
});

describe("a battle worth dying in", () => {
  const OBSERVER = { kind: "character" as const, id: "marcus-atilius" };
  const battleFact = () => fact({
    kind: "battle",
    summary: "The legions meet the Boii host at Vatluna.",
    affectedEntities: [{ kind: "province", id: "vatluna" }, { kind: "polity", id: "rome" }],
  });

  const account = (factId: string) => ({
    factIds: [factId],
    provinceName: "Vatluna",
    sides: [
      { name: "Legio I", attacking: true, strength: 4_200, commander: "Marcus Atilius" },
      { name: "The Boii host", attacking: false, strength: 6_000, commander: "Brennos" },
    ],
    phases: [
      { phase: "contact", summary: "The lines close on broken ground.", attacker: 4_100, defender: 5_800 },
      { phase: "engagement", summary: "The Boii left gives way.", attacker: 3_900, defender: 4_100 },
    ],
    tactics: ["Marcus Atilius tried surprise (meaningful): a night crossing of the ford."],
    refusedTactics: ["Brennos could not: the ground gave no room to turn the flank."],
    losses: [{ name: "Legio I", dead: 400, deserted: 30, wounded: 600 }],
    commanders: [{ name: "Brennos", outcome: "captured" }],
    retreats: [{ name: "The Boii host", to: "Rusellae", orderly: false }],
    outcome: "attacker_victory",
  });

  it("hands the historian the fight, not a line about who won", async () => {
    // `resolveBattle` computes five phases, the tactics tried and refused,
    // casualties by force, who broke and where they ran -- and all of it was
    // collapsed into one six-hundred-character summary and discarded.
    const port = capturingPort();
    const battle = battleFact();
    await composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts: [battle],
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      battleAccounts: [account(battle.id)],
    });

    expect(port.lastUserMessage).toContain("This thread holds a battle");
    expect(port.lastUserMessage).toContain("night crossing of the ford");
    expect(port.lastUserMessage).toContain("no room to turn the flank");
    expect(port.lastUserMessage).toContain("400 dead");
    expect(port.lastUserMessage).toContain("Brennos was captured");
    expect(port.lastUserMessage).toContain("in rout");
  });

  it("never drops a battle for room, however crowded the report", async () => {
    // Men died in it.
    const battle = battleFact();
    const crowd = Array.from({ length: 12 }, (_, index) =>
      fact({ summary: `A quiet matter, number ${index}.`, affectedEntities: [{ kind: "polity", id: `power-${index}` }] }));
    const facts = [...crowd, battle];

    const result = await composeChronicle({
      port: capturingPort(), clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      battleAccounts: [account(battle.id)],
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, candidate.id === battle.id ? 90 : 80])),
    });
    expect(result.entries.some((entry) => entry.factIds.includes(battle.id))).toBe(true);
  });

  it("does not write up a fight the court only heard about", async () => {
    // News of a battle is not an account of one, and writing it phase by phase
    // would give a rumour the authority of a dispatch.
    const port = capturingPort();
    const distant = fact({
      kind: "battle",
      summary: "Syracuse and Carthage meet near Selinous.",
      affectedEntities: [{ kind: "polity", id: "syracuse" }],
      // Rome has not seen it, but a battle is loose in the world the moment it
      // is fought: "rumoured", not "private", which is the state for a thing
      // nobody can come to know at all.
      visibility: "private",
      discovery: { state: "rumoured", knowableAtInstant: null, discoveredBy: [] },
    });
    await composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts: [distant],
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["marcus-atilius", "rome"]),
      significanceByFactId: new Map([[distant.id, 90]]),
      battleAccounts: [account(distant.id)],
    });
    expect(port.lastUserMessage).toContain("news reaching the court");
    expect(port.lastUserMessage).not.toContain("This thread holds a battle");
  });
});

describe("a matter that is only continuing", () => {
  const OBSERVER = { kind: "character" as const, id: "marcus-atilius" };
  const ROMAN_SIDE = new Set(["marcus-atilius", "rome"]);

  /** The Syracusans tightening their siege of Messana, again. */
  const siege = (summary: string) =>
    fact({
      kind: "military_preparation",
      summary,
      affectedEntities: [{ kind: "character", id: "hieron-ii" }, { kind: "force", id: "syracusan-army" }],
      visibility: "public",
      discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    });

  const compose = (port: SimModelPort, facts: Fact[], extra: Partial<Parameters<typeof composeChronicle>[0]> = {}) =>
    composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: ROMAN_SIDE,
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, 60])),
      ...extra,
    });

  it("does not headline the same people doing the same thing a second time", async () => {
    // A live game produced five consecutive reports led by "Hieron II Tightens
    // the Investment of Messana", "…the Cordon Around Messana", "…Interception
    // of the Mamertine Sortie" -- two of them word for word the same title --
    // describing one siege in which nothing whatever had changed. A siege
    // going on is not a thing that happened.
    const again = siege("Hieron II tightened the Syracusan cordon around Messana once more.");
    const told = [["character:hieron-ii", "force:syracusan-army"]];
    expect((await compose(capturingPort(), [again], { recentSubjects: told })).entries).toHaveLength(0);
    // And with no previous report to compare against, it is simply news.
    expect((await compose(capturingPort(), [again])).entries).toHaveLength(1);
  });

  it("tells it the moment somebody new is in it", async () => {
    const turn = fact({
      kind: "battle",
      summary: "The Mamertines broke out and scattered a Syracusan detachment.",
      affectedEntities: [
        { kind: "character", id: "hieron-ii" },
        { kind: "force", id: "syracusan-army" },
        { kind: "polity", id: "mamertines" },
      ],
      visibility: "public",
      discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    });
    const told = [["character:hieron-ii", "force:syracusan-army"]];
    expect((await compose(capturingPort(), [turn], { recentSubjects: told })).entries).toHaveLength(1);
  });

  it("tells it anyway when something actually moved, however familiar the cast", async () => {
    // The conjunct that keeps the rule from silencing a matter that is
    // genuinely developing. `diffWorlds` already says what changed; a thread
    // carrying one of those is news whoever is in it.
    const marched = siege("The Syracusan army marched from the hills down to the shore.");
    const told = [["character:hieron-ii", "force:syracusan-army"]];
    const held = await compose(capturingPort(), [marched], { recentSubjects: told });
    expect(held.entries).toHaveLength(0);

    const moved = await compose(capturingPort(), [marched], {
      recentSubjects: told,
      changes: [{ kind: "force", id: "syracusan-army", label: "Syracusan army", detail: "marched to the shore" }],
    });
    expect(moved.entries).toHaveLength(1);
  });

  it("shows the historian what it wrote last time, and says not to write it again", async () => {
    // The set comparison catches the clear cases and keeps leaking the unclear
    // ones, because "the same matter" drifts by an id at a time. This puts the
    // judgment where judgment belongs and keeps the bookkeeping where a model
    // cannot be asked to do it.
    const port = capturingPort();
    await compose(port, [siege("Hieron II tightened the cordon again.")], {
      recentTitles: ["Hieron II Tightens the Investment of Messana", "Rome Places Messana Under Protection"],
    });
    expect(port.lastUserMessage).toContain("WHAT THE LAST REPORT ALREADY SAID");
    expect(port.lastUserMessage).toContain("Hieron II Tightens the Investment of Messana");
    expect(port.lastUserMessage).toContain("Do not write any of these again");
  });

  it("says nothing about a previous report when there was none", async () => {
    const port = capturingPort();
    await compose(port, [siege("Hieron II tightened the cordon again.")]);
    expect(port.lastUserMessage).not.toContain("WHAT THE LAST REPORT ALREADY SAID");
  });

  it("never holds back the reader's own business, however slowly it goes", async () => {
    // A ruler is entitled to the whole of his own reign, and an order must
    // always be answered: suppressing a repeat here would break the one
    // guarantee the Chronicle makes.
    const ours = fact({
      kind: "military_preparation",
      summary: "Rome went on preparing, exactly as before.",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      visibility: "public",
      discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    });
    const told = [["polity:rome"]];
    expect((await compose(capturingPort(), [ours], { recentSubjects: told })).entries).toHaveLength(1);
  });

  it("never lets the historian decline the answer to an order as said before", async () => {
    // "Continue the siege of Messana; hire merchants; merge Legio II into
    // Legio I." Shown the last report's titles, the historian judged the siege
    // an old story and wrote nothing -- and the merchants he could not hire and
    // the legion that did not exist went with it.
    const answer = fact({
      kind: "siege_continued",
      summary: "Clepsina kept Legio I in its investment of Messana.",
      affectedEntities: [{ kind: "polity", id: "rome" }],
      visibility: "public",
      discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    });
    const declining: SimModelPort & { userMessages: string[] } = {
      userMessages: [],
      complete(_operation, _system, user) {
        declining.userMessages.push(user);
        return Promise.resolve(JSON.stringify({ entries: [] }));
      },
    };
    const result = await compose(declining, [answer], {
      orderFactIds: new Set([answer.id]),
      recentTitles: ["Legio I Breaks Hieron's Army Before Messana"],
    });
    expect(declining.userMessages[0]).not.toContain("WHAT THE LAST REPORT ALREADY SAID");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.body).toContain("Clepsina kept Legio I");
  });
});

describe("a passage that could not be written", () => {
  it("costs its own matter its prose and nothing else", async () => {
    // A report is written a passage at a time, so an answer the engine cannot
    // read is now local damage. It used to be total: one unreadable answer
    // dropped every entry in the report to bare fact summaries.
    const port: SimModelPort = {
      complete(_operation, _system, user) {
        if (user.includes("Messana")) return Promise.resolve("The historian sends his regrets.");
        return Promise.resolve(JSON.stringify({ entries: [{ thread: 1, title: "The legions go north", body: "In the spring, Rome began to raise new legions." }] }));
      },
    };

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
    const written = result.entries.find((entry) => entry.subjects.some((subject) => subject.id === "boii"))!;
    const unwritten = result.entries.find((entry) => entry.subjects.some((subject) => subject.id === "carthage"))!;
    expect(written.title).toBe("The legions go north");
    // The one that failed keeps its facts, under the period as a title.
    expect(unwritten.body).toContain("Carthage weighs the strait at Messana.");
  });
});

describe("the Senate's business", () => {
  const OBSERVER = { kind: "character" as const, id: "gaius-genucius" };
  const vote = (procedure: string, summary: string) => fact({
    kind: "motion_passed",
    summary,
    affectedEntities: [{ kind: "procedure", id: procedure }, { kind: "polity", id: "rome" }, { kind: "character", id: "manius-curius" }],
    visibility: "public",
    discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
  });
  const compose = (port: SimModelPort, facts: Fact[], extra: Partial<Parameters<typeof composeChronicle>[0]> = {}) =>
    composeChronicle({
      port, clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 2, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["gaius-genucius", "rome"]),
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, 60])),
      maxEntries: 1,
      ...extra,
    });
  const three = () => [
    vote("procedure-transports", "The Senate carried \"Prepare transports for 20,000 men\", 60 to 59."),
    vote("procedure-taxes", "The Senate rejected \"Raise war taxes\", 19 to 40."),
    vote("procedure-emergency", "The Senate carried \"Declare the Sicilian front a national emergency\", 60 to 59."),
  ];

  it("gives each vote its own entry, whoever sponsored them all, and cuts none of them", async () => {
    // Three votes in a sitting, one sponsor: they were one entry.
    const result = await compose(capturingPort(), three());
    expect(result.entries).toHaveLength(3);
  });

  it("heads an entry the historian would not write with what happened, not the dates", async () => {
    const declining: SimModelPort = { complete: () => Promise.resolve(JSON.stringify({ entries: [] })) };
    const result = await compose(declining, three().slice(0, 1));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.title).toBe("The Senate carried \"Prepare transports for 20,000 men\"");
  });
});

describe("the audit of a Roman consul's spring", () => {
  const OBSERVER = { kind: "character" as const, id: "clepsina" };
  const SIDE = new Set(["clepsina", "rome", "latium", "legio-i", "treasury", "clepsina-purse", "senate"]);
  const base = (facts: Fact[], weights: Record<string, number>, extra: Partial<Parameters<typeof composeChronicle>[0]> = {}) =>
    composeChronicle({
      port: capturingPort(), clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 60, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: SIDE,
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, weights[candidate.id] ?? 50])),
      ...extra,
    });

  /** A strip of road: Latium, then ten provinces east, two days apart, and Pannonia joined to nothing. */
  const road = () => {
    const chain = ["latium", ...Array.from({ length: 10 }, (_, index) => `east-${index + 1}`)];
    return {
      map: {
        provinces: [...chain, "pannonia"].map((id) => ({ id, name: id, controllerPolityId: id === "latium" ? "rome" : null, settlements: [] })),
        polities: [{ id: "rome", name: "Rome", capitalSettlementId: null }],
        edges: chain.slice(1).map((id, index) => ({ from: chain[index]!, to: id, crossing: "land", distance: 85 })),
      },
      characters: [{ id: "clepsina", locationProvinceId: "latium" }],
      material: { forces: [{ id: "legio-i", locationId: "latium" }] },
      projects: [{
        id: "crossing-1", kind: "crossing", label: "The crossing", sponsorEntityRef: { kind: "polity", id: "rome" },
        overseerCharacterId: null, linkedEntityIds: [],
        completionOutcome: { kind: "force_move", forceId: "legio-i", provinceId: "east-1" },
      }],
    } as unknown as NonNullable<Parameters<typeof composeChronicle>[0]["world"]>;
  };

  it("tells a project's arrival in the thread of the army it moved", async () => {
    const march = fact({ summary: "Legio I embarks for Messana.", affectedEntities: [{ kind: "force", id: "legio-i" }] });
    const done = fact({ kind: "project_completed", summary: "The crossing is complete: Legio I is ashore.", affectedEntities: [{ kind: "project", id: "crossing-1" }] });
    const result = await base([march, done], { [march.id]: 60, [done.id]: 60 }, { world: road() });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.factIds).toEqual([march.id, done.id]);
  });

  it("does not gather the world's far-off weather into the order's passage", async () => {
    const answer = fact({ summary: "Clepsina orders the fleet built.", affectedEntities: [{ kind: "character", id: "clepsina" }, { kind: "province", id: "latium" }] });
    const shock = fact({ kind: "price_shock", summary: "Grain runs short in Iazygia.", affectedEntities: [{ kind: "province", id: "iazygia" }] });
    const result = await base([answer, shock], { [answer.id]: 50, [shock.id]: 30 }, { orderFactIds: new Set([answer.id, shock.id]) });
    expect(result.entries.map((entry) => entry.factIds)).not.toContainEqual([answer.id, shock.id]);
  });

  it("tells what else the order did inside its answer, not as entries of its own", async () => {
    const answer = fact({ summary: "Clepsina orders the fleet built.", affectedEntities: [{ kind: "character", id: "clepsina" }, { kind: "province", id: "latium" }] });
    const aside = fact({ summary: "Rome begins surveying Messana's defences.", affectedEntities: [{ kind: "province", id: "messana" }] });
    const other = fact({ summary: "The office of admiral is created.", affectedEntities: [{ kind: "institution", id: "senate" }] });
    const result = await base([answer, aside, other], { [answer.id]: 50, [aside.id]: 30, [other.id]: 30 }, { orderFactIds: new Set([answer.id, aside.id]) });
    const told = result.entries.map((entry) => entry.factIds);
    expect(told).toContainEqual([answer.id, aside.id]);
    expect(told).toContainEqual([other.id]);
  });

  it("makes a letter and the model's word of it one matter", async () => {
    const letter = fact({
      kind: "letter_sent", summary: "Clepsina wrote for Rome to Hiero of Syracuse: \"The strait\".",
      affectedEntities: [{ kind: "character", id: "clepsina" }, { kind: "character", id: "hiero" }, { kind: "polity", id: "rome" }, { kind: "polity", id: "syracuse" }],
      time: { day: 3, minute: 0 },
      // On the road to Syracuse for a week: its reader has it then, its writer now.
      visibility: "polity",
      discovery: { state: "delayed", knowableAtInstant: { day: 10, minute: 0 }, discoveredBy: [] },
    });
    const appeal = fact({
      kind: "diplomatic_appeal", summary: "Clepsina appealed to Syracuse to keep the strait open.",
      affectedEntities: [{ kind: "character", id: "clepsina" }, { kind: "polity", id: "syracuse" }],
      time: { day: 3, minute: 0 },
    });
    const result = await base([letter, appeal], {}, { to: { day: 5, minute: 0 } });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.factIds).toHaveLength(2);
  });

  it("does not carry a far-off local fire to the consul, but still a far-off war", async () => {
    const fire = fact({ kind: "disaster", summary: "Fire consumes the heart of a town.", affectedEntities: [{ kind: "province", id: "east-10" }] });
    const nearFire = fact({ kind: "disaster", summary: "Fire consumes a market nearby.", affectedEntities: [{ kind: "province", id: "east-2" }] });
    const unjoined = fact({ kind: "disgrace", summary: "A chief's kinsman is disgraced.", affectedEntities: [{ kind: "province", id: "pannonia" }] });
    const war = fact({ kind: "war_declared", summary: "Two kings go to war.", affectedEntities: [{ kind: "province", id: "east-9" }] });
    const result = await base([fire, nearFire, unjoined, war], { [fire.id]: 55, [nearFire.id]: 55, [unjoined.id]: 55, [war.id]: 80 }, { world: road() });
    const told = result.entries.flatMap((entry) => entry.factIds);
    expect(told).toContain(nearFire.id);
    expect(told).toContain(war.id);
    expect(told).not.toContain(fire.id);
    expect(told).not.toContain(unjoined.id);
  });

  it("shows a change only on the entry whose facts made it, and the world's routine on none", async () => {
    const office = fact({ summary: "Rome creates the office of admiral.", affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "institution", id: "senate" }] });
    const fleet = fact({ summary: "The fleet is laid down.", affectedEntities: [{ kind: "polity", id: "rome" }, { kind: "project", id: "fleet-1" }] });
    const siege = fact({ summary: "Syracuse presses the siege.", affectedEntities: [{ kind: "force", id: "syracusan-army" }, { kind: "province", id: "messana" }] });
    const match = fact({ summary: "Clepsina seeks a match for his daughter.", affectedEntities: [{ kind: "character", id: "clepsina" }], time: { day: 5, minute: 0 } });
    const result = await base([office, fleet, siege, match], {}, {
      changes: [
        { kind: "account", id: "treasury", claimedBy: ["rome"], label: "Rome's treasury", detail: "up 1,234", causes: [], routine: true },
        { kind: "account", id: "treasury-2", claimedBy: ["rome"], label: "Rome's war chest", detail: "down 2,000", causes: [{ id: "fleet-1", day: 0 }], routine: false },
        { kind: "force", id: "syracusan-army", label: "Syracusan army", detail: "up 361", causes: [], routine: true },
        { kind: "account", id: "clepsina-purse", claimedBy: ["clepsina"], label: "Clepsina's purse", detail: "down 300", causes: [{ id: "obligation-x", day: 12 }], routine: false },
      ],
    });
    const changesOf = (factId: string) => result.entries.find((entry) => entry.factIds.includes(factId))!.changes.map((change) => change.id);
    expect(changesOf(office.id)).toEqual([]);
    expect(changesOf(fleet.id)).toEqual(["treasury-2"]);
    expect(changesOf(siege.id)).toEqual([]);
    expect(changesOf(match.id)).toEqual([]);
  });

  it("tags a battle by the men who led it, and a name once", async () => {
    const battle = fact({
      kind: "battle", summary: "Off Lipara the fleets met.",
      affectedEntities: [
        { kind: "character", id: "decius" }, { kind: "character", id: "decius" }, { kind: "character", id: "gisco" },
        { kind: "polity", id: "boii" }, { kind: "province", id: "boii-land" }, { kind: "polity", id: "carthage" }, { kind: "polity", id: "rome" },
      ],
    });
    const second = fact({ summary: "Decius Vibellius brought news of it.", affectedEntities: [{ kind: "character", id: "decius" }] });
    const names: Record<string, string> = { decius: "Decius Vibellius", gisco: "Hannibal Gisco", boii: "Boii", "boii-land": "Boii", carthage: "Carthage", rome: "Rome" };
    const result = await base([battle, second], { [battle.id]: 90, [second.id]: 20 }, {
      nameOf: (ref) => names[ref.id] ?? null,
      battleAccounts: [{
        factIds: [battle.id], provinceName: "Lipara",
        sides: [{ name: "Punic fleet", attacking: true, strength: 100, unit: "ships", commander: "Hannibal Gisco" }],
        phases: [], tactics: [], refusedTactics: [], losses: [], commanders: [], retreats: [], outcome: "attacker_victory",
      }],
    });
    const labels = result.entries[0]!.tags.map((tag) => tag.label);
    expect(labels[0]).toBe("Hannibal Gisco");
    expect(labels).toContain("Rome");
    expect(labels.filter((label) => label === "Boii")).toHaveLength(1);
  });
});
