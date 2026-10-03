import {
  aNameFor,
  atWar,
  createCanonicalNpc,
  disbandForces,
  isStanding,
  openWar,
  readDepartments,
  type FactProposalDraft,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Powers ending, and rising again.
 *
 * Nothing ended a power. The Mamertines lost Messana, their only province, and
 * went on writing letters, declaring wars and keeping a garrison ready for a
 * city that was Rome's; a power could be beaten to nothing and still be at war
 * for ever. Three ways out now, and one way back:
 *
 * - **Surrender** (`submission` in a peace): the power gives itself up to the
 *   victor. Its ground, its people and its money are the victor's; its army is
 *   disbanded; its treaties and its wars are over.
 * - **Extinction**: sixty days with no ground and no army, and there is
 *   nothing left of it to be a power. Its people belong to whoever holds the
 *   ground they stand on.
 * - **Exile**: no ground but an army still in the field is a government in
 *   exile, and it lives for as long as the army does.
 * - **Rising**: ground handed over keeps its old loyalty (`Province.yearning`),
 *   which grows under a loose hold and hard times; when it is full the
 *   province rises -- for the old master where it still stands, or to restore
 *   the power that surrendered it.
 */

/** Days with no ground and no army before a power is gone. */
export const EXTINCTION_AFTER_DAYS = 60;
/** How long a power with no ground keeps a starving army together before its men scatter. */
export const LANDLESS_ARMY_DAYS = 90;
/** How much a people handed over still want their own, at the handing over. */
export const YEARNING_AT_SURRENDER_BPS = 4_000;
/** A province rises for its yearning at this. */
export const RISING_AT_BPS = 10_000;
/** Men a rising province puts in the field, for each province that rises. */
const RISING_MEN = 1_500;

const nameOf = (world: WorldState, polityId: string): string => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;

/**
 * A power's end. Its ground goes to `into` where it surrendered to somebody;
 * everything that made it a party to anything is closed.
 */
export function endPolity(
  world: WorldState,
  polityId: string,
  how: "absorbed" | "extinct",
  into: string | null,
  atStep: number,
  /** Joined of its own will, not beaten into it: told as a union, not a surrender. */
  willing = false,
): { world: WorldState; facts: FactProposalDraft[] } {
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  if (polity === undefined || !isStanding(polity)) return { world, facts: [] };
  const name = polity.name;
  const reason = `${name} is no more.`;

  // Ground and cities to the victor, still wanting their own.
  const provinces = world.map.provinces.map((province) => {
    // Ground it owned that somebody else occupies: the title passes to the
    // victor, or, where nobody took it in, to whoever holds it.
    if (province.ownerPolityId === polityId && province.controllerPolityId !== polityId) {
      return { ...province, ownerPolityId: into !== null && into !== province.controllerPolityId ? into : null };
    }
    if (province.controllerPolityId !== polityId && !province.settlements.some((city) => city.controllerPolityId === polityId)) return province;
    if (into === null) return province;
    return {
      ...province,
      controllerPolityId: province.controllerPolityId === polityId ? into : province.controllerPolityId,
      settlements: province.settlements.map((city) => (city.controllerPolityId === polityId ? { ...city, controllerPolityId: into } : city)),
      yearning: { polityId, bps: YEARNING_AT_SURRENDER_BPS, updatedAtStep: atStep },
      lostBy: null,
    };
  });

  // Its people: the victor's subjects, or the subjects of whoever holds the
  // ground they stand on. The first of them keeps the old name in his heart.
  const holderOf = (provinceId: string): string | null => provinces.find((province) => province.id === provinceId)?.controllerPolityId ?? null;
  const people = world.characters.filter((character) => character.polityId === polityId && character.alive).sort((a, b) => b.prestigeBps - a.prestigeBps);
  const restorer = people[0]?.id ?? null;
  const characters = world.characters.map((character) => {
    if (character.polityId !== polityId) return character;
    const home = into ?? holderOf(character.locationProvinceId);
    const standingHome = home !== null && world.map.polities.some((candidate) => candidate.id === home && isStanding(candidate)) ? home : null;
    return {
      ...character,
      polityId: standingHome,
      officeId: null,
      ambitions: character.id === restorer
        ? [...character.ambitions, { id: `restore-${polityId}`, label: `Restore ${name}`.slice(0, 200), kind: "restoration" as const, targetId: polityId, status: "active" as const, steps: [] }].slice(-12)
        : character.ambitions,
    };
  });

  // Its army laid down its arms; its money is the victor's.
  // A power that gave itself up to a victor puts its soldiers into the
  // victor's service, under the captains they had; one that simply ended has
  // none left to serve.
  const inherits = how === "absorbed" && into !== null;
  const heirs = inherits ? world.material.forces.filter((force) => force.polityId === polityId) : [];
  const disbanded = new Set(inherits ? [] : world.material.forces.filter((force) => force.polityId === polityId).map((force) => force.id));
  const treasuryIds = new Set(world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polityId).map((account) => account.id));
  const seized = world.material.accounts.filter((account) => treasuryIds.has(account.id)).reduce((sum, account) => sum + account.balance, 0);
  const victorTreasury = into === null ? undefined : world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === into);
  const accounts = world.material.accounts.map((account) => {
    if (treasuryIds.has(account.id)) return { ...account, balance: 0 };
    if (victorTreasury !== undefined && account.id === victorTreasury.id) return { ...account, balance: account.balance + seized };
    return account;
  });

  const heirIds = new Set(heirs.map((force) => force.id));
  // Taken into service, they answer to whoever raises the victor's levies, or
  // its ruler, or the general of its largest army; a man who ruled the power
  // that ended does not keep an army of it -- he is the first to want it back.
  const reader = readDepartments(world);
  const fitOf = (force: (typeof world.material.forces)[number]): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
  const general = into === null ? undefined : world.material.forces.filter((force) => force.polityId === into)
    .sort((a, b) => fitOf(b) - fitOf(a) || a.id.localeCompare(b.id))[0]?.commanderCharacterId;
  const victorHand = into === null ? null : reader.holding({ kind: "polity", id: into }, "levy").people[0]?.id ?? reader.rulers(into)[0]?.id ?? general ?? null;
  const formerRulers = new Set([...reader.rulers(polityId).map((person) => person.id), ...(restorer === null ? [] : [restorer])]);
  // Its books go with it. A tax it raised is now raised for the victor, from
  // the same ground; its soldiers taken into service are paid by the victor's
  // treasury; whatever else it owed, or was owed, ended with it. Left as they
  // were, a kingdom absorbed in June went on asking more of its lands than
  // they could bear, and leaving its squadron unpaid, into the autumn -- and
  // the victor's income never grew by the lands it took.
  const victorTreasuryId = into === null ? null : victorTreasury?.id ?? null;
  const servicePay = new Set(victorTreasuryId === null ? [] : heirs.map((force) => force.payObligationId).filter((id): id is string => id !== null && id !== undefined));
  const incomeSources = world.material.incomeSources.map((source) => {
    if (!source.active) return source;
    if (source.counterpartyPolityId === polityId) return { ...source, active: false };
    if (!treasuryIds.has(source.beneficiaryAccountId)) return source;
    return victorTreasuryId === null ? { ...source, active: false } : { ...source, beneficiaryAccountId: victorTreasuryId };
  });
  const obligations = world.material.obligations.map((obligation) => {
    if (!obligation.active) return obligation;
    if (obligation.recipientAccountId !== undefined && treasuryIds.has(obligation.recipientAccountId)) return { ...obligation, active: false };
    if (!treasuryIds.has(obligation.payerAccountId)) return obligation;
    return servicePay.has(obligation.id) ? { ...obligation, payerAccountId: victorTreasuryId!, arrears: 0, missedPeriods: 0 } : { ...obligation, active: false };
  });
  const takenIntoService = (force: (typeof heirs)[number]) => ({
    ...force,
    polityId: into!,
    payObligationId: force.payObligationId !== null && force.payObligationId !== undefined && servicePay.has(force.payObligationId) ? force.payObligationId : null,
    ...(victorHand === null ? {} : {
      controllerCharacterId: victorHand,
      ...(formerRulers.has(force.commanderCharacterId) ? { commanderCharacterId: victorHand } : {}),
    }),
  });
  // A crisis over ground that has just changed hands is over: its thread closes
  // with the power it was about, and its rivals' aims stop pointing at it.
  const passed = new Set(world.map.provinces.filter((province, at) => provinces[at] !== province).map((province) => province.id));
  const storylines = into === null ? world.storylines : world.storylines.map((thread) => (thread.closedAtStep === null && thread.provinceId !== null && passed.has(thread.provinceId)
    ? { ...thread, closedAtStep: atStep, updatedAtStep: atStep, history: [...thread.history, `${name} gave itself up to ${nameOf(world, into)}: the matter is settled.`].slice(-24).map((line) => line.slice(0, 480)) }
    : thread));
  const next: WorldState = {
    ...world,
    storylines,
    characters,
    map: {
      ...world.map,
      provinces,
      polities: world.map.polities.map((candidate) => (candidate.id === polityId
        ? { ...candidate, endedAtStep: atStep, endedHow: how, absorbedByPolityId: into, capitalSettlementId: null }
        : candidate)),
    },
    material: {
      ...world.material,
      accounts,
      incomeSources,
      obligations,
      forces: heirIds.size === 0 ? world.material.forces
        : world.material.forces.map((force) => (heirIds.has(force.id) ? takenIntoService(force) : force)),
      officeSeats: world.material.officeSeats.map((seat) => (seat.holderCharacterId !== null && people.some((person) => person.id === seat.holderCharacterId)
        && seat.officeId.startsWith(`${polityId}`) ? { ...seat, holderCharacterId: null, status: "vacant" as const, vacancyCause: "abolished" as const, termExpiresAtStep: atStep } : seat)),
    },
    polityAgreements: world.polityAgreements.map((agreement) => (agreement.status === "active" && (agreement.polityId === polityId || agreement.otherPolityId === polityId)
      ? { ...agreement, status: "ended" as const, endedAtStep: atStep, endedReason: reason }
      : agreement)),
    diplomacy: world.diplomacy.map((message) => (message.status === "awaiting_reply" && (message.fromPolityId === polityId || message.toPolityId === polityId)
      ? { ...message, status: "answered" as const, answer: "ignored" as const, answerText: reason, answeredAtStep: atStep }
      : message)),
    sieges: world.sieges.map((siege) => (siege.status === "active" && (siege.besiegerPolityId === polityId || siege.defenderPolityId === polityId)
      ? { ...siege, status: "lifted" as const, endedAtStep: atStep, endedReason: reason }
      : siege)),
    polityOutlooks: world.polityOutlooks.filter((outlook) => outlook.polityId !== polityId),
    // What its men saw as its men -- a neighbour to dictate to, a council to
    // win -- went with it.
    characterPressures: world.characterPressures.filter((pressure) => !(pressure.id.startsWith("opening:") && people.some((person) => person.id === pressure.characterId))),
  };

  const cleared = disbandForces(next, disbanded, victorTreasury?.id ?? null);
  const summary = how === "absorbed" && into !== null && willing
    ? `${name} joined ${nameOf(world, into)} by its own consent and is one state with it: its ground and its people are ${nameOf(world, into)}'s${heirs.length > 0 ? `, and its levies serve ${nameOf(world, into)} under ${nameOf(world, into)}'s command` : ""}.`
    : how === "absorbed" && into !== null
    ? `${name} gave itself up to ${nameOf(world, into)} and was no more: its ground and its people are ${nameOf(world, into)}'s${disbanded.size > 0 ? ", and its army laid down its arms" : heirs.length > 0 ? `, and its army took service under ${nameOf(world, into)}` : ""}.`
    : `${name} was no more: it held no ground and no army, and its people are subjects of whoever holds the ground they stand on.`;
  return {
    world: cleared,
    facts: [{
      localId: `polity_ended_${polityId}`.slice(0, 60),
      kind: "polity_ended",
      summary,
      affectedRefs: [{ kind: "polity", id: polityId }, ...(into === null ? [] : [{ kind: "polity" as const, id: into }])],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 90,
    }],
  };
}

/**
 * The calendar's part: powers with nothing left end, and yearning grows and
 * boils over. Monthly steps, so a burst covering ten days moves a third.
 */
export function reviewPowers(world: WorldState, toDay: number, ids: IdFactory): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let next = world;

  // ── No ground ──────────────────────────────────────────────────────────
  for (const polity of next.map.polities) {
    if (!isStanding(polity)) continue;
    // A city is ground: the Campanians held Rhegium inside a Bruttian
    // province, and counting provinces alone made them landless from the
    // first morning.
    // And ground it owns that an enemy occupies: a country overrun is still a
    // country until a peace says otherwise.
    const landed = next.map.provinces.some((province) => province.controllerPolityId === polity.id || province.ownerPolityId === polity.id
      || province.settlements.some((settlement) => settlement.controllerPolityId === polity.id));
    const armed = next.material.forces.some((force) => force.polityId === polity.id && force.personnel.some((group) => group.fit > 0));
    if (landed) {
      if (polity.landlessSinceStep != null) next = setPolity(next, polity.id, { landlessSinceStep: null });
      continue;
    }
    // Some powers are drawn with nothing: raiders, a court with no country. A
    // power that never held ground in this world is not one that lost it.
    const everHeld = next.map.provinces.some((province) => province.lostBy?.polityId === polity.id || province.yearning?.polityId === polity.id)
      || next.material.forces.some((force) => force.polityId === polity.id);
    if (!everHeld) continue;
    const since = polity.landlessSinceStep ?? toDay;
    if (polity.landlessSinceStep == null) next = setPolity(next, polity.id, { landlessSinceStep: toDay });
    // An army with no ground to feed it does not live on for ever: the
    // Campanian legion starved behind Rhegium's lost walls for eight months,
    // its war with Rome open the whole time. Once every army it has left is
    // starving and a season has passed, the men scatter and the power ends.
    const starving = armed && next.material.forces
      .filter((force) => force.polityId === polity.id && force.personnel.some((group) => group.fit > 0))
      .every((force) => force.provisionStatus === "critical");
    if (toDay - since >= EXTINCTION_AFTER_DAYS && (!armed || (starving && toDay - since >= LANDLESS_ARMY_DAYS))) {
      const ended = endPolity(next, polity.id, "extinct", null, toDay);
      next = ended.world;
      facts.push(...ended.facts);
    }
  }

  // ── Yearning ───────────────────────────────────────────────────────────
  const material = new Map(next.material.provinceMaterial.map((row) => [row.provinceId, row]));
  const rising: string[] = [];
  const provinces = next.map.provinces.map((province) => {
    const yearning = province.yearning;
    if (yearning == null || province.controllerPolityId === null || province.controllerPolityId === yearning.polityId) return province;
    const monthShare = Math.max(0, toDay - (yearning.updatedAtStep ?? toDay)) / 30;
    if (monthShare === 0) return province;
    // A loose hold and hard times feed it; a firm, fed peace starves it.
    const stability = material.get(province.id)?.stabilityBps ?? 5_000;
    const perMonth = (province.controlFirmnessBps < 5_000 ? 400 : province.controlFirmnessBps >= 7_000 ? -300 : 100)
      + (stability < 4_000 ? 300 : stability >= 7_000 ? -150 : 0);
    const bps = Math.max(0, Math.min(10_000, Math.round(yearning.bps + perMonth * monthShare)));
    if (bps >= RISING_AT_BPS) rising.push(province.id);
    return { ...province, yearning: bps === 0 ? null : { ...yearning, bps, updatedAtStep: toDay } };
  });
  next = { ...next, map: { ...next.map, provinces } };

  // ── Risings ────────────────────────────────────────────────────────────
  for (const provinceId of rising) {
    const rose = rise(next, provinceId, toDay, ids);
    next = rose.world;
    facts.push(...rose.facts);
  }
  return { world: next, facts };
}

function setPolity(world: WorldState, polityId: string, change: Partial<WorldState["map"]["polities"][number]>): WorldState {
  return { ...world, map: { ...world.map, polities: world.map.polities.map((polity) => (polity.id === polityId ? { ...polity, ...change } : polity)) } };
}

/**
 * A province rising for the power it wants. Where that power still stands the
 * province goes over to it, and its holder is at war with it; where it ended,
 * the rising restores it, under the man who kept its name -- or a man of its
 * people, where nobody did -- with an army raised from the province.
 */
function rise(world: WorldState, provinceId: string, atStep: number, ids: IdFactory): { world: WorldState; facts: FactProposalDraft[] } {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  const wanted = province?.yearning?.polityId;
  const holder = province?.controllerPolityId ?? null;
  if (province === undefined || wanted === undefined || holder === null) return { world, facts: [] };
  const polity = world.map.polities.find((candidate) => candidate.id === wanted);
  if (polity === undefined) return { world, facts: [] };
  const restoring = !isStanding(polity);

  // Who leads it: the man who swore to restore it, else a man of its people.
  let next = world;
  let leaderId = world.characters.find((character) => character.alive && character.ambitions.some((ambition) => ambition.status === "active" && ambition.targetId === wanted))?.id ?? null;
  if (leaderId === null) {
    const made = createCanonicalNpc(next, {
      characterId: ids.next("character"),
      name: aNameFor(wanted, `rising-${provinceId}`, new Set(next.characters.map((character) => character.name))),
      locationProvinceId: provinceId, polityId: wanted, createdAtStep: atStep, creationReason: `Led the rising for ${polity.name}.`,
      ageYearsAtStart: 38, prestigeBps: 6_000,
    });
    if (made === null) return { world, facts: [] };
    next = made.world;
    leaderId = made.character.id;
  }
  const leader = leaderId;

  const forceId = ids.next("force");
  next = {
    ...next,
    characters: next.characters.map((character) => (character.id === leader ? { ...character, polityId: wanted, locationProvinceId: provinceId } : character)),
    map: {
      ...next.map,
      polities: next.map.polities.map((candidate) => (candidate.id === wanted
        ? { ...candidate, endedAtStep: null, endedHow: null, absorbedByPolityId: null, landlessSinceStep: null, capitalSettlementId: candidate.capitalSettlementId ?? province.settlements[0]?.id ?? null }
        : candidate)),
      provinces: next.map.provinces.map((candidate) => (candidate.id === provinceId
        ? { ...candidate, controllerPolityId: wanted, controlFirmnessBps: 3_000, yearning: null, lostBy: { polityId: holder, atStep },
          settlements: candidate.settlements.map((city) => (city.controllerPolityId === holder ? { ...city, controllerPolityId: wanted } : city)) }
        : candidate)),
    },
    material: {
      ...next.material,
      forces: [...next.material.forces, {
        id: forceId, name: `The rising of ${province.name}`.slice(0, 120), polityId: wanted, commanderCharacterId: leader, controllerCharacterId: leader,
        locationId: provinceId, positionId: null, authorizedStrength: RISING_MEN,
        personnel: [{ categoryId: "infantry", label: "Men of the rising", fit: RISING_MEN, unavailable: [] }],
        moraleBps: 7_000, cohesionBps: 4_500, fatigueBps: 0, provisionStatus: "provisioned", provisionedThroughStep: atStep + 30,
        payObligationId: null, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
      }],
    },
  };
  if (!atWar(next.polityAgreements, wanted, holder)) {
    next = { ...next, polityAgreements: openWar(next.polityAgreements, { id: ids.next("agreement"), polityId: wanted, otherPolityId: holder, terms: `The rising of ${province.name}.`, atStep, sourceMessageId: null, reason: `${province.name} rose against ${nameOf(world, holder)}.` }) };
  }
  const who = next.characters.find((character) => character.id === leader)?.name ?? "a man of the province";
  return {
    world: next,
    facts: [{
      localId: `rising_${provinceId}_${atStep}`.slice(0, 60),
      kind: "rising",
      summary: restoring
        ? `${province.name} rose against ${nameOf(world, holder)} under ${who}, and ${polity.name} stood again.`
        : `${province.name} rose against ${nameOf(world, holder)} under ${who} and went over to ${polity.name}.`,
      affectedRefs: [{ kind: "province", id: provinceId }, { kind: "polity", id: wanted }, { kind: "polity", id: holder }, { kind: "character", id: leader }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 85,
    }],
  };
}
