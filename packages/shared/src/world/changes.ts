import type { WorldState } from "./world-state";
import type { Office } from "../characters/character";
import { labelFromCategoryId } from "../warfare/troop-categories";

/**
 * What actually changed on the map, by comparing two worlds.
 *
 * The Chronicle used to be prose and nothing else. A passage could say the
 * legions marched north and a reader had no way to learn that two provinces
 * had changed hands, an army of nine thousand had ceased to exist, and a
 * commander was dead -- unless the historian happened to mention it, which is
 * exactly the thing a historian is bad at being reliable about.
 *
 * So the record carries a change list beside the prose. It is derived from the
 * world rather than from the deltas that moved it, for two reasons: there are
 * twenty-nine delta arms and this would otherwise be twenty-nine cases that
 * drift apart, and a change is true whether or not the delta that caused it
 * was the one anybody thought it was.
 *
 * Nothing here decides what the *player* may see. A change reaches an entry
 * only when that entry's own visible facts name the thing that changed, which
 * is `chronicle.ts`'s business -- this function may freely compare the whole
 * world, because its output is filtered before anybody reads it.
 *
 * What it does say is *why*, where the world kept the reason. Naming alone
 * was not enough: the treasury is Rome's, so every entry naming Rome carried
 * the month's taxes -- "treasury up 1,234" beside "Rome creates the office of
 * admiral" -- and the wounded walking back into camp were "Syracusan army up
 * 361" on a siege entry. Money moves by transactions and men by personnel
 * events, and both carry their cause; a change whose movement is only the
 * world's routine is marked so, and told on no entry at all.
 */

export type WorldChangeKind = "province" | "force" | "character" | "polity" | "account";

/** The kinds a reader sees on the map. The rest are said in the entry, not drawn. */
export const MAP_CHANGE_KINDS: ReadonlySet<WorldChangeKind> = new Set(["province", "force", "polity"]);

export interface WorldChange {
  readonly kind: WorldChangeKind;
  /** The entity that changed, so an entry can claim it by subject. */
  readonly id: string;
  /**
   * Others whose naming also claims it: a purse is claimed by its owner, a
   * promise by both parties. An entry whose facts name none of these, nor
   * `id`, never shows it.
   */
  readonly claimedBy?: readonly string[] | undefined;
  /** What it is called, as a reader would name it: "Legion II", "Vatluna". */
  readonly label: string;
  /** What happened to it, in a few words: "passed to Rome", "raised in Latium". */
  readonly detail: string;
  /**
   * What moved it, where the world recorded that: the handles its transactions
   * and personnel events name -- a project, a battle, a force, a procedure --
   * and the day each moved. Absent when nothing recorded a cause, which is a
   * movement the model's own deltas made directly.
   */
  readonly causes?: readonly WorldChangeCause[] | undefined;
  /**
   * Nothing but the world's own routine: rents and taxes coming in, upkeep and
   * pay going out, the wounded back on their feet. True on the record, and
   * nobody's deed, so no entry claims it.
   */
  readonly routine?: boolean | undefined;
}

export interface WorldChangeCause {
  readonly id: string;
  readonly day: number;
}

/** Money that moves because the calendar turned, not because anybody did anything. */
const ROUTINE_MONEY_CAUSES: ReadonlySet<string> = new Set(["scheduled_income", "obligation", "department"]);
const ROUTINE_MONEY_KINDS: ReadonlySet<string> = new Set(["income", "tax", "upkeep", "salary"]);

/** Below this share of what was there, and this many coins, a purse has not visibly changed. */
const MONEY_NOTICE_SHARE = 0.05;
const MONEY_NOTICE = 50;
/** A man's standing moves by this much before anybody remarks on it. */
const STANDING_NOTICE_BPS = 500;

/** Below this many men lost or gained, an army has not visibly changed size. */
const STRENGTH_NOTICE = 250;

const strengthOf = (force: WorldState["material"]["forces"][number]): number =>
  force.personnel.reduce((sum, category) => sum + category.fit, 0);

const money = (amount: number): string => Math.round(amount).toLocaleString("en-GB");
const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);

const round = (men: number): string => (men >= 1_000 ? `${Math.round(men / 100) / 10}k` : String(men));

export function diffWorlds(before: WorldState, after: WorldState, offices: readonly Office[] = []): WorldChange[] {
  const changes: WorldChange[] = [];
  // An office by what it is called, never by its key: "takes up rome:admiral"
  // was the engine's bookkeeping printed under a Roman appointment (R63).
  const officeLabel = (id: string): string =>
    [...after.offices, ...offices].find((office) => office.id === id)?.label ?? labelFromCategoryId(id.slice(id.indexOf(":") + 1));

  const polityName = (id: string | null): string => {
    if (id === null) return "no one";
    return after.map.polities.find((polity) => polity.id === id)?.name
      ?? before.map.polities.find((polity) => polity.id === id)?.name
      ?? id;
  };
  const provinceName = (id: string): string =>
    after.map.provinces.find((province) => province.id === id)?.name
    ?? before.map.provinces.find((province) => province.id === id)?.name
    ?? id;

  // ── Provinces changing hands ─────────────────────────────────────────────
  const provincesBefore = new Map(before.map.provinces.map((province) => [province.id, province]));
  for (const province of after.map.provinces) {
    const was = provincesBefore.get(province.id);
    if (was === undefined) {
      // A place or a person the record had not held before is bookkeeping, not
      // news: "Aristodemus enters the record" stood as the one change under a
      // ceasefire offer (C08). What they do is told; that they were written
      // down is not.
      changes.push({ kind: "province", id: province.id, label: province.name, detail: `enters the record under ${polityName(province.controllerPolityId)}`, routine: true });
      continue;
    }
    if (was.controllerPolityId === province.controllerPolityId) continue;
    changes.push({
      kind: "province",
      id: province.id,
      label: province.name,
      detail: was.controllerPolityId === null
        ? `comes under ${polityName(province.controllerPolityId)}`
        : `passes from ${polityName(was.controllerPolityId)} to ${polityName(province.controllerPolityId)}`,
    });
  }

  // ── Armies raised, lost, moved, or bled ──────────────────────────────────
  const forcesBefore = new Map(before.material.forces.map((force) => [force.id, force]));
  const forcesAfter = new Map(after.material.forces.map((force) => [force.id, force]));
  /**
   * Why an army's numbers moved: the events in its history since `before`.
   * Men back from their wounds are the routine; the rest -- the dead, the
   * deserters, men marched in from another army -- are somebody's doing.
   */
  const whyMen = (was: WorldState["material"]["forces"][number], force: WorldState["material"]["forces"][number], gained: number): Pick<WorldChange, "causes" | "routine"> => {
    const old = new Set(was.history.map((event) => event.id));
    const events = force.history.filter((event) => !old.has(event.id));
    if (events.length === 0) return {};
    const mended = events.filter((event) => event.kind === "recovery").reduce((sum, event) => sum + event.count, 0);
    const causes = events.filter((event) => event.kind !== "recovery").map((event) => ({ id: event.causeId, day: event.atStep }));
    return { causes, routine: Math.abs(gained - mended) < STRENGTH_NOTICE };
  };
  for (const force of after.material.forces) {
    const was = forcesBefore.get(force.id);
    if (was === undefined) {
      changes.push({
        kind: "force",
        id: force.id,
        label: force.name,
        detail: `raised under ${polityName(force.polityId)} at ${provinceName(force.locationId)}, ${round(strengthOf(force))} men`,
      });
      continue;
    }
    if (was.locationId !== force.locationId) {
      changes.push({ kind: "force", id: force.id, label: force.name, detail: `moves from ${provinceName(was.locationId)} to ${provinceName(force.locationId)}` });
    }
    const lost = strengthOf(was) - strengthOf(force);
    if (Math.abs(lost) >= STRENGTH_NOTICE) {
      changes.push({
        kind: "force",
        id: force.id,
        label: force.name,
        detail: lost > 0 ? `down ${round(lost)} to ${round(strengthOf(force))} men` : `up ${round(-lost)} to ${round(strengthOf(force))} men`,
        ...whyMen(was, force, -lost),
      });
    }
    // Reinforcement is an order for more men before it is more men. A garrison
    // strengthened by three hundred moved only its authorized strength, so the
    // entry that announced the reinforcement carried no change at all -- the
    // one row a reader would actually have wanted from it.
    // Men lost in the field lower the establishment too; that is the same
    // loss, and "down 811 to 9.2k" followed by "cut to 9.7k" read as two.
    const authorized = force.authorizedStrength - was.authorizedStrength;
    // Likewise men raised raise the establishment: "up 2k to 9.1k men" and
    // "called up to 9.1k men, 1.1k more than before" were one levy told twice,
    // with two different sums. It is said only when it reaches past the men
    // actually standing.
    const raisedToIt = authorized > 0 && lost < 0 && force.authorizedStrength <= strengthOf(force);
    if (Math.abs(authorized) >= STRENGTH_NOTICE && !(authorized < 0 && lost > 0) && !raisedToIt) {
      changes.push({
        kind: "force",
        id: force.id,
        label: force.name,
        detail: authorized > 0
          ? `called up to ${round(force.authorizedStrength)} men, ${round(authorized)} more than before`
          : `cut to ${round(force.authorizedStrength)} men`,
      });
    }
    if (was.polityId !== force.polityId) {
      changes.push({ kind: "force", id: force.id, label: force.name, detail: `now answers to ${polityName(force.polityId)}` });
    }
  }
  for (const force of before.material.forces) {
    if (forcesAfter.has(force.id)) continue;
    changes.push({ kind: "force", id: force.id, label: force.name, detail: `destroyed or dispersed at ${provinceName(force.locationId)}` });
  }

  // ── People who arrived or died ───────────────────────────────────────────
  const charactersBefore = new Map(before.characters.map((character) => [character.id, character]));
  for (const character of after.characters) {
    const was = charactersBefore.get(character.id);
    if (was === undefined) {
      changes.push({ kind: "character", id: character.id, label: character.name, detail: `enters the record under ${polityName(character.polityId)}`, routine: true });
      continue;
    }
    if (was.alive && !character.alive) changes.push({ kind: "character", id: character.id, label: character.name, detail: "dies" });
    if (was.officeId !== character.officeId && character.officeId !== null) {
      changes.push({ kind: "character", id: character.id, label: character.name, detail: `takes up the office of ${officeLabel(character.officeId)}` });
    }
  }

  // ── Promises kept and broken ─────────────────────────────────────────────
  // A man's word is a public thing once it is kept or broken: what he
  // promised and whether he did it is what people remember of him.
  const personName = (id: string): string =>
    after.characters.find((character) => character.id === id)?.name
    ?? before.characters.find((character) => character.id === id)?.name
    ?? "someone";
  const commitmentsBefore = new Map(before.commitments.map((commitment) => [commitment.id, commitment]));
  for (const commitment of after.commitments) {
    const was = commitmentsBefore.get(commitment.id);
    if (was === undefined || was.status === commitment.status) continue;
    const kept = commitment.status === "fulfilled";
    const broken = commitment.status === "broken" || commitment.status === "failed";
    if (!kept && !broken) continue;
    changes.push({
      kind: "character",
      id: commitment.promisorCharacterId,
      claimedBy: [commitment.beneficiaryCharacterId],
      label: personName(commitment.promisorCharacterId),
      detail: `${kept ? "kept" : "broke"} a promise to ${personName(commitment.beneficiaryCharacterId)}: ${lowerFirst(commitment.description)}`,
    });
  }

  // ── Standing that rose or fell ───────────────────────────────────────────
  for (const character of after.characters) {
    const was = charactersBefore.get(character.id);
    if (was === undefined || !character.alive) continue;
    const moved = character.prestigeBps - was.prestigeBps;
    if (Math.abs(moved) < STANDING_NOTICE_BPS) continue;
    changes.push({ kind: "character", id: character.id, label: character.name, detail: moved > 0 ? "stands higher than before" : "stands lower than before" });
  }

  // ── Money that moved ─────────────────────────────────────────────────────
  // Claimed by the owner, and shown only to someone who may open the
  // account (the Chronicle's reader filters it again, by station).
  const currency = after.material.currency.name;
  const ownerName = (owner: WorldState["material"]["accounts"][number]["owner"]): string => {
    switch (owner.kind) {
      case "character": return `${personName(owner.id)}'s purse`;
      case "polity": return `${polityName(owner.id)}'s treasury`;
      case "force": return `${after.material.forces.find((force) => force.id === owner.id)?.name ?? before.material.forces.find((force) => force.id === owner.id)?.name ?? "An army"}'s chest`;
      default: return "A fund";
    }
  };
  const accountsBefore = new Map(before.material.accounts.map((account) => [account.id, account]));
  // What the ledger shows moving since `before`, by account: the routine share
  // and the rest, each with its cause.
  const recorded = new Set(before.material.transactions.map((transaction) => transaction.id));
  const flows = new Map<string, { routine: number; causes: WorldChangeCause[] }>();
  for (const transaction of after.material.transactions) {
    if (recorded.has(transaction.id)) continue;
    const routine = ROUTINE_MONEY_CAUSES.has(transaction.cause.kind) || ROUTINE_MONEY_KINDS.has(transaction.kind);
    const legs: [string | undefined, number][] = [[transaction.sourceAccountId, -transaction.amount], [transaction.destinationAccountId, transaction.amount]];
    for (const [accountId, signed] of legs) {
      if (accountId === undefined) continue;
      const flow = flows.get(accountId) ?? { routine: 0, causes: [] };
      if (routine) flow.routine += signed;
      else flow.causes.push({ id: transaction.cause.id, day: transaction.atStep });
      flows.set(accountId, flow);
    }
  }
  for (const account of after.material.accounts) {
    const was = accountsBefore.get(account.id);
    if (was === undefined) continue;
    const moved = account.balance - was.balance;
    const notice = Math.max(MONEY_NOTICE, Math.abs(was.balance) * MONEY_NOTICE_SHARE);
    if (Math.abs(moved) < notice) continue;
    const flow = flows.get(account.id);
    changes.push({
      kind: "account",
      id: account.id,
      claimedBy: [account.owner.id],
      label: ownerName(account.owner),
      detail: `${moved > 0 ? "up" : "down"} ${money(Math.abs(moved))} to ${money(account.balance)} ${currency}`,
      // What is left once the routine is taken out is what somebody did; a
      // purse whose whole movement was its rents is nobody's news.
      ...(flow === undefined ? {} : { causes: flow.causes, routine: Math.abs(moved - flow.routine) < notice }),
    });
  }

  // ── What the ledger of provinces adds up to, per power ───────────────────
  const held = (world: WorldState, polityId: string): number => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;
  for (const polity of after.map.polities) {
    const gained = held(after, polity.id) - held(before, polity.id);
    if (gained === 0) continue;
    changes.push({
      kind: "polity",
      id: polity.id,
      label: polity.name,
      detail: gained > 0 ? `holds ${gained} province${gained === 1 ? "" : "s"} more` : `holds ${-gained} province${gained === -1 ? "" : "s"} fewer`,
    });
  }

  return changes;
}
