import { groundToRetake, readDepartments, warsOf, type PolityOutlook, type WorldState } from "@chronica/shared";
import { readBoard, type NeighbourReading } from "./board";

/**
 * A government's aims, kept true to its own condition (VISION §11).
 *
 * `aimsAtWar` keeps a power's wars in its aims; nothing else did. A power
 * whose chest was empty went on meaning to build, one that had just lost a
 * province meant nothing about it, and a power the world made in play -- a
 * rising become a country -- had no aims at all, so everybody in it answered
 * as though their government wanted nothing. Once a month each power's aims
 * are read off its state: debt, ground lost and not yet retaken, an enemy army
 * on its soil, and a long peace a bold ruler grows tired of. What the model
 * wrote besides is left as it was; only the engine's own lines come and go.
 */

const MARK = /^(the empty treasury|the loss of |enemy armies on its soil|a long peace|put its finances in order|take back |drive the enemy from |enlarge its dominion|a stronger neighbour, |ground we claim, held by |press our claim on |find friends against )/i;
const AT_WAR = /^(the war with |press the war with |send its men to )/;
const ENGINE_OBJECTIVE = /^(Put its finances in order|Take back what was lost to |Hold what it has, and grow where it can|Keep what it has)/;

/** A peace this long, under a ruler this bold, starts to look like a chance being wasted. */
const LONG_PEACE_DAYS = 720;
const BOLD_RULER = 60;
/** How far a power's appetite for risk moves toward its circumstances in one month. */
const RISK_STEP = 5;

export function aimsFromState(world: WorldState, atStep: number): PolityOutlook[] {
  const reader = readDepartments(world);
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const outlooks = [...world.polityOutlooks];
  for (const polity of world.map.polities) {
    const ground = world.map.provinces.filter((province) => province.controllerPolityId === polity.id);
    if (ground.length === 0) continue;
    const ruler = reader.rulers(polity.id)[0];
    const bold = (ruler?.mind.temperament.boldness ?? 50) >= BOLD_RULER;
    const enemies = warsOf(world.polityAgreements, polity.id);
    const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polity.id);
    const broke = chest !== undefined && chest.balance < 0;
    const lost = groundToRetake(world, polity.id);
    const onOurSoil = world.material.forces.some((force) => enemies.includes(force.polityId) && ground.some((province) => province.id === force.locationId));
    const lastWarEnded = Math.max(-Infinity, ...world.polityAgreements
      .filter((agreement) => agreement.kind === "war" && (agreement.polityId === polity.id || agreement.otherPolityId === polity.id))
      .map((agreement) => agreement.endedAtStep ?? (agreement.status === "active" ? atStep : agreement.sinceStep)));
    const longPeace = enemies.length === 0 && atStep - (Number.isFinite(lastWarEnded) ? lastWarEnded : 0) >= LONG_PEACE_DAYS;

    const concerns: PolityOutlook["concerns"][number][] = [
      ...(broke ? [{ label: "the empty treasury", level: "high" as const }] : []),
      ...lost.slice(0, 2).map((entry) => ({ label: `the loss of ${entry.name} to ${name(entry.holderId)}`.slice(0, 160), level: "high" as const })),
      ...(onOurSoil ? [{ label: "enemy armies on its soil", level: "high" as const }] : []),
      ...(longPeace && bold ? [{ label: "a long peace, and nothing won by it", level: "low" as const }] : []),
    ];
    const intentions: string[] = [
      ...(broke ? ["put its finances in order: taxes, loans, or an end to spending"] : []),
      ...lost.slice(0, 2).map((entry) => `take back ${entry.name} from ${name(entry.holderId)}`.slice(0, 200)),
      ...(onOurSoil ? ["drive the enemy from its own ground"] : []),
      ...(longPeace && bold ? ["enlarge its dominion where a neighbour is weak"] : []),
    ];
    // What its board says (`board.ts`): the neighbour it has most to fear,
    // the ground it claims in another's hands, and the chance to press that
    // claim while the holder looks the other way. Without these, 162 of 168
    // powers wanted nothing, and nobody asked from one of them had a reason
    // to do anything at all.
    const reading = readBoard(world).get(polity.id);
    const hostile = (neighbour: NeighbourReading): boolean => neighbour.relation === "war" || neighbour.trust <= -30;
    const free = (neighbour: NeighbourReading): boolean => neighbour.relation !== "leads_us" && neighbour.relation !== "follows_us" && neighbour.relation !== "ally" && neighbour.relation !== "protects_us" && neighbour.relation !== "we_protect";
    const threat = reading?.neighbours.find((neighbour) => hostile(neighbour) && free(neighbour) && neighbour.ratio < 0.67);
    const claimed = reading?.neighbours.find((neighbour) => neighbour.claimed.length > 0 && free(neighbour));
    const opening = reading === undefined || reading.leaderId !== null ? undefined : reading.neighbours.find((neighbour) =>
      free(neighbour) && neighbour.relation !== "war" && (neighbour.claimed.length > 0 || neighbour.trust <= -30) && neighbour.ratio >= 1.2 && neighbour.distractions.length > 0);
    if (threat !== undefined) concerns.push({ label: `a stronger neighbour, ${threat.name}, that wishes it no good`.slice(0, 160), level: threat.theirMenNear > 0 ? "high" : "medium" });
    if (claimed !== undefined) concerns.push({ label: `ground we claim, held by ${claimed.name}`.slice(0, 160), level: "medium" });
    if (opening !== undefined && (bold || (ruler?.mind.riskTolerance ?? 50) >= 50)) intentions.push(`press our claim on ${opening.name} while ${opening.distractions[0]}`.slice(0, 200));
    else if (threat !== undefined) intentions.push(`find friends against ${threat.name}`.slice(0, 200));

    const objective = lost[0] !== undefined ? `Take back what was lost to ${name(lost[0].holderId)}` : broke ? "Put its finances in order" : null;
    const target = Math.max(0, Math.min(100, (ruler?.mind.riskTolerance ?? 50) - (broke ? 15 : 0) + (lost.length > 0 ? 10 : 0) - (onOurSoil ? 5 : 0)));

    const index = outlooks.findIndex((outlook) => outlook.polityId === polity.id);
    const existing = outlooks[index];
    if (existing === undefined) {
      // A power with no aims yet -- one the world made in play, or a small
      // one nobody had written any for -- is given its own once it has
      // something to want: a war, an empty chest, lost ground. Not before: a
      // power with aims is a power whose people are asked more often.
      if (concerns.length === 0 && intentions.length === 0 && enemies.length === 0) continue;
      outlooks.push({
        polityId: polity.id,
        primaryObjective: objective ?? (bold ? "Hold what it has, and grow where it can" : "Keep what it has"),
        concerns: concerns.slice(0, 6),
        intentions: intentions.slice(0, 6),
        riskTolerance: target,
        updatedAtStep: atStep,
        lastChangeReason: "Its aims, as its condition gives them.",
      });
      continue;
    }
    const keptConcerns = existing.concerns.filter((concern) => !MARK.test(concern.label));
    const keptIntentions = existing.intentions.filter((intention) => !MARK.test(intention));
    const risk = existing.riskTolerance + Math.max(-RISK_STEP, Math.min(RISK_STEP, target - existing.riskTolerance));
    const primaryObjective = objective ?? (ENGINE_OBJECTIVE.test(existing.primaryObjective) ? (bold ? "Hold what it has, and grow where it can" : "Keep what it has") : existing.primaryObjective);
    const next: PolityOutlook = {
      ...existing,
      primaryObjective,
      // Its wars first, as `aimsAtWar` put them; then its condition; then what the model wrote.
      concerns: [...keptConcerns.filter((concern) => AT_WAR.test(concern.label)), ...concerns, ...keptConcerns.filter((concern) => !AT_WAR.test(concern.label))].slice(0, 6),
      intentions: [...keptIntentions.filter((intention) => AT_WAR.test(intention)), ...intentions, ...keptIntentions.filter((intention) => !AT_WAR.test(intention))].slice(0, 6),
      riskTolerance: risk,
    };
    const same = next.primaryObjective === existing.primaryObjective && next.riskTolerance === existing.riskTolerance
      && JSON.stringify(next.concerns) === JSON.stringify(existing.concerns) && JSON.stringify(next.intentions) === JSON.stringify(existing.intentions);
    if (same) continue;
    outlooks[index] = {
      ...next,
      updatedAtStep: atStep,
      lastChangeReason: [broke ? "its chest is empty" : null, lost.length > 0 ? "it has lost ground" : null, onOurSoil ? "the enemy is on its soil" : null, longPeace && bold ? "a long peace" : null]
        .filter((reason): reason is string => reason !== null).join("; ").replace(/^./, (first) => first.toUpperCase()).concat(".").replace(/^\.$/, "Its condition has eased.").slice(0, 300),
    };
  }
  return outlooks;
}
