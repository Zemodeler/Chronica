import "server-only";
import { readPeaceTables, type PeaceTablesView } from "@chronica/sim";

import { factSignificances, getCharacterKnowledgebase, listChronicle, listFollowedThreads, listRecentFacts } from "@chronica/db";
import {
  FactSchema,
  lettersAwaitingYou,
  lettersDirectory,
  correspondenceOf,
  orderPartStatus,
  orderPartLabel,
  mattersInHand,
  musterTheForces,
  ordersUnderWay,
  promisesOf,
  readGlossary,
  peersOf,
  threadsYouSee,
  formatWorldDate,
  whatComesNext,
  type AwaitingLetter,
  type CalendarItem,
  type Fact,
  type Glossary,
  type PeersReading,
  type ThreadNote,
  type Matters,
  type PromiseReading,
  type UnderWayItem,
  notableEventsSince,
  readTheMirror,
  readTheBooks,
  readService,
  type ServiceReading,
  readTheState,
  readYourStanding,
  readOfficeInsights,
  readConstitutionHistory,
  readLaws,
  readStandingOrders,
  readAdministration,
  buildAgenda,
  type Agenda,
  type Administration,
  type ConstitutionReading,
  type LawsReading,
  type StandingOrders,
  type OfficeInsights,
  roomStates,
  type Books,
  type MirrorReading,
  type NotableEvent,
  type StoryEntry,
  type Muster,
  type RoomStates,
  type Standing,
  type StateReading,
} from "@chronica/shared";
import { getContactsView } from "./dialogue-service";
import { withPlayerWorld } from "./player-world";
import type { DirectoryView } from "./directory-service";

/**
 * What is in the player's room, and what each thing in it says when opened.
 *
 * An object appears in the Office only when the thing it stands for is true,
 * and only the server can answer that: whether a man commands anyone, holds
 * any office or land, or has books anybody keeps. The shell was guessing from
 * "does this player hold a character at all", which is true of everybody and
 * put an arms rack in a private citizen's room.
 *
 * The ledger stand is there when he keeps somebody else's books -- a
 * treasury, an army's chest, a guild's fund -- and the strongbox when he has
 * money in his own name (books.ts).
 *
 * The sheets come with the room. Each panel used to fetch its own on opening,
 * and every one of those loaded and validated the whole world again to compute
 * a few milliseconds of arithmetic the room had just done and thrown away; in
 * `next dev` each was also a route compiled on first use, several seconds
 * apiece. One read now, and a panel opens already filled.
 *
 * Everything here is station-filtered by the same `seesAccount`/`seesForce`
 * the world slice uses, so what the player is shown can never drift from what
 * the model is told.
 */

export type BooksView = Books & { readonly currencyName: string };
export type MusterView = Muster & { readonly currencyName: string };

export interface OrderHistoryView {
  readonly id: string;
  readonly text: string;
  readonly when: string;
  readonly parts: readonly { readonly label: string; readonly status: string; readonly detail: string | null }[];
}

export interface RoomSheets {
  readonly directory?: DirectoryView;
  readonly contacts?: Awaited<ReturnType<typeof getContactsView>>;
  readonly orderHistory?: readonly OrderHistoryView[];
  readonly insights: OfficeInsights;
  /** The strongbox: what is in his own name. */
  readonly own: BooksView;
  /** The ledger stand: what he keeps for somebody else. */
  readonly kept: BooksView;
  readonly forces: MusterView;
  /** His own place in an army's ranks, for the muster. Null for anyone not serving. */
  readonly service: ServiceReading | null;
  readonly standing: Standing;
  /** The state he serves, for the seal case. */
  readonly state: StateReading;
  /** How that state came to be governed as it is (`readConstitutionHistory`): public to its citizens, office or none. */
  readonly constitution: ConstitutionReading;
  /** Its measures in force and before the councils (`readLaws`). */
  readonly laws: LawsReading;
  /** His conditional orders (`readStandingOrders`), for the writing desk. */
  readonly standingOrders: StandingOrders;
  /** The departments of the state he keeps books for (`readAdministration`), for the ledger stand. */
  readonly administration: Administration;
  /** Everything open to him, once each, in three groups (`buildAgenda`), opened from the date. */
  readonly agenda: Agenda;
  /** The bronze mirror: who he is now. Null while his character has not yet entered the world. */
  readonly self: MirrorReading | null;
  /** What has happened to him since the opening (life-story.ts), newest first. */
  readonly story: readonly NotableEvent[];
  /** What is coming (`whatComesNext`), for the line beside the date. */
  readonly calendar: readonly CalendarItem[];
  /** What his orders are doing (`ordersUnderWay`), for the desk. */
  readonly underWay: readonly UnderWayItem[];
  /** Open promises either way (`promisesOf`), for the mirror. */
  readonly promises: readonly PromiseReading[];
  /** Peace talks his power is at, and the wars it might talk its way out of (`readPeaceTables`). */
  readonly peace: PeaceTablesView;
  /** Letters waiting on his answer (`lettersAwaitingYou`). */
  readonly letters: readonly AwaitingLetter[];
  /** Everything open that concerns him (`mattersInHand`), opened from the date. */
  readonly matters: Matters;
  /** A note for every name he can ask about (`readGlossary`). */
  readonly glossary: Glossary;
  /** Where he stands among his peers (`peersOf`), for the mirror. */
  readonly peers: PeersReading | null;
  /** The threads of history he may know of (`threadsYouSee`), by storyline id. */
  readonly threads: Readonly<Record<string, ThreadNote>>;
}

export interface RoomContents {
  readonly forces: boolean;
  readonly standing: boolean;
  readonly books: boolean;
  readonly purse: boolean;
  /** What each object says about itself now, and whether it wants the player's word (`roomStates`). */
  readonly states: RoomStates;
  /** Null for someone with no character, who has a room with nothing in it. */
  readonly sheets: RoomSheets | null;
}

export async function getRoomContents(gameId: string): Promise<RoomContents | null> {
  return withPlayerWorld(gameId, async ({ world, characterId, playerId, view, db }) => {
    if (characterId === null) return { forces: false, standing: false, books: false, purse: false, states: {}, sheets: null };
    const offices = view.scenarioGovernment?.offices ?? [];
    const currencyName = world.material.currency.name;
    const own = { ...readTheBooks(world, characterId, offices, "own"), currencyName };
    const kept = { ...readTheBooks(world, characterId, offices, "kept"), currencyName };
    const forces = { ...musterTheForces(world, characterId, offices, view.scenarioClock, view.scenarioWarfare), currencyName };
    // His own place in the ranks, where he serves in an army (`readService`).
    const service = readService(world, characterId);
    const standing = readYourStanding(world, characterId, offices, view.scenarioClock);
    // The declaration only lends its words -- "elder brother", a line of
    // notes -- to people the world already has on the list.
    const [declared, record, contacts, recentFacts, followed] = await Promise.all([
      playerId === null ? null : getCharacterKnowledgebase(db, gameId, playerId).catch(() => null),
      listChronicle(db, gameId, RECORD_READ),
      playerId === null ? [] : getContactsView(db, gameId, playerId).catch(() => []),
      listRecentFacts(db, gameId).catch(() => []),
      listFollowedThreads(db, gameId).catch(() => []),
    ]);
    const self = readTheMirror({
      world,
      characterId,
      government: view.scenarioGovernment,
      clock: view.scenarioClock,
      declared: (declared?.relations ?? []).map((relation) => ({ name: relation.name, relationship: relation.relationship, notes: relation.notes ?? "" })),
    });
    const story = notableEventsSince({
      world,
      characterId,
      government: view.scenarioGovernment,
      clock: view.scenarioClock,
      entries: await storyEntries(db, gameId, world, characterId, record),
    });
    const clock = view.scenarioClock;
    const facts = recentFacts
      .map((row) => FactSchema.safeParse(row.fact))
      .flatMap((parsed): Fact[] => (parsed.success ? [parsed.data] : []));
    const glossary = readGlossary({
      world,
      characterId,
      offices,
      successionRules: view.scenarioGovernment?.successionRules ?? [],
      clock,
      muster: forces,
      warfare: view.scenarioWarfare,
      facts,
      conversationPartnerIds: contacts.filter((contact) => !contact.isGroup).map((contact) => contact.npcCharacterId).filter((id) => id.length > 0),
    });
    const state = readTheState(world, characterId, offices, clock, view.scenarioGovernment?.successionRules ?? []);
    const constitution = readConstitutionHistory(world, characterId, offices, clock);
    const laws = readLaws(world, characterId, offices, clock);
    const standingOrders = readStandingOrders(world, characterId, offices, clock);
    const administration = readAdministration(world, characterId, offices, clock);
    const matters = mattersInHand(world, characterId, offices, clock);
    const agenda = buildAgenda({ calendar: whatComesNext(world, characterId, offices, clock, 60), matters, laws, orders: standingOrders, administration });
    // A citizen with no office still has a state: how it is governed and its
    // laws are public to the people under them, so the seal case is theirs.
    const publicState = state.government !== null || constitution.entries.length > 0 || laws.inForce.length > 0 || laws.before.length > 0 || state.offices.length > 0;
    return {
      // A man in the ranks has his own place in an army, whether or not he commands one.
      forces: forces.forces.length > 0 || service !== null,
      standing: standing.nothing === null || publicState,
      books: kept.accounts.length > 0 || administration.departments.length > 0,
      purse: own.accounts.length > 0,
      states: roomStates(world, characterId, offices, view.scenarioClock, view.scenarioWarfare),
      sheets: {
        directory: {
          groups: lettersDirectory({ world, viewerId: characterId, conversationPartnerIds: contacts.filter((contact) => !contact.isGroup).map((contact) => contact.npcCharacterId), offices, clock }),
          letters: lettersAwaitingYou(world, characterId, offices, clock),
          correspondence: correspondenceOf(world, characterId, clock),
        },
        contacts,
        orderHistory: world.orders.filter((order) => order.actorCharacterId === characterId).slice(-60).reverse().map((order) => ({
          id: order.id,
          text: order.text,
          when: formatWorldDate({ day: order.givenAtStep, minute: 0 }, clock),
          parts: order.parts.map((part) => ({ label: part.said, status: orderPartLabel(orderPartStatus(world, part), part, world), detail: part.refusal ?? part.whyNot ?? part.note })),
        })),
        insights: readOfficeInsights({ world, characterId, offices, clock, warfare: view.scenarioWarfare, facts, ownBooks: own, keptBooks: kept, muster: forces }),
        own, kept, forces, service, standing, state, constitution, laws, standingOrders, administration, agenda, self, story,
        calendar: whatComesNext(world, characterId, offices, clock),
        underWay: ordersUnderWay(world, characterId, offices, clock),
        promises: promisesOf(world, characterId, clock),
        peace: readPeaceTables(world, characterId, offices, (day) => formatWorldDate({ day, minute: 0 }, clock)),
        letters: lettersAwaitingYou(world, characterId, offices, clock),
        matters,
        glossary,
        peers: peersOf(world, characterId, offices),
        threads: threadsYouSee({
          world,
          characterId,
          offices,
          followedIds: new Set(followed),
          entries: record.map((row) => ({
            id: row.id,
            title: row.title,
            dateLabel: clock === undefined ? null : formatWorldDate({ day: Math.floor(row.toInstantSortKey / 1440), minute: 0 }, clock),
            sortKey: row.toInstantSortKey,
            read: row.readAt !== null,
            storylineIds: Array.isArray(row.storylineIds) ? (row.storylineIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
            factIds: Array.isArray(row.factIds) ? (row.factIds as unknown[]).filter((id): id is string => typeof id === "string") : [],
            subjects: refsOf(row.subjects),
          })),
        }),
      },
    };
  });
}

/** How far back through the record the mirror looks for entries about him. */
const RECORD_READ = 500;

type Ref = { readonly kind: string; readonly id: string };
const isRef = (value: unknown): value is Ref =>
  typeof value === "object" && value !== null && typeof (value as Partial<Ref>).kind === "string" && typeof (value as Partial<Ref>).id === "string";
const refsOf = (value: unknown): Ref[] => (Array.isArray(value) ? (value as unknown[]).filter(isRef) : []);

/**
 * The Chronicle entries that name him or anyone of his family, each weighed
 * by its facts' significance. Only these few have their facts looked up: the
 * rest of the record is not about him.
 */
async function storyEntries(
  db: Parameters<typeof listChronicle>[0],
  gameId: string,
  world: { readonly familyLinks: readonly { readonly characterId: string; readonly relatedCharacterId: string }[] },
  characterId: string,
  record: Awaited<ReturnType<typeof listChronicle>>,
): Promise<StoryEntry[]> {
  const people = new Set([characterId]);
  for (const link of world.familyLinks) {
    if (link.characterId === characterId) people.add(link.relatedCharacterId);
    if (link.relatedCharacterId === characterId) people.add(link.characterId);
  }
  const rows = record
    .map((row) => ({ row, subjects: refsOf(row.subjects) }))
    .filter(({ subjects }) => subjects.some((ref) => ref.kind === "character" && people.has(ref.id)));
  const factIdsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  const weights = await factSignificances(db, gameId, rows.flatMap(({ row }) => factIdsOf(row.factIds)));
  return rows.map(({ row, subjects }) => ({
    id: row.id,
    title: row.title,
    sortKey: row.toInstantSortKey,
    subjects,
    tags: refsOf(row.tags),
    significance: factIdsOf(row.factIds).reduce((sum, id) => sum + (weights.get(id) ?? 0), 0),
  }));
}
