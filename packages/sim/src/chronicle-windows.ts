import { diffWorlds, type Fact, type Office, type OrderPartyRef, type ScenarioClock, type WorldState } from "@chronica/shared";
import type { BattleAccount } from "./battle";
import type { WindowSnapshot } from "./burst";
import {
  MUST_TELL,
  WINDOW_MAX_ENTRIES,
  composeChronicle,
  nameOfSubject,
  ownSideOf,
  personallyTouchedBy,
  whoIsWho,
  type ChronicleEntry,
  type NarrativeLine,
  type UtteranceLine,
} from "./chronicle";
import type { SimModelPort } from "./ports";

/**
 * The record, written window by window while the burst runs.
 *
 * The composer judges one span at a time. This is what strings the spans of a
 * burst together: each window is composed as it closes, in order, with the
 * facts the earlier windows did not tell carried forward as candidates; each
 * passage is handed out the moment it is written, so a page can show it while
 * the world is still moving; and a record that would otherwise be blank is
 * offered what was never told once more, so a quiet span is not a blank one.
 *
 * Composing is sequential by nature -- the next window's candidates depend on
 * what this one told -- but it overlaps the burst: window k is being written
 * while the engine walks hop k+1. Nothing here touches the burst's state; a
 * snapshot is a value.
 */

export interface WindowWriterInput {
  readonly port: SimModelPort;
  readonly clock: ScenarioClock;
  readonly observer: OrderPartyRef;
  readonly observerPolityId: string | null;
  readonly offices: readonly Office[];
  /** What earlier reports were about and said, so a matter merely continuing is not headlined again. */
  readonly recentSubjects: readonly (readonly string[])[];
  readonly recentTitles: readonly string[];
  /** Called with each passage as it is written, in the order of the record. Awaited, so passages are handed out in order. */
  readonly onEntry?: ((entry: ChronicleEntry, window: number) => Promise<void>) | undefined;
}

export interface WindowWriter {
  /** Hand over a closed window. Returns at once; the writing is queued behind the previous window's. */
  readonly closed: (window: WindowSnapshot) => void;
  /** Wait for every queued window, offer what was never told one last time, and return the whole record in order. */
  readonly finish: () => Promise<{ readonly entries: readonly ChronicleEntry[]; readonly calls: number }>;
}

const keyOf = (ref: OrderPartyRef): string => `${ref.kind}:${ref.id}`;

export function createWindowWriter(input: WindowWriterInput): WindowWriter {
  const { port, clock, observer, observerPolityId, offices } = input;
  const published: ChronicleEntry[] = [];
  let calls = 0;
  let orderFactIds: ReadonlySet<string> = new Set();
  // Accounts, difficulties and words accumulate: a carried fact's own account
  // was written in an earlier window, and the composer finds it by fact id.
  const narrative: NarrativeLine[] = [];
  const frictions: NarrativeLine[] = [];
  const utterances: UtteranceLine[] = [];
  const battleAccounts: BattleAccount[] = [];
  let lastWorld: WorldState | null = null;
  let span: { from: WindowSnapshot["from"]; to: WindowSnapshot["to"] } | null = null;
  /**
   * Windows are composed as they close, side by side, and published in
   * order: the composer for window k+1 need not wait for window k's prose,
   * only the reader must see k's before k+1's. What window k did not tell
   * goes into the pool and rides with the next window to start; a matter
   * carried past a window still composing is dated when it is finally told.
   */
  let pool: readonly Fact[] = [];
  const composing: Promise<readonly ChronicleEntry[]>[] = [];
  let publishing: Promise<void> = Promise.resolve();

  const viewsOf = (world: WorldState) => ({
    polityOfCharacter: (id: string) => world.characters.find((character) => character.id === id)?.polityId ?? null,
    nameOf: (ref: OrderPartyRef) => nameOfSubject(world, ref),
    describePerson: whoIsWho(world, offices),
    ownEntityIds: ownSideOf(world, observer.id, observerPolityId),
    personalEntityIds: personallyTouchedBy(world, observer.id, observerPolityId, offices),
    storylines: world.storylines,
    // Where everybody is when the window closes, for the road news travels.
    world,
  });

  // The record is indexed by the day a matter entered it, and a page has
  // already shown what came before. So a passage is never dated before the
  // one published ahead of it: a late-told matter is dated when it was told.
  let lastDated = 0;
  const publish = async (entries: readonly ChronicleEntry[], window: number): Promise<void> => {
    for (const written of entries) {
      const to = Math.max(written.toInstantSortKey, lastDated);
      const entry: ChronicleEntry = to === written.toInstantSortKey ? written : { ...written, toInstantSortKey: to, fromInstantSortKey: Math.min(written.fromInstantSortKey, to) };
      lastDated = to;
      published.push(entry);
      if (input.onEntry !== undefined) await input.onEntry(entry, window);
    }
  };

  /** Everything composed so far, whether published yet or not, so the next window knows what has been said. */
  const said: ChronicleEntry[] = [];

  /** What each window chose to tell, as it chose it: the next window's "already said" before any prose exists. */
  const chosenSubjects: (readonly string[])[] = [];
  /** Whether any window has chosen anything at all to tell. */
  let anythingChosen = false;
  /** Settled when the window before has chosen what to tell and what to carry. */
  let selecting: Promise<void> = Promise.resolve();

  const compose = async (window: WindowSnapshot, gate: Promise<void>, chosenBefore: Promise<void>, chosen: () => void): Promise<readonly ChronicleEntry[]> => {
    // What the window before carries is this one's to tell, and what it chose
    // is already said: both are known once it has chosen, long before its
    // passages are written. Waiting for that -- and only that -- keeps the
    // carry and the repeats right while the writing still runs side by side
    // (C07). A window that started choosing before the last had carried used
    // to miss what it carried, and the burst's last matters went untold.
    await chosenBefore;
    narrative.push(...window.narrative);
    frictions.push(...window.frictions);
    utterances.push(...window.utterances);
    battleAccounts.push(...window.battleAccounts);
    if (window.orderFactIds.length > 0) orderFactIds = new Set(window.orderFactIds);
    lastWorld = window.worldAfter;
    span = { from: span?.from ?? window.from, to: window.to };
    const facts = [...pool, ...window.facts];
    pool = [];
    try {
      const out = await composeChronicle({
        port,
        clock,
        observer,
        observerPolityId,
        facts,
        from: window.from,
        to: window.to,
        narrative,
        frictions,
        utterances,
        battleAccounts,
        significanceByFactId: window.significanceByFactId,
        ...viewsOf(window.worldAfter),
        orderFactIds,
        changes: diffWorlds(window.worldBefore, window.worldAfter, offices),
        // What this burst has already said counts as said: a thread told in an
        // earlier window is continued at the later date, never rewritten.
        recentSubjects: [...chosenSubjects, ...said.map((entry) => entry.subjects.map(keyOf)), ...input.recentSubjects],
        recentTitles: [...[...said].reverse().map((entry) => entry.title), ...input.recentTitles],
        onSelected: (selection) => {
          pool = [...pool, ...selection.carried];
          chosenSubjects.push(...selection.subjects);
          if (selection.subjects.length > 0) anythingChosen = true;
          chosen();
        },
        // The last window has the room a window and the old closing pass had
        // between them, since it also tells what the pool carried this far;
        // its passages are written side by side, so the room costs no time.
        maxEntries: window.final ? 2 * WINDOW_MAX_ENTRIES : WINDOW_MAX_ENTRIES,
        // A quiet span is not a blank one: the last window tells the
        // weightiest of what nothing cleared, as a report written in one
        // piece would.
        fallback: window.final && !anythingChosen,
        // Each passage goes out the moment it is written, once every passage
        // of the window before it has gone out: the reader gets the order's
        // answer while the world's other matters are still being composed.
        onEntry: async (entry) => {
          await gate;
          said.push(entry);
          await publish([entry], window.index);
        },
      });
      calls += out.calls;
      return out.entries;
    } catch (error) {
      // The record is not the world. A window that could not be written is
      // its facts carried into the next; the burst goes on regardless.
      console.error(`[chronicle] window ${window.index} could not be written:`, error);
      if (!pool.some((fact) => facts.includes(fact))) pool = [...pool, ...facts];
      return [];
    } finally {
      chosen();
    }
  };

  return {
    closed: (window) => {
      // This window's passages wait for the previous window's; its composing
      // does not.
      const gate = publishing;
      const chosenBefore = selecting;
      let chosen: () => void = () => undefined;
      selecting = new Promise<void>((resolve) => { chosen = resolve; });
      const entries = compose(window, gate, chosenBefore, () => chosen());
      composing.push(entries);
      publishing = entries.then(() => undefined).catch(() => undefined);
    },
    finish: async () => {
      await Promise.all(composing);
      await publishing;
      // A record that went blank gets one last look: when nothing at all
      // cleared the bar and something happened, the weightiest of it is told
      // rather than leaving the span blank, exactly as a report written in
      // one piece would. That is the only closing pass. The last window
      // already told what the pool carried to it, and what it left -- a
      // matter carried past a window that was still being written when the
      // burst ended -- stays untold, as any window's leftovers do: another
      // compose after the last window ran in series with it and was the
      // longest part of the turn's tail.
      // And what must never go untold -- a part of the order, a vote of one's
      // own, a turn of a siege -- is told in a closing passage even when
      // something else was published: it was left only because it came too
      // late for the window that would have told it.
      const owed = pool.filter((fact) => MUST_TELL.has(fact.kind) || orderFactIds.has(fact.id) || (fact.sourceActionId ?? null) !== null);
      if (published.length > 0 && owed.length > 0) pool = owed;
      if ((published.length === 0 || owed.length > 0) && pool.length > 0 && lastWorld !== null && span !== null) {
        const out = await composeChronicle({
          port,
          clock,
          observer,
          observerPolityId,
          facts: pool,
          from: span.from,
          to: span.to,
          narrative,
          frictions,
          utterances,
          battleAccounts,
          ...viewsOf(lastWorld),
          orderFactIds,
          recentSubjects: [...said.map((entry) => entry.subjects.map(keyOf)), ...input.recentSubjects],
          recentTitles: [...[...said].reverse().map((entry) => entry.title), ...input.recentTitles],
          maxEntries: WINDOW_MAX_ENTRIES,
          fallback: true,
        }).catch((error: unknown) => {
          console.error("[chronicle] the closing passage could not be written:", error);
          return { entries: [], calls: 0, carried: pool };
        });
        pool = [];
        calls += out.calls;
        await publish(out.entries, -1);
      }
      return { entries: published, calls };
    },
  };
}
