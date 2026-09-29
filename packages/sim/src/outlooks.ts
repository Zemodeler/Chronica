import { groundToRetake, readDepartments, warsOf, type PolityOutlook, type WorldState } from "@chronica/shared";

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

const MARK = /^(the empty treasury|the loss of |enemy armies on its soil|a long peace|put its finances in order|take back |drive the enemy from |enlarge its dominion)/i;
const AT_WAR = /^(the war with |press the war with )/;
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

    const concerns: PolityOutlook["concerns"] = [
      ...(broke ? [{ label: "the empty treasury", level: "high" as const }] : []),
      ...lost.slice(0, 2).map((entry) => ({ label: `the loss of ${entry.name} to ${name(entry.holderId)}`.slice(0, 160), level: "high" as const })),
      ...(onOurSoil ? [{ label: "enemy armies on its soil", level: "high" as const }] : []),
      ...(longPeace && bold ? [{ label: "a long peace, and nothing won by it", level: "low" as const }] : []),
    ];
    const intentions = [
      ...(broke ? ["put its finances in order: taxes, loans, or an end to spending"] : []),
      ...lost.slice(0, 2).map((entry) => `take back ${entry.name} from ${name(entry.holderId)}`.slice(0, 200)),
      ...(onOurSoil ? ["drive the enemy from its own ground"] : []),
      ...(longPeace && bold ? ["enlarge its dominion where a neighbour is weak"] : []),
    ];
    const objective = lost[0] !== undefined ? `Take back what was lost to ${name(lost[0].holderId)}` : broke ? "Put its finances in order" : null;
    const target = Math.max(0, Math.min(100, (ruler?.mind.riskTolerance ?? 50) - (broke ? 15 : 0) + (lost.length > 0 ? 10 : 0) - (onOurSoil ? 5 : 0)));

    const index = outlooks.findIndex((outlook) => outlook.polityId === polity.id);
    const existing = outlooks[index];
    if (existing === undefined) {
      // A power with no aims yet -- one the world made in play, or a small
      // one nobody had written any for -- is given its own once it has
      // something to want: a war, an empty chest, lost ground. Not before: a
      // power with aims is a power whose people are asked more often.
      if (!concerns.some((concern) => concern.level === "high") && enemies.length === 0) continue;
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
