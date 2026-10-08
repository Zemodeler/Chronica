import {
  FactProposalSchema,
  GenericEntitySchema,
  allOffices,
  lastCensus,
  readDepartments,
  shiftStanding,
  STATECRAFT_LOG_MAX,
  vacateOfficeOf,
  type Character,
  type FactProposalDraft,
  type Office,
  type WorldState,
} from "@chronica/shared";
import { enrolFormerMagistrates } from "./elections";
import { NOTA_KIND } from "./nota";

/**
 * The censors' *lectio*: the roll of the Senate read anew at the lustrum (docs/plans/government.md, "H6 as built").
 *
 * Once the censors have taken the census, they read the roll of the Senate (*lectio senatus*): the men who held a magistracy and are not yet on it are
 * enrolled, and a man who has dishonoured his place is struck off it by the censors' mark (*nota censoria*). The reasons are the age's: his hand found in the
 * chest, a conviction and exile, debts past bearing, a name nobody speaks well of. How hard the censors read it is their own temper (a dutiful man strikes
 * for debts and for a lost name, an easy one only for theft and exile). The mark keeps him off the roll until the next censors (five years on) lift it or lay it
 * again: they read every nota they find, and a man who has mended is let back with the others who held a magistracy.
 *
 * It is the censors' act and it is done by rule, in the month after their census; it asks the player nothing. A man the player is is struck only for the graver
 * reasons (theft proved, exile), never for a name low or a purse empty. At most `MOST_STRUCK` a lectio; one fact a roll, naming up to three. Deterministic.
 */

/** The most a lectio strikes off. */
export const MOST_STRUCK = 10;
/** A name this low is a reason, and a purse below nothing. */
export const NO_NAME_BPS = 1_200;
/** What the mark costs a man in standing. */
export const NOTA_STANDING_BPS = -600;
/** How long after the census the roll is still read for it. */
export const LECTIO_WINDOW_DAYS = 150;
/** Proved theft is held against a man for this long (five years, a lustrum). */
export const THEFT_HELD_DAYS = 1_800;

const MONTH = 30;
const fact = (raw: Record<string, unknown>): FactProposalDraft => FactProposalSchema.parse(raw) as unknown as FactProposalDraft;

export interface Reading {
  readonly score: number;
  readonly reasons: readonly string[];
  /** Whether it is graver than a lost name or a purse: theft proved, exile. */
  readonly grave: boolean;
}

/** What is against a man on the roll: theft proved, exile, debts, a name gone. Pure. */
export function unworthinessOf(world: WorldState, man: Character, day: number): Reading {
  const reasons: string[] = [];
  let score = 0;
  let grave = false;
  if (world.diversions.some((row) => row.byCharacterId === man.id && row.foundAtStep !== null && day - row.foundAtStep <= THEFT_HELD_DAYS)) { score += 3; grave = true; reasons.push("his hand was found in the chest"); }
  if (man.disqualifyingStatuses.includes("exiled")) { score += 3; grave = true; reasons.push("he was condemned and sent into exile"); }
  const purse = world.material.accounts.find((account) => account.id === man.personalAccountId)?.balance ?? 0;
  if (purse < 0) { score += 2; reasons.push("he is in debt past what his name can bear"); }
  if (man.prestigeBps < NO_NAME_BPS) { score += 1; reasons.push("nobody speaks well of him"); }
  return { score, reasons, grave };
}

/** The censors of a power: who holds both the census and the audit of the books, the men whose mark it is. Null where the power has no censorship. */
export function censorsOf(world: WorldState, polityId: string): readonly Character[] | null {
  const reader = readDepartments(world);
  const scope = { kind: "polity" as const, id: polityId };
  const census = reader.holding(scope, "census");
  const audit = reader.holding(scope, "audit");
  if (census.department === null || census.department.id !== audit.department?.id) return null;
  return census.people;
}

export interface LectioInput {
  readonly world: WorldState;
  readonly offices: readonly Office[];
  readonly toDay: number;
  readonly playerCharacterId?: string | null | undefined;
}

/**
 * The roll of every power with a censorship, read once for each census, in the month after it is taken. Returns the world after (seats vacated, marks laid and
 * lifted, men enrolled, a line in the log) and the facts.
 */
export function keepTheRoll(input: LectioInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const day = input.toDay;
  const last = world.society.lastReviewStep;
  if (!(last === null || day - last >= MONTH)) return { world, facts };
  const every = allOffices(world, input.offices);
  for (const polity of world.map.polities) {
    const censors = censorsOf(world, polity.id);
    if (censors === null || censors.length === 0) continue;
    const census = lastCensus(world, polity.id);
    if (census === null || day - census < 0 || day - census > LECTIO_WINDOW_DAYS) continue;
    const readEarlier = world.statecraft.log.some((entry) => entry.polityId === polity.id && entry.act === "magistrate" && entry.why.startsWith("lectio:") && entry.day >= census);
    if (readEarlier) continue;
    const council = every.find((office) => office.polityId === polity.id && office.enrolsFormerMagistrates === true && office.kind === "membership" && office.successionRuleId !== "abolished");
    if (council === undefined) continue;
    const censor = [...censors].sort((a, b) => a.id.localeCompare(b.id))[0]!;
    // The strictness of the reading is the censors' own: the dutiful strike for debts and a lost name too.
    const duty = censors.reduce((sum, man) => sum + man.mind.drives.duty, 0) / censors.length;
    const bar = duty >= 65 ? 2 : 3;

    // The next censors read every mark they find: the old are lifted, and laid again where the man has not mended.
    const marked = world.genericEntities.filter((entity) => entity.kind === NOTA_KIND && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === polity.id);
    const lifted = new Set(marked.map((entity) => String(entity.attributes?.["characterId"])));
    if (marked.length > 0) world = { ...world, genericEntities: world.genericEntities.filter((entity) => !marked.includes(entity)) };

    const seated = world.material.officeSeats.filter((seat) => seat.officeId === council.id && seat.status === "held" && seat.holderCharacterId !== null);
    const found = seated
      .map((seat) => world.characters.find((character) => character.id === seat.holderCharacterId && character.alive))
      .filter((man): man is Character => man !== undefined && !censors.some((censor2) => censor2.id === man.id))
      .map((man) => ({ man, reading: unworthinessOf(world, man, day) }))
      .filter(({ man, reading }) => reading.score >= bar && (man.id !== input.playerCharacterId || reading.grave))
      .sort((a, b) => b.reading.score - a.reading.score || a.man.id.localeCompare(b.man.id))
      .slice(0, MOST_STRUCK);
    // Those whose old mark is lifted and who are not struck again are let back with the other men who held a magistracy.
    const struck = new Set(found.map(({ man }) => man.id));
    for (const { man, reading } of found) {
      world = vacateOfficeOf(world, man.id, council.id, "removal", day);
      world = shiftStanding(world, man.id, NOTA_STANDING_BPS, "scandal");
      world = {
        ...world,
        genericEntities: [...world.genericEntities, GenericEntitySchema.parse({
          id: `nota-${polity.id}-${man.id}-${day}`.slice(0, 100), kind: NOTA_KIND, label: `The censors' mark against ${man.name}`.slice(0, 120), ownerRef: { kind: "polity", id: polity.id },
          attributes: { characterId: man.id, atStep: day, why: reading.reasons.join("; ").slice(0, 200), by: censor.id }, createdAtStep: day,
        })],
      };
    }
    const before = world.material.officeSeats.filter((seat) => seat.officeId === council.id && seat.status === "held").length;
    const enrolled: FactProposalDraft[] = [];
    world = enrolFormerMagistrates(world, every, day, enrolled, () => `lectio_${polity.id}_${enrolled.length}`.slice(0, 60));
    const taken = world.material.officeSeats.filter((seat) => seat.officeId === council.id && seat.status === "held").length - before;
    const letBack = [...lifted].filter((id) => !struck.has(id) && world.material.officeSeats.some((seat) => seat.officeId === council.id && seat.holderCharacterId === id && seat.status === "held")).length;

    const names = found.slice(0, 3).map(({ man }) => man.name);
    const why = found.slice(0, 1).map(({ reading }) => reading.reasons[0]).join("");
    const who = censors.length > 1 ? `${censor.name} and ${censors.find((man) => man.id !== censor.id)!.name}, the censors,` : `${censor.name}, the censor,`;
    const summary = found.length === 0
      ? `${who} read the roll of the ${council.label.toLowerCase()}s and struck nobody from it${taken > 0 ? `; ${taken} who had held a magistracy were enrolled` : ""}${letBack > 0 ? `, and ${letBack} whom the last censors had marked were let back` : ""}.`
      : `${who} read the roll of the ${council.label.toLowerCase()}s: ${found.length} struck from it, ${names.join(", ")}${found.length > names.length ? " and others" : ""} among them (${why})${taken > 0 ? `; ${taken} who had held a magistracy were enrolled` : ""}.`;
    world = {
      ...world,
      statecraft: { ...world.statecraft, log: [...world.statecraft.log, {
        day, polityId: polity.id, actorCharacterId: censor.id, act: "magistrate" as const, targetPolityId: null,
        why: `lectio: the roll read, ${found.length} struck, ${taken} enrolled, ${letBack} let back`.slice(0, 400),
      }].slice(-STATECRAFT_LOG_MAX) },
    };
    facts.push(fact({
      localId: `lectio_${polity.id}_${Math.floor(day / MONTH)}`.slice(0, 60), kind: "lectio", summary: summary.slice(0, 400), visibility: "polity", discoveryState: "polity", knowableInDays: 0,
      significance: found.length > 0 ? 50 : 30, affectedRefs: [{ kind: "polity", id: polity.id }, { kind: "character", id: censor.id }, ...found.slice(0, 3).map(({ man }) => ({ kind: "character" as const, id: man.id }))],
    }));
  }
  return { world, facts };
}
