import { describe, expect, it } from "vitest";
import { ScenarioClockSchema, emitFacts, factsKnownTo, type Fact, type FactDraft, type WorldStoryline } from "@chronica/shared";
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

  it("shows three subjects at most, the reader's own government last, under the names they are known by", async () => {
    const own = fact({
      summary: "Rome storms the Etruscan towns.",
      affectedEntities: [
        { kind: "polity", id: "rome" }, { kind: "polity", id: "etruria" },
        { kind: "province", id: "vatluna" }, { kind: "province", id: "rusellae" }, { kind: "character", id: "corvus" },
      ],
    });
    const names: Record<string, string> = { etruria: "Etruscan Confederation", vatluna: "Vatluna", rusellae: "Rusellae" };
    const result = await compose(capturingPort(), [own], { nameOf: (ref) => names[ref.id] ?? null });
    expect(result.entries[0]!.subjects.length).toBeGreaterThan(3);
    expect(result.entries[0]!.tags).toHaveLength(3);
    expect(result.entries[0]!.tags.map((tag) => tag.id)).not.toContain("rome");
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

  it("gives the reign's own separate affairs an entry each, whatever they weigh", async () => {
    // The old rule fused everything naming the ruler's side into one passage,
    // so a reign doing four things read as one thing.
    const facts = [
      fact({ summary: "The garrison at Rhegium is reinforced.", affectedEntities: [{ kind: "province", id: "rhegium" }] }),
      fact({ summary: "The Senate rewards the loyal cohort.", affectedEntities: [{ kind: "institution", id: "roman-senate" }] }),
      fact({ summary: "An envoy departs for Syracuse.", affectedEntities: [{ kind: "character", id: "falto" }, { kind: "polity", id: "syracuse" }] }),
    ];
    const result = await composeChronicle({
      port: capturingPort(), clock, observer: OBSERVER, observerPolityId: "rome", facts,
      from: { day: 0, minute: 0 }, to: { day: 30, minute: 0 }, narrative: [], frictions: [],
      ownEntityIds: new Set(["marcus-atilius", "rome", "rhegium", "roman-senate", "falto"]),
      significanceByFactId: new Map(facts.map((candidate) => [candidate.id, 5])),
    });
    expect(result.entries).toHaveLength(3);
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
});
