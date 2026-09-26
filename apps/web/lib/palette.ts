/**
 * The lamplit room's colours, for code that paints rather than styles.
 *
 * The canvas map cannot afford to read CSS custom properties every frame, so
 * it takes them from here. Each value that shares a name with a token in
 * app/styles/tokens.css must equal it; palette.test.ts holds them together.
 * DESIGN.md says what each is for.
 */
export const TOKENS = {
  soot: "#15110D",
  umber: "#2A211A",
  wax: "#2B2419",
  vellum: "#E6D9BE",
  dust: "#A8977C",
  papyrus: "#E6D8BA",
  ink: "#231B14",
  bronze: "#B98B4A",
  bronzeDeep: "#7A5626",
  lamp: "#F2C66D",
  sealRoman: "#8F2320",
} as const;

/**
 * The map, drawn as an engraved plate: sepia land, flat ink-teal water,
 * each power a light wash with a strong band inside its border.
 */
export const ATLAS = {
  /** Open sea, and the ground beyond the raster. */
  water: "#10282E",
  /** The sepia the relief is toned toward (multiplied into its luminance). */
  sepiaLight: [204, 184, 146] as const,
  sepiaDark: [52, 40, 28] as const,
  rivers: "#557F86",
  /** Borders between powers at war: always this red, whoever is looking. */
  war: "#B0362C",
  /** A province pointed at, and a province chosen. */
  hover: TOKENS.vellum,
  selected: TOKENS.lamp,
  /** How much of a power's colour washes over its land. */
  washAlpha: 0.2,
  /**
   * The band inside a power's border: at most this many CSS pixels, and no
   * more than this share of a degree on screen, so zoomed out a small
   * province is not all band. Then its strength.
   */
  bandPixels: 5,
  bandShareOfDegree: 0.1,
  bandAlpha: 0.72,
  /** Region names, and the halo that lifts them off the relief. */
  label: "#2A1E14",
  labelHalo: "rgb(230 216 186 / 88%)",
} as const;

/** The five great powers, in mineral pigments. Everyone else takes a family palette. */
export const MAJOR_POLITY_PIGMENTS: Readonly<Record<string, string>> = {
  rome: "#9E2B25",
  carthage: "#5B2A5E",
  syracuse: "#9A6A2E",
  macedon: "#2F5A8A",
  "ptolemaic-cyrenaica": "#B08A2E",
};
