import {
  allOffices,
  boundedId,
  createPressure,
  isNavalForce,
  type BlocInterest,
  type Character,
  type FactProposalDraft,
  type Franchise,
  type GovernmentInstitution,
  type Office,
  type PoliticalGroup,
  type ScenarioWarfareRules,
  type VotingBloc,
  type WorldState,
} from "@chronica/shared";
import { chambersOf, polityPhrase, rulerOf, rulerOfficeOf, templateFor, type GovernmentRules } from "./constitutions";
import type { IdFactory } from "./ports";

/**
 * The world's groups, made by the world.
 *
 * A chamber's blocs were written once and never moved: the Senate had a
 * Patrician bloc and a Popular bloc in 270 and would have the same two, of the
 * same size, in 200. Nobody got into debt as a class, no army came home to
 * want land, no general's legion became his own. Those are most of what the
 * politics of a republic was actually made of.
 *
 * So once a month the world is read for them. Every group is one loop: a
 * measure off the world as it stands, a threshold to appear at and a lower
 * one to dissolve at, so a group near the line does not flicker. An active
 * group takes seats in whichever of its power's chambers admit it -- a bloc
 * that follows its leader, or wants what its interest wants -- and a strong
 * one presses on the ruler. When the measure falls away, the group goes, and
 * its seats with it.
 */

/** How often the world is read for its groups. */
export const SOCIETY_REVIEW_DAYS = 30;
/** Strength a group appears at, and the lower strength it dissolves at. */
export const GROUP_APPEARS_BPS = 3_000;
export const GROUP_DISSOLVES_BPS = 1_500;
/** A general who has held his army this long has made it his. */
export const OWN_ARMY_DAYS = 730;
/** An office nobody has held for this long lapses. */
export const OFFICE_LAPSES_DAYS = 1_095;
/** How long men sent home are remembered as a class. */
const VETERAN_MEMORY_DAYS = 1_095;
/** How far back two acts must fall to make a custom. */
const PRECEDENT_WINDOW_DAYS = 3_650;
/** A deposed party's claim fades each month nobody restores it. */
const DEPOSED_FADE_BPS = 250;
/** Strength past which an interest group presses on its ruler. */
const CLAMOUR_BPS = 6_500;

interface Candidate {
  readonly key: string;
  readonly type: PoliticalGroup["type"];
  readonly name: string;
  readonly polityId: string;
  readonly leaderId: string | null;
  readonly interest: BlocInterest;
  readonly strengthBps: number;
  readonly memberIds: readonly string[];
  readonly platform: readonly string[];
}

const clampBps = (value: number): number => Math.max(0, Math.min(10_000, Math.round(value)));
/** "the Roman Republic", "Carthage": a power as a sentence names it. */
const polityName = (world: WorldState, polityId: string): string => polityPhrase(world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId);
const livingOf = (world: WorldState, polityId: string): Character[] => world.characters.filter((character) => character.alive && character.polityId === polityId);
const accountOwner = (world: WorldState, accountId: string | undefined): { kind: string; id: string } | null =>
  accountId === undefined ? null : world.material.accounts.find((account) => account.id === accountId)?.owner ?? null;
const menIn = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, category) => sum + category.fit, 0);

// ── The measures ────────────────────────────────────────────────────────────

/** Men who keep declaring as a leading man does, and never against him, are his faction. */
function factions(world: WorldState, toDay: number): Candidate[] {
  const recent = new Set(world.material.politicalProcedures.filter((procedure) => procedure.openedAtStep >= toDay - 730).map((procedure) => procedure.id));
  const latest = new Map<string, "support" | "oppose">();
  for (const position of world.material.supportPositions) {
    if (position.supporterKind !== "character" || !recent.has(position.procedureId)) continue;
    if (position.position === "support" || position.position === "oppose") latest.set(`${position.procedureId}|${position.supporterId}`, position.position);
    else latest.delete(`${position.procedureId}|${position.supporterId}`);
  }
  const byProcedure = new Map<string, Map<string, "support" | "oppose">>();
  for (const [key, position] of latest) {
    const [procedureId, characterId] = key.split("|") as [string, string];
    byProcedure.set(procedureId, (byProcedure.get(procedureId) ?? new Map<string, "support" | "oppose">()).set(characterId, position));
  }
  const out: Candidate[] = [];
  for (const leader of world.characters.filter((character) => character.alive && character.prestigeBps >= 6_000 && character.polityId !== null)) {
    const agreed = new Map<string, number>();
    const crossed = new Set<string>();
    for (const said of byProcedure.values()) {
      const his = said.get(leader.id);
      if (his === undefined) continue;
      for (const [other, position] of said) {
        if (other === leader.id) continue;
        if (position === his) agreed.set(other, (agreed.get(other) ?? 0) + 1);
        else crossed.add(other);
      }
    }
    const followers = [...agreed.entries()]
      .filter(([id, count]) => count >= 2 && !crossed.has(id) && world.characters.some((character) => character.id === id && character.alive && character.polityId === leader.polityId && character.prestigeBps < leader.prestigeBps))
      .map(([id]) => id);
    if (followers.length < 2) continue;
    out.push({
      key: `faction:${leader.id}`, type: "faction", name: `The friends of ${leader.name}`, polityId: leader.polityId!, leaderId: leader.id, interest: "faction",
      strengthBps: clampBps(followers.length * 2_000 + leader.prestigeBps / 4), memberIds: followers, platform: [`Whatever ${leader.name} wants`],
    });
  }
  return out;
}

/** A man others pay dues to, or who holds many estates and their tenants, has clients. */
function clienteles(world: WorldState): Candidate[] {
  const out: Candidate[] = [];
  for (const patron of world.characters.filter((character) => character.alive && character.polityId !== null)) {
    const purse = world.material.accounts.find((account) => account.owner.kind === "character" && account.owner.id === patron.id);
    const clients = new Set<string>();
    if (purse !== undefined) {
      for (const obligation of world.material.obligations) {
        if (obligation.recipientAccountId !== purse.id) continue;
        const payer = accountOwner(world, obligation.payerAccountId);
        if (payer?.kind === "character" && payer.id !== patron.id) clients.add(payer.id);
      }
    }
    const estates = world.material.holdings.filter((holding) => holding.legalHolderCharacterId === patron.id).length;
    const strength = clampBps(clients.size * 1_500 + estates * 800);
    if (strength < GROUP_DISSOLVES_BPS) continue;
    out.push({
      key: `clients:${patron.id}`, type: "clientele", name: `The clients of ${patron.name}`, polityId: patron.polityId!, leaderId: patron.id, interest: "clients",
      strengthBps: strength, memberIds: [...clients], platform: [`Vote as ${patron.name} votes`],
    });
  }
  return out;
}

/** How hard a power's provinces are pressed: war damage and hunger, averaged. */
function distressOf(world: WorldState, polityId: string): number {
  const provinces = world.map.provinces.filter((province) => province.controllerPolityId === polityId);
  const material = world.material.provinceMaterial.filter((entry) => provinces.some((province) => province.id === entry.provinceId));
  if (material.length === 0) return 0;
  return material.reduce((sum, entry) => sum + (entry.warDamageBps + (10_000 - entry.foodSecurityBps)) / 2, 0) / material.length;
}

/** A power's debtors, named and nameless: men owing money, and a country ruined by war and hunger. */
function debtors(world: WorldState): Candidate[] {
  const out: Candidate[] = [];
  for (const polity of world.map.polities) {
    const named = world.material.loans.filter((loan) => loan.status === "active" && loan.outstanding > 0).flatMap((loan) => {
      const owner = accountOwner(world, loan.borrowerAccountId);
      const character = owner?.kind === "character" ? world.characters.find((candidate) => candidate.id === owner.id && candidate.alive && candidate.polityId === polity.id) : undefined;
      return character === undefined ? [] : [character];
    });
    const strength = clampBps(new Set(named.map((character) => character.id)).size * 1_500 + Math.max(0, distressOf(world, polity.id) - 1_500) * 1.5);
    if (strength < GROUP_DISSOLVES_BPS) continue;
    const leader = [...named].sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
    out.push({
      key: `debtors:${polity.id}`, type: "debtors", name: `The debtors of ${polityPhrase(polity.name)}`, polityId: polity.id, leaderId: leader !== undefined && leader.prestigeBps >= 4_000 ? leader.id : null, interest: "debtors",
      strengthBps: strength, memberIds: [...new Set(named.map((character) => character.id))], platform: ["Relief of debts", "Land for the ruined"],
    });
  }
  return out;
}

/** Men sent home from the armies in the last three years, who want land for what they did. */
function veterans(world: WorldState, toDay: number): Candidate[] {
  const out: Candidate[] = [];
  for (const polity of world.map.polities) {
    const men = world.society.discharged.filter((entry) => entry.polityId === polity.id && entry.atStep >= toDay - VETERAN_MEMORY_DAYS).reduce((sum, entry) => sum + entry.count, 0);
    const strength = clampBps(men * 2);
    if (strength < GROUP_DISSOLVES_BPS) continue;
    out.push({
      key: `veterans:${polity.id}`, type: "veterans", name: `The veterans of ${polityPhrase(polity.name)}`, polityId: polity.id, leaderId: null, interest: "veterans",
      strengthBps: strength, memberIds: [], platform: ["Land for the men who served", "Their pay in arrears"],
    });
  }
  return out;
}

/** Men with money in trade, and the ports that carry it. */
function merchants(world: WorldState): Candidate[] {
  const out: Candidate[] = [];
  for (const polity of world.map.polities) {
    const owners = world.material.ventures.filter((venture) => venture.status === "running").flatMap((venture) => {
      const owner = world.characters.find((character) => character.id === venture.ownerCharacterId && character.alive && character.polityId === polity.id);
      return owner === undefined ? [] : [owner];
    });
    const ports = world.map.provinces.flatMap((province) => province.settlements).filter((settlement) => settlement.kind === "port" && settlement.controllerPolityId === polity.id).length;
    const strength = clampBps(owners.length * 2_000 + ports * 400);
    if (strength < GROUP_DISSOLVES_BPS) continue;
    const counts = new Map<string, number>();
    for (const owner of owners) counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
    const leader = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    out.push({
      key: `merchants:${polity.id}`, type: "merchant_interest", name: `The merchants of ${polityPhrase(polity.name)}`, polityId: polity.id, leaderId: leader, interest: "merchants",
      strengthBps: strength, memberIds: [...counts.keys()], platform: ["Open seas and open markets", "No war that closes a port"],
    });
  }
  return out;
}

/** Men who hold land. */
function landholders(world: WorldState): Candidate[] {
  const out: Candidate[] = [];
  for (const polity of world.map.polities) {
    const holders = world.material.holdings.flatMap((holding) => {
      const holder = world.characters.find((character) => character.id === holding.legalHolderCharacterId && character.alive && character.polityId === polity.id);
      return holder === undefined ? [] : [holder];
    });
    const strength = clampBps(holders.length * 1_200);
    if (strength < GROUP_DISSOLVES_BPS) continue;
    const leader = [...holders].sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
    out.push({
      key: `landed:${polity.id}`, type: "landholder_interest", name: `The landholders of ${polityPhrase(polity.name)}`, polityId: polity.id, leaderId: leader?.id ?? null, interest: "landed",
      strengthBps: strength, memberIds: [...new Set(holders.map((holder) => holder.id))], platform: ["Low taxes on land", "No land for the landless"],
    });
  }
  return out;
}

/** A people taken by conquest, until they are reconciled to it. */
function conquered(world: WorldState): Candidate[] {
  const native = new Map(world.society.nativeControllers.map((entry) => [entry.provinceId, entry.polityId]));
  const byPair = new Map<string, { provinces: string[]; ruler: string; people: string }>();
  for (const province of world.map.provinces) {
    const ruler = province.controllerPolityId;
    const people = native.get(province.id);
    if (ruler === null || people === undefined || people === ruler) continue;
    const key = `${ruler}|${people}`;
    byPair.set(key, { provinces: [...(byPair.get(key)?.provinces ?? []), province.id], ruler, people });
  }
  const out: Candidate[] = [];
  for (const { provinces, ruler, people } of byPair.values()) {
    const stability = world.material.provinceMaterial.filter((entry) => provinces.includes(entry.provinceId)).map((entry) => entry.stabilityBps);
    const average = stability.length === 0 ? 5_000 : stability.reduce((sum, value) => sum + value, 0) / stability.length;
    const strength = clampBps(provinces.length * 2_000 + Math.max(0, 7_000 - average));
    if (strength < GROUP_DISSOLVES_BPS) continue;
    out.push({
      key: `conquered:${ruler}:${people}`, type: "conquered_people", name: `The conquered of ${polityName(world, people)}`, polityId: ruler, leaderId: null, interest: "conquered",
      strengthBps: strength, memberIds: livingOf(world, ruler).filter((character) => provinces.includes(character.locationProvinceId ?? "")).map((character) => character.id).slice(0, 12),
      platform: [`Their own laws again`, `Freedom from ${polityName(world, ruler)}`],
    });
  }
  return out;
}

/** An army under one man for two years is his, more than its country's. */
function ownArmies(world: WorldState, toDay: number): Candidate[] {
  const out: Candidate[] = [];
  for (const force of world.material.forces) {
    if (force.outlaw === true || menIn(force) < 500) continue;
    const since = world.society.commandSince.find((entry) => entry.forceId === force.id && entry.commanderCharacterId === force.commanderCharacterId)?.sinceStep;
    if (since === undefined || toDay - since < OWN_ARMY_DAYS) continue;
    const commander = world.characters.find((character) => character.id === force.commanderCharacterId && character.alive);
    if (commander === undefined) continue;
    const strength = clampBps(3_000 + ((toDay - since - OWN_ARMY_DAYS) / 365) * 1_500 + (force.moraleBps - 5_000) / 2);
    out.push({
      key: `army:${force.id}:${commander.id}`, type: "military_command", name: `${force.name}, loyal to ${commander.name}`.slice(0, 120), polityId: force.polityId, leaderId: commander.id, interest: "soldiers",
      strengthBps: strength, memberIds: [...force.memberCharacterIds], platform: [`Follow ${commander.name}`],
    });
  }
  return out;
}

/** A faith preached into a power's provinces, strong enough to be a party. */
function cults(world: WorldState): Candidate[] {
  const out: Candidate[] = [];
  for (const polity of world.map.polities) {
    const provinces = new Set(world.map.provinces.filter((province) => province.controllerPolityId === polity.id).map((province) => province.id));
    for (const faith of world.faiths) {
      const shares = world.faithAdherence.filter((entry) => entry.faithId === faith.id && provinces.has(entry.provinceId) && entry.shareBps >= 1_000);
      if (shares.length === 0) continue;
      const strength = clampBps(Math.max(...shares.map((entry) => entry.shareBps)) * 1.5 + shares.length * 500);
      if (strength < GROUP_DISSOLVES_BPS) continue;
      const founder = faith.founderCharacterId === null ? undefined : world.characters.find((character) => character.id === faith.founderCharacterId && character.alive && character.polityId === polity.id);
      out.push({
        key: `cult:${polity.id}:${faith.id}`, type: "cult", name: `The followers of ${faith.name} in ${polityPhrase(polity.name)}`.slice(0, 120), polityId: polity.id, leaderId: founder?.id ?? null, interest: "priests",
        strengthBps: strength, memberIds: [], platform: [`Honour for ${faith.name}`],
      });
    }
  }
  return out;
}

// ── Memory ──────────────────────────────────────────────────────────────────

/** What the world has to remember from this month to read the next one. */
function remember(world: WorldState, toDay: number): WorldState {
  const memory = world.society;
  const native = new Map(memory.nativeControllers.map((entry) => [entry.provinceId, entry.polityId]));
  for (const province of world.map.provinces) {
    if (!native.has(province.id) && province.controllerPolityId !== null) native.set(province.id, province.controllerPolityId);
  }
  const commandSince = world.material.forces.map((force) => {
    const known = memory.commandSince.find((entry) => entry.forceId === force.id);
    return known !== undefined && known.commanderCharacterId === force.commanderCharacterId
      ? known
      : { forceId: force.id, commanderCharacterId: force.commanderCharacterId, sinceStep: known === undefined && memory.lastReviewStep === null ? Math.max(0, toDay - 365) : toDay };
  });
  // Men under arms who fell and did not die, desert or go into captivity went home.
  const since = memory.lastReviewStep ?? toDay;
  const menUnderArms = world.map.polities.map((polity) => ({
    polityId: polity.id,
    count: world.material.forces.filter((force) => force.polityId === polity.id && force.outlaw !== true).reduce((sum, force) => sum + menIn(force), 0),
  }));
  const discharged = [...memory.discharged.filter((entry) => entry.atStep >= toDay - VETERAN_MEMORY_DAYS)];
  if (memory.lastReviewStep !== null) {
    for (const now of menUnderArms) {
      const before = memory.menUnderArms.find((entry) => entry.polityId === now.polityId)?.count ?? now.count;
      const lost = world.material.forces
        .filter((force) => force.polityId === now.polityId)
        .flatMap((force) => force.history)
        .filter((event) => event.atStep > since && (event.kind === "battle_death" || event.kind === "attrition_death" || event.kind === "desertion" || event.kind === "capture" || event.kind === "unavailable"))
        .reduce((sum, event) => sum + event.count, 0);
      const home = before - now.count - lost;
      if (home >= 100) discharged.push({ polityId: now.polityId, count: home, atStep: toDay });
    }
  }
  return {
    ...world,
    society: {
      ...memory,
      nativeControllers: [...native.entries()].map(([provinceId, polityId]) => ({ provinceId, polityId })),
      commandSince,
      menUnderArms,
      discharged: discharged.slice(-400),
    },
  };
}

// ── Groups, reconciled ──────────────────────────────────────────────────────

const GROUP_TYPE_IN_WORDS: Record<string, string> = {
  faction: "a faction", clientele: "a following of clients", debtors: "a party of debtors", veterans: "a party of veterans",
  merchant_interest: "a party of merchants", landholder_interest: "a party of landholders", conquered_people: "a conquered people with a grievance",
  military_command: "an army loyal to its general", cult: "a cult with a following", deposed_party: "a party of the fallen government",
};

/** Candidates made real: new groups appear, known ones are re-weighed, faded ones dissolve. */
function reconcile(world: WorldState, candidates: readonly Candidate[], toDay: number, facts: FactProposalDraft[]): WorldState {
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const groups = [...world.material.politicalGroups];
  const memberships = [...world.material.groupMemberships];
  const seen = new Set<string>();

  const leave = (groupId: string): void => {
    for (let index = 0; index < memberships.length; index += 1) {
      const membership = memberships[index]!;
      if (membership.groupId === groupId && membership.leftAtStep === null) memberships[index] = { ...membership, leftAtStep: toDay };
    }
  };
  const join = (group: PoliticalGroup, memberIds: readonly string[]): void => {
    const current = new Set(memberships.filter((membership) => membership.groupId === group.id && membership.leftAtStep === null).map((membership) => membership.characterId));
    const wanted = new Set([...(group.leaderCharacterId === null ? [] : [group.leaderCharacterId]), ...memberIds]);
    for (const id of wanted) {
      if (current.has(id)) continue;
      memberships.push({
        characterId: id, groupId: group.id, role: id === group.leaderCharacterId ? "leader" : "member", influenceBps: id === group.leaderCharacterId ? 8_000 : 3_000, loyaltyBps: 40,
        visibility: "public", joinedAtStep: toDay, leftAtStep: null, joinProvenanceEventId: null, leaveProvenanceEventId: null,
      });
    }
    for (let index = 0; index < memberships.length; index += 1) {
      const membership = memberships[index]!;
      if (membership.groupId === group.id && membership.leftAtStep === null && !wanted.has(membership.characterId)) memberships[index] = { ...membership, leftAtStep: toDay };
    }
  };

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    if (group.emergentKey == null || !group.active) continue;
    seen.add(group.emergentKey);
    // The fallen are not read off the world: they were made by their fall,
    // and they fade unless somebody gives them their state back.
    if (group.type === "deposed_party") {
      const leaderAlive = world.characters.some((character) => character.id === group.leaderCharacterId && character.alive);
      const faded = clampBps((group.strengthBps ?? 0) - DEPOSED_FADE_BPS);
      if (!leaderAlive || faded < GROUP_DISSOLVES_BPS) {
        groups[index] = { ...group, active: false, strengthBps: faded, endedAtStep: toDay };
        leave(group.id);
        facts.push(groupFact(world, groups[index]!, "dissolved"));
      } else groups[index] = { ...group, strengthBps: faded };
      continue;
    }
    const candidate = byKey.get(group.emergentKey);
    if (candidate === undefined || candidate.strengthBps < GROUP_DISSOLVES_BPS) {
      groups[index] = { ...group, active: false, strengthBps: candidate?.strengthBps ?? 0, endedAtStep: toDay };
      leave(group.id);
      facts.push(groupFact(world, groups[index]!, "dissolved"));
      continue;
    }
    groups[index] = { ...group, strengthBps: candidate.strengthBps, leaderCharacterId: candidate.leaderId, name: candidate.name, polityId: candidate.polityId };
    join(groups[index]!, candidate.memberIds);
  }
  for (const candidate of candidates) {
    if (seen.has(candidate.key) || candidate.strengthBps < GROUP_APPEARS_BPS) continue;
    const group: PoliticalGroup = {
      id: boundedId("group", candidate.key, toDay),
      name: candidate.name.slice(0, 120),
      polityId: candidate.polityId,
      type: candidate.type,
      leaderCharacterId: candidate.leaderId,
      platform: candidate.platform.map((line) => line.slice(0, 200)).slice(0, 12),
      resourceAccountId: null,
      publicReputationBps: 5_000,
      active: true,
      emergentKey: candidate.key,
      strengthBps: candidate.strengthBps,
      interest: candidate.interest,
      foundedAtStep: toDay,
      endedAtStep: null,
    };
    groups.push(group);
    join(group, candidate.memberIds);
    facts.push(groupFact(world, group, "appeared"));
  }
  return { ...world, material: { ...world.material, politicalGroups: groups, groupMemberships: memberships } };
}

function groupFact(world: WorldState, group: PoliticalGroup, what: "appeared" | "dissolved"): FactProposalDraft {
  const where = group.polityId === null ? "" : ` in ${polityName(world, group.polityId)}`;
  const leader = group.leaderCharacterId === null ? undefined : world.characters.find((character) => character.id === group.leaderCharacterId);
  return {
    localId: `group_${what}_${group.id}`.slice(0, 60),
    kind: what === "appeared" ? "group_formed" : "group_dissolved",
    summary: what === "appeared"
      ? `${group.name}: ${GROUP_TYPE_IN_WORDS[group.type] ?? "a new party"} has formed${where}${leader === undefined ? "" : `, around ${leader.name}`}.`
      : `${group.name} ${group.type === "deposed_party" ? "has given up its claim" : "is no longer a party to be reckoned with"}${where}.`,
    affectedRefs: [...(group.polityId === null ? [] : [{ kind: "polity" as const, id: group.polityId }]), ...(leader === undefined ? [] : [{ kind: "character" as const, id: leader.id }])],
    visibility: "public",
    discoveryState: "public",
    knowableInDays: 0,
    significance: group.type === "military_command" || group.type === "deposed_party" ? 50 : 35,
  };
}

// ── Seats in the chambers ───────────────────────────────────────────────────

/** Which groups a chamber's franchise lets sit. */
const ADMITS: Record<Franchise, ReadonlySet<PoliticalGroup["type"]>> = {
  council: new Set(["faction", "clientele", "merchant_interest", "landholder_interest", "deposed_party"]),
  citizens: new Set(["faction", "clientele", "debtors", "veterans", "merchant_interest", "landholder_interest", "cult", "deposed_party"]),
  soldiers: new Set(["military_command", "veterans", "faction"]),
  chiefs: new Set(["faction", "military_command", "deposed_party", "cult"]),
  cities: new Set(["faction", "merchant_interest"]),
  priests: new Set(["cult", "religious_body", "faction"]),
};

const REGION_MARK = "~region~";

/**
 * A chamber's blocs, brought in step with the world: its standing blocs as
 * they were, a bloc for every group its franchise admits, sized by the
 * group's strength, and -- for a gathering of chiefs or a league of cities --
 * a bloc for every province its power holds, sized by its people.
 */
function seatGroups(world: WorldState, chamber: GovernmentInstitution): GovernmentInstitution {
  if (chamber.franchise == null) return chamber;
  const standing = chamber.votingBlocs.filter((bloc) => bloc.groupId == null && !bloc.id.includes(REGION_MARK));
  const standingWeight = Math.max(20, standing.reduce((sum, bloc) => sum + bloc.weight, 0));
  const admits = ADMITS[chamber.franchise];
  const grouped: VotingBloc[] = world.material.politicalGroups
    .filter((group) => group.active && group.polityId === chamber.polityId && admits.has(group.type))
    .map((group) => {
      const existing = chamber.votingBlocs.find((bloc) => bloc.groupId === group.id);
      return {
        id: existing?.id ?? boundedId(chamber.id, "group", group.id),
        name: group.name.slice(0, 100),
        representedInterest: (group.platform[0] ?? group.name).slice(0, 100),
        weight: Math.max(1, Math.round((standingWeight * (group.strengthBps ?? 0)) / 25_000)),
        baseSupport: group.type === "deposed_party" || group.type === "conquered_people" ? -10 : 0,
        yesThreshold: 15,
        noThreshold: -15,
        causes: [],
        interests: group.interest == null ? [] : [group.interest],
        groupId: group.id,
      };
    });
  const regional: VotingBloc[] = [];
  if (chamber.franchise === "chiefs" || chamber.franchise === "cities") {
    const provinces = world.map.provinces.filter((province) => province.controllerPolityId === chamber.polityId);
    const people = (provinceId: string): number => world.material.provinceMaterial.find((entry) => entry.provinceId === provinceId)?.population ?? 1;
    const total = provinces.reduce((sum, province) => sum + people(province.id), 0) || 1;
    for (const province of provinces.slice(0, 12)) {
      regional.push({
        id: boundedId(`${chamber.id}${REGION_MARK}${province.id}`),
        name: (chamber.franchise === "chiefs" ? `The chiefs of ${province.name}` : `The delegates of ${province.name}`).slice(0, 100),
        representedInterest: `the people of ${province.name}`.slice(0, 100),
        weight: Math.max(1, Math.round((standingWeight * 2 * people(province.id)) / total)),
        baseSupport: 0,
        yesThreshold: 15,
        noThreshold: -15,
        causes: [],
        interests: ["regional"],
        groupId: null,
      });
    }
  }
  const votingBlocs = [...standing, ...grouped, ...regional];
  return { ...chamber, votingBlocs, totalVotingWeight: votingBlocs.reduce((sum, bloc) => sum + bloc.weight, 0) };
}

/** Every chamber re-seated, and the declared positions of blocs that no longer sit dropped with them. */
function seatAll(world: WorldState): WorldState {
  const institutions = world.material.institutions.map((chamber) => seatGroups(world, chamber));
  const blocIds = new Set(institutions.flatMap((chamber) => chamber.votingBlocs.map((bloc) => bloc.id)));
  const groupIds = new Set(world.material.politicalGroups.map((group) => group.id));
  return {
    ...world,
    material: {
      ...world.material,
      institutions,
      supportPositions: world.material.supportPositions.filter((position) => position.supporterKind !== "group" || blocIds.has(position.supporterId) || groupIds.has(position.supporterId)),
    },
  };
}

// ── Pressure on people ──────────────────────────────────────────────────────

/**
 * A strong party presses on its ruler: the debtors want relief, the veterans
 * land, the conquered their own laws. Once a season each, as a danger he has
 * to answer -- by giving it what it wants, buying off its leaders, or facing
 * it down.
 */
function clamour(world: WorldState, government: GovernmentRules, toDay: number): WorldState {
  let next = world;
  for (const group of world.material.politicalGroups) {
    if (!group.active || group.polityId === null || (group.strengthBps ?? 0) < CLAMOUR_BPS) continue;
    if (!["debtors", "veterans", "conquered_people", "merchant_interest", "cult", "deposed_party"].includes(group.type)) continue;
    const ruler = rulerOf(next, group.polityId, government);
    if (ruler === null) continue;
    const id = boundedId("clamour", group.id, Math.floor(toDay / 90));
    if (next.characterPressures.some((pressure) => pressure.id === id)) continue;
    const pressured = createPressure(next, {
      id,
      characterId: ruler.id,
      kind: "political_danger",
      intensity: Math.min(85, Math.round((group.strengthBps ?? 0) / 120)),
      label: `${group.name} [${group.id}] press${group.name.endsWith("s") ? "" : "es"} him: ${group.platform.slice(0, 2).join("; ")}`.slice(0, 200),
      sourceEventId: null,
      atStep: toDay,
      reviewInSteps: 14,
      expiresInSteps: 90,
      visibility: "polity",
    });
    next = { ...next, characters: [...pressured.characters], characterPressures: [...pressured.characterPressures] };
  }
  return next;
}

// ── Offices made by need, and lapsing ───────────────────────────────────────

/**
 * A power that has a fleet and nobody to command it names an admiral; one that
 * holds conquered provinces and nobody to govern them names governors. An
 * office nobody has held for three years lapses -- unless it has been made
 * twice, which makes it a standing office by custom.
 */
function officesByNeed(world: WorldState, government: GovernmentRules, warfare: ScenarioWarfareRules | undefined, toDay: number, facts: FactProposalDraft[]): WorldState {
  let next = world;
  const offices = (): readonly Office[] => allOffices(next, government.offices);
  const native = new Map(next.society.nativeControllers.map((entry) => [entry.provinceId, entry.polityId]));
  for (const polity of next.map.polities) {
    const ruleId = boundedId(polity.id, "by-need", "succession");
    const has = (pattern: RegExp): boolean => offices().some((office) => office.polityId === polity.id && office.successionRuleId !== "abolished" && pattern.test(office.label));
    const make = (key: string, label: string, seatCount: number, why: string): void => {
      const id = boundedId(polity.id, key);
      if (offices().some((office) => office.id === id && office.successionRuleId !== "abolished")) return;
      const office: Office = {
        id, label: label.slice(0, 120), polityId: polity.id,
        authorisedActionIds: ["social_events", "belief_set", "character_intent_set", "political_procedure_open", "political_support_set", "force_modify", "force_engage", "province_material_shift", "project_create"],
        sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null,
        successionRuleId: ruleId, eligibilityRequirementIds: next.material.eligibilityRequirements.some((requirement) => requirement.id === `req-${polity.id}-polity`) ? ["req-alive", `req-${polity.id}-polity`] : [],
        kind: "magistracy", rank: 2, ...(seatCount > 1 ? { seatCount } : {}),
      };
      next = {
        ...next,
        offices: [...next.offices.filter((candidate) => candidate.id !== id), office],
        successionRules: next.successionRules.some((rule) => rule.id === ruleId) ? next.successionRules : [...next.successionRules, { id: ruleId, label: "Named by the government", kind: "appointment", institutionId: null }],
      };
      facts.push({
        localId: `office_need_${id}`.slice(0, 60), kind: "office_created",
        summary: `${polityPhrase(polity.name).replace(/^the/u, "The")} has made the office of ${office.label}: ${why}.`,
        affectedRefs: [{ kind: "polity", id: polity.id }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 35,
      });
    };
    const ships = next.material.forces.filter((force) => force.polityId === polity.id && isNavalForce(force, warfare)).reduce((sum, force) => sum + menIn(force), 0);
    if (ships >= 20 && !has(/\b(fleet|fleets|navy|naval|admiral|nauarch)\b/iu)) make("admiral", `Admiral of the fleet of ${polityPhrase(polity.name)}`, 1, "it has ships and nobody to command them");
    const taken = next.map.provinces.filter((province) => province.controllerPolityId === polity.id && native.has(province.id) && native.get(province.id) !== polity.id).length;
    if (taken >= 2 && !has(/\b(governor|governors|satrap|prefect|proconsul)\b/iu)) make("governor", `Governor of the conquered lands of ${polityPhrase(polity.name)}`, Math.min(12, taken), "it holds conquered provinces and nobody to govern them");
  }

  // Idle offices: remembered from the month they fell idle, and lapsing after three years.
  const authored = new Set(government.offices.map((office) => office.id));
  const constitutional = new Set(next.constitutions.flatMap((constitution) => {
    const polity = next.map.polities.find((candidate) => candidate.id === constitution.polityId);
    return polity === undefined ? [] : templateFor(polity, constitution.form).offices.map((spec) => boundedId(polity.id, spec.key));
  }));
  const standingByCustom = new Set(next.genericEntities.filter((entity) => entity.kind === "custom" && entity.attributes?.["customKind"] === "emergency_office").map((entity) => String(entity.attributes?.["officeLabel"] ?? "").toLowerCase()));
  const idle = new Map(next.society.idleOffices.map((entry) => [entry.officeId, entry.sinceStep]));
  const idleNow: { officeId: string; sinceStep: number }[] = [];
  for (const office of next.offices) {
    if (authored.has(office.id) || constitutional.has(office.id) || office.successionRuleId === "abolished" || office.kind === "priesthood" || office.kind === "membership") continue;
    const held = next.material.officeSeats.some((seat) => seat.officeId === office.id && seat.status === "held");
    if (held) continue;
    const since = idle.get(office.id) ?? toDay;
    if (toDay - since < OFFICE_LAPSES_DAYS || standingByCustom.has(office.label.toLowerCase())) {
      idleNow.push({ officeId: office.id, sinceStep: since });
      continue;
    }
    next = {
      ...next,
      offices: next.offices.map((candidate) => (candidate.id === office.id ? { ...candidate, authorisedActionIds: [], successionRuleId: "abolished", treasuryAccountId: null, treasuryPermissions: [] } : candidate)),
      material: { ...next.material, officeSeats: next.material.officeSeats.filter((seat) => seat.officeId !== office.id) },
      society: { ...next.society, precedents: [...next.society.precedents, { polityId: office.polityId, kind: "emergency_office" as const, key: office.label.toLowerCase().slice(0, 160), atStep: toDay }].slice(-200) },
    };
    facts.push({
      localId: `office_lapsed_${office.id}`.slice(0, 60), kind: "office_lapsed",
      summary: `Nobody has held the office of ${office.label} in three years, and it has lapsed.`,
      affectedRefs: [{ kind: "polity", id: office.polityId }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 25,
    });
  }
  // An office made again, with the name of one that lapsed: the second time is a precedent too.
  const lapsedLabels = new Set(next.society.precedents.filter((precedent) => precedent.kind === "emergency_office").map((precedent) => `${precedent.polityId}|${precedent.key}`));
  const remade = next.offices.filter((office) => office.successionRuleId !== "abolished" && lapsedLabels.has(`${office.polityId}|${office.label.toLowerCase()}`) && !idle.has(office.id) && !next.society.precedents.some((precedent) => precedent.kind === "emergency_office" && precedent.key === office.label.toLowerCase() && precedent.atStep === toDay));
  const precedents = [...next.society.precedents, ...remade.map((office) => ({ polityId: office.polityId, kind: "emergency_office" as const, key: office.label.toLowerCase().slice(0, 160), atStep: toDay }))];
  return { ...next, society: { ...next.society, idleOffices: idleNow, precedents: precedents.slice(-200) } };
}

// ── Custom from precedent ───────────────────────────────────────────────────

const CUSTOM_WORDS: Record<"overruled_council" | "emergency_office" | "army_made_ruler", (polity: string, key: string) => string> = {
  overruled_council: (polity) => `The rulers of ${polity} govern without their council`,
  emergency_office: (_polity, key) => `The office of ${key} is a standing office now`,
  army_made_ruler: (polity) => `The army makes the rulers of ${polity}`,
};

/**
 * What has been done twice in ten years is how things are done. A ruler who
 * has overruled his council twice pays half the price the third time; an
 * emergency office made twice stops lapsing; an army that has made two rulers
 * makes the next one more easily (`regime.ts`).
 */
function customs(world: WorldState, toDay: number, ids: IdFactory, facts: FactProposalDraft[]): WorldState {
  let next = world;
  const counted = new Map<string, { polityId: string; kind: "overruled_council" | "emergency_office" | "army_made_ruler"; key: string; count: number }>();
  for (const precedent of world.society.precedents) {
    if (precedent.atStep < toDay - PRECEDENT_WINDOW_DAYS) continue;
    const groupKey = precedent.kind === "emergency_office" ? `${precedent.polityId}|${precedent.kind}|${precedent.key}` : `${precedent.polityId}|${precedent.kind}`;
    const entry = counted.get(groupKey) ?? { polityId: precedent.polityId, kind: precedent.kind, key: precedent.key, count: 0 };
    counted.set(groupKey, { ...entry, count: entry.count + 1 });
  }
  for (const entry of counted.values()) {
    if (entry.count < 2) continue;
    const exists = next.genericEntities.some((entity) => entity.kind === "custom" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === entry.polityId
      && entity.attributes?.["customKind"] === entry.kind && (entry.kind !== "emergency_office" || String(entity.attributes?.["officeLabel"]).toLowerCase() === entry.key));
    if (exists) continue;
    const label = CUSTOM_WORDS[entry.kind](polityName(next, entry.polityId), entry.key);
    next = {
      ...next,
      genericEntities: [...next.genericEntities, {
        id: ids.next("custom"),
        kind: "custom",
        label: label.slice(0, 160),
        ownerRef: { kind: "polity" as const, id: entry.polityId },
        attributes: { customKind: entry.kind, ...(entry.kind === "emergency_office" ? { officeLabel: entry.key } : {}) },
        linkedEntityIds: [],
        createdAtStep: toDay,
        provenanceEventIds: [],
        provinceId: null,
      }],
    };
    facts.push({
      localId: `custom_${entry.polityId}_${entry.kind}`.slice(0, 60), kind: "custom_formed",
      summary: `It has become the custom: ${label.charAt(0).toLowerCase()}${label.slice(1)}.`,
      affectedRefs: [{ kind: "polity", id: entry.polityId }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 45,
    });
  }
  return next;
}

// ── The month ───────────────────────────────────────────────────────────────

export interface ReviewSocietyInput {
  readonly world: WorldState;
  readonly government: GovernmentRules;
  readonly warfare?: ScenarioWarfareRules | undefined;
  readonly toDay: number;
  readonly ids: IdFactory;
}

/** Once a month: remember, read every group, seat them, let the strong ones press, and write down what has become custom. */
export function reviewSociety(input: ReviewSocietyInput): { world: WorldState; facts: FactProposalDraft[] } {
  const last = input.world.society.lastReviewStep;
  if (last !== null && input.toDay - last < SOCIETY_REVIEW_DAYS) return { world: input.world, facts: [] };
  const facts: FactProposalDraft[] = [];
  let world = remember(input.world, input.toDay);
  const candidates = [
    ...factions(world, input.toDay),
    ...clienteles(world),
    ...debtors(world),
    ...veterans(world, input.toDay),
    ...merchants(world),
    ...landholders(world),
    ...conquered(world),
    ...ownArmies(world, input.toDay),
    ...cults(world),
  ];
  // The first reading of a world is its opening state, not news.
  const opening = last === null;
  world = reconcile(world, candidates, input.toDay, facts);
  world = seatAll(world);
  world = officesByNeed(world, input.government, input.warfare, input.toDay, facts);
  world = customs(world, input.toDay, input.ids, facts);
  if (!opening) world = clamour(world, input.government, input.toDay);
  world = { ...world, society: { ...world.society, lastReviewStep: input.toDay } };
  return { world, facts: opening ? [] : facts };
}

/** The strength of the loyalty a general's army owes him, in basis points; 0 where it is still its country's. */
export function armyLoyaltyTo(world: WorldState, forceId: string, characterId: string): number {
  const group = world.material.politicalGroups.find((candidate) => candidate.active && candidate.type === "military_command" && candidate.emergentKey === `army:${forceId}:${characterId}`);
  return group?.strengthBps ?? 0;
}

export { rulerOfficeOf, chambersOf };
