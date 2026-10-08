import { WorldDeltaSchema, FactProposalSchema, atWar, fitStrengthOf, isNavalForce, type Character, type ScenarioWarfareRules, type WorldDelta, type WorldState } from "@chronica/shared";
import { pressureHolds } from "./narrator";
import { safeLocalId } from "./safe-local-id";
import type { StatecraftDecision, StatecraftInput } from "./statecraft";

/**
 * What the age dates, the rules bring about (docs/plans/war-plans.md, "War gaps closed").
 *
 * The scenario's pressures were offered to the narrator, a model, and only the age's lean on two powers (`pressureHolds`, read by the war score) reached
 * the rules; so a model-less world never saw Hiero beat the Mamertines at the Longanus, the Mamertines write to Rome and to Carthage, or a Carthaginian
 * garrison go into Messana, and the war of 264 had nothing to start from. A pressure with `happens` is such a dated thing: once, on the first monthly
 * reckoning on or after its day (and for a year after that, if nobody was looking), the rules do it as the world's own business -- open the war, lay the
 * defeat on the beaten side's armies, put the garrison into the city, send the letter -- and tell it in the people's words. They do it only
 * where it is not already so (a war already open, a garrison already there, a letter already sent), so a monthly reckoning that comes round again does not
 * do it twice; and never to a power the player rules.
 */

const wd = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
/** How long after its day a dated thing is still done, if undone. */
const DONE_WITHIN_DAYS = 365;
/** A war that began within this many days of the day is the dated war, whatever became of it since. */
const WAR_ALREADY_WITHIN_DAYS = 90;
/** The spirit of an army that has lost the field, in basis points. */
const BEATEN_MORALE_BPS = -2_500;

const landArmiesOf = (world: WorldState, polityId: string, warfare: ScenarioWarfareRules | undefined): WorldState["material"]["forces"] =>
  world.material.forces.filter((force) => force.polityId === polityId && force.outlaw !== true && fitStrengthOf(force) > 0 && !isNavalForce(force, warfare));

export function decideDatedEvents(input: StatecraftInput, rulerOf: (polityId: string) => Character | undefined): StatecraftDecision[] {
  const { world } = input;
  const day = world.instant.day;
  const out: StatecraftDecision[] = [];
  const exists = (polityId: string): boolean => world.map.polities.some((polity) => polity.id === polityId);
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const speaker = (polityId: string): Character | undefined =>
    rulerOf(polityId) ?? world.characters.filter((character) => character.alive && character.polityId === polityId).sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
  for (const pressure of input.pressures) {
    const happens = pressure.happens;
    if (happens === undefined || day < happens.atDay || day > happens.atDay + DONE_WITHIN_DAYS || !pressureHolds(world, pressure)) continue;
    const involved = [happens.warOpens?.polityId, happens.warOpens?.otherPolityId, happens.armyBeaten?.polityId, happens.garrisonEnters?.polityId, happens.appeals?.polityId, ...(happens.appeals?.toPolityIds ?? [])]
      .filter((id): id is string => id !== undefined);
    if (involved.some((id) => !exists(id) || input.excludedPolityIds.has(id))) continue;
    // Each thing is done by the man whose it is to do it: the ruler opens a war and raises a garrison, the people's spokesman writes.
    const parts: { by: Character; act: StatecraftDecision["act"]; target: string | null; deltas: WorldDelta[] }[] = [];
    const war = happens.warOpens;
    let opens = false;
    if (war !== undefined && !atWar(world.polityAgreements, war.polityId, war.otherPolityId)
      && !world.polityAgreements.some((agreement) => agreement.kind === "war" && [agreement.polityId, agreement.otherPolityId].includes(war.polityId) && [agreement.polityId, agreement.otherPolityId].includes(war.otherPolityId) && agreement.sinceStep >= happens.atDay - WAR_ALREADY_WITHIN_DAYS)) {
      const by = speaker(war.polityId);
      if (by !== undefined) {
        opens = true;
        const deltas: WorldDelta[] = [wd({
          op: "agreement_open", localId: safeLocalId(`war_${war.polityId}_${war.otherPolityId}_${pressure.id}`).slice(0, 60), kind: "war", polityId: war.polityId, otherPolityId: war.otherPolityId,
          terms: war.terms, forDays: null, sourceMessageRef: null, visibility: "public", reason: happens.summary.slice(0, 240),
        })];
        // The defeat is laid on the beaten side's armies only with the war it begins: a monthly reckoning that finds the war open does not beat them again.
        if (happens.armyBeaten !== undefined) {
          for (const force of landArmiesOf(world, happens.armyBeaten.polityId, input.warfare)) {
            deltas.push(wd({ op: "force_attrition", forceRef: force.id, cause: "desertion", lossBps: happens.armyBeaten.lossBps, moraleBpsDelta: BEATEN_MORALE_BPS, reason: happens.summary.slice(0, 240) }));
          }
        }
        parts.push({ by, act: "declare_war", target: war.otherPolityId, deltas });
      }
    }
    const garrison = happens.garrisonEnters;
    if (garrison !== undefined && !world.material.forces.some((force) => force.name === garrison.name)) {
      const commander = world.characters.find((character) => character.id === garrison.commanderCharacterId && character.alive);
      const by = speaker(garrison.polityId);
      if (by !== undefined && commander !== undefined && world.map.provinces.some((province) => province.id === garrison.provinceId)) {
        parts.push({ by, act: "raise_levy", target: null, deltas: [wd({
          op: "force_create", localId: safeLocalId(`dated_${pressure.id}`).slice(0, 60), name: garrison.name, polityId: garrison.polityId,
          commanderCharacterRef: commander.id, controllerCharacterRef: commander.id, locationId: garrison.provinceId, authorizedStrength: garrison.men, payObligationRef: null,
          reason: happens.summary.slice(0, 240),
        })] });
      }
    }
    const appeal = happens.appeals;
    if (appeal !== undefined) {
      const writer = speaker(appeal.polityId);
      const sent = new Set(world.diplomacy.filter((message) => message.fromPolityId === appeal.polityId && message.kind === "military_aid_request" && day - message.sentAtStep < DONE_WITHIN_DAYS).map((message) => message.toPolityId));
      if (writer !== undefined) {
        const deltas: WorldDelta[] = [];
        for (const to of appeal.toPolityIds.filter((id) => !sent.has(id))) {
          deltas.push(wd({
            op: "diplomatic_message_send", localId: safeLocalId(`appeal_${appeal.polityId}_${to}`).slice(0, 60), kind: "military_aid_request", fromPolityId: appeal.polityId, fromCharacterRef: writer.id,
            toPolityId: to, toCharacterRef: null, subject: `${nameOf(appeal.polityId)} asks ${nameOf(to)} for help`.slice(0, 200), terms: appeal.terms.slice(0, 600), replyWithinDays: 60, inReplyToRef: null,
            visibility: "polity", reason: happens.summary.slice(0, 240),
          }));
        }
        if (deltas.length > 0) parts.push({ by: writer, act: "letter", target: appeal.toPolityIds[0] ?? null, deltas });
      }
    }
    parts.forEach((part, index) => out.push({
      polityId: part.by.polityId ?? involved[0] ?? "", actorCharacterId: part.by.id, act: part.act, targetPolityId: part.target,
      why: happens.summary.slice(0, 400), deltas: part.deltas,
      facts: index > 0 ? [] : [FactProposalSchema.parse({
        localId: safeLocalId(`dated_${pressure.id}`).slice(0, 60), kind: "dated_event", summary: happens.summary.slice(0, 400),
        affectedRefs: [...new Set(involved)].slice(0, 6).map((id) => ({ kind: "polity" as const, id })), visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 75,
      })],
    }));
  }
  return out;
}
