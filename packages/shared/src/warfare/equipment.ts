import type { Force } from "../material-state";

/**
 * The kit of an army (docs/economy.md, "Equipment").
 *
 * An army was men and nothing they stood in: no sword, no mail, no cloak, no shaft, no horse, no oar was a thing that wore out or
 * had to be bought, so a war could not make arms dear and the third of a legionary's pay that Polybius says the quaestor stopped
 * "for grain, clothes and arms" (6.39) bought nothing. Here an army's *establishment* says how much kit a man of each kind wears,
 * in the goods the markets already hold (metals, textiles, timber); the kit wears with the work the army does; the quartermaster
 * buys it again from the army's home markets with the stoppage; and an army in good kit fights a little better than one in rags.
 *
 * Pure: nothing here reads the markets or the treasury (`sim/equipment.ts` does).
 */

/** A man's kit in units of the markets' goods (a bar of metal, a length of cloth, a load of timber), and horses. */
export interface Kit {
  readonly metals: number;
  readonly textiles: number;
  readonly timber: number;
  readonly horses: number;
}

/**
 * Per head at full issue. The legionary's metal is the helmet, the cuirass or the breast-plate, the shield's boss and rim, the
 * sword and the heads of the pila: some 25 kilos, a bar being the five kilos the markets reckon (Polybius 6.23 gives the
 * panoply: shield, sword, two javelins, helmet, greaves, breast-plate or mail); his cloth the tunic and the cloak, and the
 * shafts and the shield's boards the timber. The velites carry only a small shield, a sword and javelins (6.22); a horseman's
 * armour is as heavy as a legionary's and he owns a horse; a rower wants a tunic and a share of the oars; a hull wants its
 * cordage, sails and fittings. At the markets' prices a legionary's kit is some 183 drachmae, a year and a half of his gross
 * pay: the third stopped from it (3.3 a month) renews a kit in some fifty-five months, about the five years a man's panoply lasts.
 */
export const KIT_BY_KIND = {
  heavy: { metals: 5, textiles: 1, timber: 2, horses: 0 },
  light: { metals: 1.5, textiles: 0.6, timber: 1.5, horses: 0 },
  horse: { metals: 5, textiles: 1.5, timber: 1.5, horses: 1 },
  elephant: { metals: 0, textiles: 2, timber: 3, horses: 0 },
  /** Per hull, not per man: the hull's fittings, sails and cordage, and the oars, for a crew of three hundred. */
  warship: { metals: 6, textiles: 30, timber: 90, horses: 0 },
  transport: { metals: 1, textiles: 12, timber: 30, horses: 0 },
} as const satisfies Record<string, Kit>;
export type KitKind = keyof typeof KIT_BY_KIND;

/** What a horse costs the state's remount, the horse-owning classes selling it (drachmae). It is bought at that price, not out of a hub's stock. */
export const HORSE_PRICE = 120;
/** Timber a besieging army's engines (rams, towers, mantlets, hurdles) use up, per man, at the full issue. */
export const SIEGE_TIMBER_PER_MAN = 1.5;

/** The kit a category of troops wears, from its id. */
export function kitKindOf(categoryId: string): KitKind {
  if (/warship|trireme|quinquereme|galley|ship/iu.test(categoryId)) return "warship";
  if (/transport|hull/iu.test(categoryId)) return "transport";
  if (/elephant/iu.test(categoryId)) return "elephant";
  if (/cavalry|horse|equites|eques|hippe/iu.test(categoryId)) return "horse";
  if (/light|velit|skirmish|archer|sling|javelin|psil/iu.test(categoryId)) return "light";
  return "heavy";
}

/** What an army's own arms are of its power's: hired companies come with their own and renew less out of the paymaster's purse. */
export function selfArmedShare(basis: string | undefined, equipment: "self" | "state" | undefined): number {
  return basis === "mercenary" && equipment !== "state" ? 0.5 : 1;
}

export interface KitNeed {
  readonly metals: number;
  readonly textiles: number;
  readonly timber: number;
  readonly horses: number;
}

/** The units that would renew the whole kit of a force at full issue: the heads of every row, the siege train where it lies before a town. */
export function kitNeedOf(force: Pick<Force, "personnel">, options: { readonly sieging?: boolean; readonly armed?: number } = {}): KitNeed {
  const armed = options.armed ?? 1;
  let metals = 0;
  let textiles = 0;
  let timber = 0;
  let horses = 0;
  for (const row of force.personnel) {
    if (row.fit <= 0) continue;
    const kit = KIT_BY_KIND[kitKindOf(row.categoryId)];
    metals += row.fit * kit.metals;
    textiles += row.fit * kit.textiles;
    timber += row.fit * kit.timber;
    horses += row.fit * kit.horses;
    if (options.sieging === true && kit.horses === 0 && kit.metals > 0 && !/ship|hull/iu.test(row.categoryId)) timber += row.fit * SIEGE_TIMBER_PER_MAN;
  }
  return { metals: metals * armed, textiles: textiles * armed, timber: timber * armed, horses: horses * armed };
}

// ── Condition ───────────────────────────────────────────────────────────────

/** What a force is taken to stand in the first time its kit is looked at, and what no modifier is read from. */
export const EQUIPMENT_NEUTRAL_BPS = 7_000;
/** What a body of recruits brings in with it: the household's own arms, a part of an issue. */
export const RECRUIT_KIT_BPS = 5_000;
/** Wear in a month's ordinary service, in basis points of a full issue: the five years a panoply lasts. */
export const WEAR_GARRISON_BPS = 160;
/** On campaign, away from home ground, wear is twice that. */
export const WEAR_CAMPAIGN_FACTOR = 2;
/** The engines and tools of a siege, a month under the walls. */
export const WEAR_SIEGE_BPS = 150;
/** Every day of battle, the arms broken, lost, left on the field. */
export const WEAR_BATTLE_BPS = 300;
/** No more than three days of battle count in a month. */
export const WEAR_BATTLES_MAX = 3;
/** The share of a month's wage stopped for arms, grain and clothes: the treasury's `PAY_STOPPAGES_SHARE`, spent here on kit. */
export const KIT_BUYERS_SHARE = 0.3;

/** Wear in a month (basis points), from what the army did in it. */
export function wearBpsOf(work: { readonly campaigning: boolean; readonly sieging: boolean; readonly battles: number }): number {
  return Math.round(WEAR_GARRISON_BPS * (work.campaigning ? WEAR_CAMPAIGN_FACTOR : 1)
    + (work.sieging ? WEAR_SIEGE_BPS : 0)
    + Math.min(WEAR_BATTLES_MAX, Math.max(0, work.battles)) * WEAR_BATTLE_BPS);
}

/**
 * What an army's kit does to its strength in a battle, in basis points: a bounded gain or loss, read with the other modifiers of the
 * field (`battle-resolver.ts`), and never more than a tenth either way, so that kit is a thing to look after, not a way to win. An army
 * the engine has not yet looked at (a world older than this rule) reads as neutral. Down to -1,000 at no kit at all (a man with a spear
 * and a cloak), up to +300 at a full issue of new arms.
 */
export const EQUIPMENT_MODIFIER_FLOOR_BPS = -1_000;
export const EQUIPMENT_MODIFIER_CEILING_BPS = 300;
export function equipmentModifierBps(force: Pick<Force, "equipmentBps">): number {
  const condition = force.equipmentBps;
  if (condition === undefined) return 0;
  const delta = condition - EQUIPMENT_NEUTRAL_BPS;
  const raw = delta < 0 ? delta * 0.15 : delta * 0.1;
  return Math.max(EQUIPMENT_MODIFIER_FLOOR_BPS, Math.min(EQUIPMENT_MODIFIER_CEILING_BPS, Math.round(raw)));
}

// ── Who serves: the census classes ──────────────────────────────────────────

/**
 * The share of a people's men of age who are of the classes that serve under the standards, in basis points, by how developed the
 * country is. In Rome the classes were the census's (Livy 1.43; Polybius 6.19): the assidui, who had the property to arm themselves,
 * were enrolled for the legions; the capite censi and the proletarii, rated under four thousand asses, were not (Gellius 16.10), and
 * were taken for the fleet (Polybius 6.19.4) or, in the extremity after Cannae, for the legions with the slaves (Livy 22.57). The
 * poorer a country the more of it is landless: a tenth of the men at the highest development, two-fifths at the least, and more
 * where the floor of the census is higher.
 */
export function assiduiShareBps(basis: string | undefined, floor: string | undefined, developmentBps: number): number {
  if (basis !== "property_class") return 10_000;
  const dev = Math.max(0, Math.min(10_000, developmentBps));
  const base = 6_000 + Math.round((dev * 3_000) / 10_000);
  const kept = floor === "high" ? 0.6 : floor === "middling" ? 0.8 : 1;
  return Math.max(2_000, Math.min(10_000, Math.round(base * kept)));
}

/** A levy takes the assidui only, unless the power is in its extremity and takes whoever can bear arms. */
export function levyablePool(available: number, shareBps: number, extremity: boolean): number {
  return extremity ? available : Math.floor((available * shareBps) / 10_000);
}

// ── Crews ───────────────────────────────────────────────────────────────────

/**
 * Oarsmen to a hull. Polybius (1.26.7) gives a Roman quinquereme in 256 BC three hundred rowers and a hundred and twenty marines, and
 * the Carthaginian a little more. The marines were legionaries embarked and come out of the armies; the three hundred come out of
 * the naval pool (`levies.ts`). A transport's crew is a score of seamen and the soldiers' own hands: forty.
 */
export const CREW_PER_WARSHIP = 300;
export const CREW_PER_TRANSPORT = 40;
/** What the allies' seamen (the socii navales) may make of a Roman crew at the most: a third and a half of a hundred (Polybius 1.20.14, 1.21). */
export const ALLIED_CREW_SHARE_BPS = 3_500;

/** Oarsmen a hull of this kind wants; none for a force that is not afloat. */
export function crewPerHull(categoryId: string | undefined): number {
  if (categoryId === undefined) return 0;
  const kind = kitKindOf(categoryId);
  return kind === "warship" ? CREW_PER_WARSHIP : kind === "transport" ? CREW_PER_TRANSPORT : 0;
}

// ── Refill ──────────────────────────────────────────────────────────────────

/** The share of a power's authorised host a dilectus can refill in a month: a twelfth a year is a consul's two legions of eight. */
export const REFILL_SHARE_PER_MONTH = 0.06;
/** A legion is refilled while it stands under this share of its authorised strength; above it the war has not yet thinned it. */
export const REFILL_BELOW_SHARE = 0.85;
/** A force this thin is in its extremity: the levy takes the landless too. */
export const EXTREMITY_BELOW_SHARE = 0.4;

// ── Hulls ───────────────────────────────────────────────────────────────────

/**
 * What a quinquereme's hull takes out of the markets: some two hundred loads of pine, fir and cedar for the keel, the ribs and the planking, and eight bars of bronze and iron
 * for the ram, the nails and the fittings. At the markets' base prices that is a ninth of the twelve thousand drachmae a hull costs the chest; the rest is the shipwrights'
 * and the carpenters' labour. A fleet built in a dear year costs more, and a fleet laid down draws the yard's timber out of its hub.
 */
export const HULL_TIMBER_LOADS = 200;
export const HULL_METAL_BARS = 8;
/** The months a fleet's timber is drawn over: the felling, seasoning and building (`a-fleet-by-decree.ts`: a hundred and fifty days). */
export const YARD_MONTHS = 5;
