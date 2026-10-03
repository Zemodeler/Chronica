/**
 * How fast things cross the map, and how far anyone reaches, in kilometres.
 *
 * Every timing here used to be per province, and a province was a region: a
 * march was eight days a border, a letter two. That made the pace of the war a
 * fact about how finely the map was cut. An edge now carries the kilometres
 * between its two province centres (`ProvinceEdge.distance`), and everything
 * that takes time or reaches somewhere is read from that, so a journey between
 * two places takes as long on a map of four thousand provinces as on one of
 * eight hundred.
 *
 * The numbers are the old ones, restated: on the first map neighbouring centres
 * were about `REFERENCE_PROVINCE_KM` apart. This is the one place to tune them.
 */

/** The old map's typical distance between neighbouring province centres; what "a province" meant in every hop count. */
export const REFERENCE_PROVINCE_KM = 85;

/**
 * A legion on the road with its baggage: about 21 km a day, four days over a
 * reference province. It was eight, a little over 10 km a day -- half what a
 * Roman army made on a road, so the consul's march from Latium to Rhegium
 * took seven weeks before any season or pass was counted.
 */
export const MARCH_KM_PER_DAY = REFERENCE_PROVINCE_KM / 4;
/** The fastest any march is made, however well fed: a day per reference province. */
export const FASTEST_MARCH_KM_PER_DAY = REFERENCE_PROVINCE_KM;

/** A courier on the roads makes a reference province in about two days. */
export const NEWS_LAND_KM_PER_DAY = REFERENCE_PROVINCE_KM / 2;
/** A mountain pass is slower than the plain: three days a reference province. */
export const NEWS_PASS_KM_PER_DAY = REFERENCE_PROVINCE_KM / 3;
/** A boat carrying word: an open sea lane of the old map's width in two days. */
export const NEWS_SEA_KM_PER_DAY = 130;
/** However short, a crossing by water costs a morning at least. */
export const NEWS_WATER_MIN_DAYS = 1;

/**
 * Fleets sailing to join an army. The old figure was three days a border, and
 * the borders a fleet crossed were sea lanes of about 250 km, so: a day's sail
 * is a reference province, as a trireme's is.
 */
export const SAIL_KM_PER_DAY = REFERENCE_PROVINCE_KM;

/** How far a levy is raised from around a province: six reference provinces. */
export const LEVY_REACH_KM = 6 * REFERENCE_PROVINCE_KM;
/** How close an enemy has to be to count as near: two reference provinces. */
export const ENEMY_NEAR_KM = 2 * REFERENCE_PROVINCE_KM;
/**
 * Hulls further off than this are not "the ships we have" for a crossing.
 * Two borders before; a sea lane alone is 260 km, so it is measured to hold one.
 */
export const FERRY_GATHER_KM = 300;
/** How far a man sees from his own ground: an army on the frontier is seen from the walls. */
export const SIGHT_KM = REFERENCE_PROVINCE_KM;
/** How far round an army the country gives it bread: half a reference province, the region a whole province once stood for. */
export const COUNTRYSIDE_KM = REFERENCE_PROVINCE_KM / 2;
/** Who can come for a man in trouble in the field. */
export const RELIEF_KM = REFERENCE_PROVINCE_KM;
/** How far a power reaches for its own officials and armies: eight reference provinces. */
export const OFFICIAL_REACH_KM = 8 * REFERENCE_PROVINCE_KM;

/**
 * The longest route anything is willing to plan. Not a reach but a bound on the
 * search: Gades to Antioch is under five thousand kilometres, and a march that
 * long is a campaign of years, not a refusal.
 */
export const MAX_ROUTE_KM = 6_000;

/**
 * How much longer than the direct way another way may be and still be a way
 * round it. Asking whether a march "must" cross a strait or a pass has to
 * ignore the road round by Gibraltar, or every island would be reachable dry-shod.
 */
export const DETOUR_FACTOR = 2;

/** Days a march of this length takes at the plain pace, before any commander or season. */
export const marchDaysFor = (km: number): number => km / MARCH_KM_PER_DAY;

/** Whole days to sail this far to join an army. */
export const sailDaysFor = (km: number): number => Math.ceil(km / SAIL_KM_PER_DAY);

/** "about 170 km", rounded to something a person would say. */
export function describeKm(km: number): string {
  if (km < 15) return `${Math.max(1, Math.round(km))} km`;
  const step = km < 100 ? 5 : 10;
  return `${Math.round(km / step) * step} km`;
}
