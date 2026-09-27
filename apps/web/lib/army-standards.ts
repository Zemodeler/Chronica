/**
 * The banners an army may carry, shared by the map (which paints them) and the
 * route that lets a commander change one (which must refuse any other).
 *
 * `Force.standardId` holds one of these ids. The engine does not know the
 * catalogue: it stores whatever id it is given, and a force whose id is not
 * here -- or not one its power may carry -- is drawn under its power's first.
 */

export type StandardFaction = "rome" | "carthage" | "gauls" | "syracuse" | "mamertines" | "rhegium-campanians" | "generic";

export interface ArmyStandard {
  readonly id: string;
  readonly factions: readonly StandardFaction[];
  readonly name: string;
  readonly description: string;
  readonly url: string;
  /** Width over height of the painted image, which the map draws it at. */
  readonly aspectRatio: number;
}

/** The painted banners are 600 by 400. */
const PAINTED = 3 / 2;

export const ARMY_STANDARDS = [
  // The first entry for a power is its default. The wolf is one of the five
  // animal signa the legions carried before Marius (Pliny, NH 10.16); the
  // Capricorn and the eagle-and-SPQR banners are imperial and late-Republican.
  { id: "roman-wolf", factions: ["rome"], name: "Wolf signum", description: "Early Roman animal standard", url: "/maps/roman-wolf-signum.png", aspectRatio: PAINTED },
  { id: "legio-i-adiutrix", factions: ["rome"], name: "Capricorn standard", description: "Roman legionary Capricorn emblem", url: "/maps/legio-i-adiutrix-standard.png", aspectRatio: 1 },
  { id: "spqr", factions: ["rome"], name: "SPQR standard", description: "The Roman Senate and People", url: "/maps/roman-spqr-banner.png", aspectRatio: 289 / 229 },
  { id: "eagle", factions: ["rome"], name: "Legion eagle", description: "Gold eagle on crimson", url: "/maps/roman-eagle-banner.png", aspectRatio: PAINTED },
  { id: "laurel", factions: ["rome"], name: "Laurel standard", description: "Victory wreath on deep red", url: "/maps/roman-laurel-banner.png", aspectRatio: PAINTED },
  { id: "roman-boar", factions: ["rome"], name: "Boar signum", description: "Early Roman animal standard", url: "/maps/roman-boar-signum.png", aspectRatio: PAINTED },
  { id: "roman-minotaur", factions: ["rome"], name: "Minotaur signum", description: "Early Roman animal standard", url: "/maps/roman-minotaur-signum.png", aspectRatio: PAINTED },
  { id: "roman-horse", factions: ["rome"], name: "Horse signum", description: "Early Roman animal standard", url: "/maps/roman-horse-signum.png", aspectRatio: PAINTED },
  { id: "roman-fasces", factions: ["rome"], name: "Fasces vexillum", description: "Roman civic emblem on a reconstructed banner", url: "/maps/roman-fasces-vexillum.png", aspectRatio: PAINTED },
  { id: "roman-victory", factions: ["rome"], name: "Victory vexillum", description: "Roman Victoria motif on a reconstructed banner", url: "/maps/roman-victory-vexillum.png", aspectRatio: PAINTED },
  { id: "roman-wolf-twins", factions: ["rome"], name: "She-wolf and twins", description: "The wolf suckling Romulus and Remus, as on Rome's first silver", url: "/maps/roman-wolf-twins-standard.png", aspectRatio: PAINTED },
  { id: "roman-horse-ear", factions: ["rome"], name: "Horse and grain ear", description: "Horse head and ear of wheat from the Romano-Campanian didrachm", url: "/maps/roman-horse-ear-standard.png", aspectRatio: PAINTED },
  { id: "roman-taras", factions: ["rome"], name: "Taras on the dolphin", description: "Tarentum's founder, from the coinage of Rome's newest ally", url: "/maps/roman-taras-standard.png", aspectRatio: PAINTED },
  { id: "carthage-tanit", factions: ["carthage"], name: "Sign of Tanit", description: "Punic religious symbol attested on stelae", url: "/maps/carthaginian-tanit-standard.png", aspectRatio: PAINTED },
  { id: "carthage-horse", factions: ["carthage"], name: "Punic horse", description: "Horse motif attested on Carthaginian coinage", url: "/maps/carthaginian-horse-standard.png", aspectRatio: PAINTED },
  { id: "carthage-palm", factions: ["carthage"], name: "Punic palm", description: "Palm motif from Punic coin imagery", url: "/maps/carthaginian-palm-standard.png", aspectRatio: PAINTED },
  { id: "carthage-crescent", factions: ["carthage"], name: "Crescent and disk", description: "Punic celestial motif on a reconstructed vexillum", url: "/maps/carthaginian-crescent-standard.png", aspectRatio: PAINTED },
  { id: "carthage-elephant", factions: ["carthage"], name: "Punic elephant", description: "War elephant motif attested in Punic warfare", url: "/maps/carthaginian-elephant-standard.png", aspectRatio: PAINTED },
  { id: "carthage-solar-disk", factions: ["carthage"], name: "Punic solar disk", description: "Solar emblem on a reconstructed Punic banner", url: "/maps/carthaginian-solar-disk-standard.png", aspectRatio: PAINTED },
  { id: "carthage-horse-head", factions: ["carthage"], name: "Punic horse head", description: "Horse-head motif attested on Carthaginian coinage", url: "/maps/carthaginian-horse-head-standard.png", aspectRatio: PAINTED },
  { id: "carthage-palm-disk", factions: ["carthage"], name: "Palm and disk", description: "Punic palm and celestial imagery", url: "/maps/carthaginian-palm-disk-standard.png", aspectRatio: PAINTED },
  { id: "syracusan-horseman", factions: ["syracuse"], name: "Syracusan horseman", description: "Charging cavalryman from the coinage of Hieron II", url: "/maps/syracusan-horseman-standard.png", aspectRatio: PAINTED },
  { id: "syracusan-trident", factions: ["syracuse"], name: "Trident and dolphins", description: "Poseidon's trident between dolphins, a Syracusan sea emblem", url: "/maps/syracusan-trident-standard.png", aspectRatio: PAINTED },
  { id: "mamertine-eagle", factions: ["mamertines"], name: "Eagle on the thunderbolt", description: "Zeus's eagle from the Mamertine coinage of Messana", url: "/maps/mamertine-eagle-standard.png", aspectRatio: PAINTED },
  { id: "campanian-bull", factions: ["rhegium-campanians"], name: "Man-headed bull", description: "The Campanian river-bull, carried by the legion that took Rhegium", url: "/maps/campanian-bull-standard.png", aspectRatio: PAINTED },
  { id: "hellenic-owl", factions: ["generic"], name: "Hellenic owl", description: "Athena's owl, widely attested in Greek civic imagery", url: "/maps/generic-hellenic-owl-standard.png", aspectRatio: PAINTED },
  { id: "macedonian-sun", factions: ["generic"], name: "Macedonian sun", description: "Argead star emblem", url: "/maps/generic-macedonian-sun-standard.png", aspectRatio: PAINTED },
  { id: "hellenic-gorgon", factions: ["generic"], name: "Gorgon emblem", description: "Apotropaic Hellenic shield motif", url: "/maps/generic-gorgon-standard.png", aspectRatio: PAINTED },
  { id: "merchant-ship", factions: ["generic"], name: "Merchant ship", description: "Mediterranean maritime standard", url: "/maps/generic-merchant-ship-standard.png", aspectRatio: PAINTED },
  { id: "syracusan-dolphin", factions: ["generic"], name: "Syracusan dolphin", description: "Dolphin imagery from Syracusan coinage", url: "/maps/generic-syracusan-dolphin-standard.png", aspectRatio: PAINTED },
  { id: "corinthian-pegasus", factions: ["generic"], name: "Corinthian Pegasus", description: "Pegasus motif from Corinthian coinage", url: "/maps/generic-corinthian-pegasus-standard.png", aspectRatio: PAINTED },
  { id: "spartan-lambda", factions: ["generic"], name: "Spartan lambda", description: "Lacedaemonian shield emblem", url: "/maps/generic-spartan-lambda-standard.png", aspectRatio: PAINTED },
  { id: "samnite-bull", factions: ["generic"], name: "Samnite bull", description: "Italic bull motif from regional coinage", url: "/maps/generic-samnite-bull-standard.png", aspectRatio: PAINTED },
  { id: "numidian-horse", factions: ["generic"], name: "Numidian horse", description: "North African cavalry motif", url: "/maps/generic-numidian-horse-standard.png", aspectRatio: PAINTED },
  { id: "iberian-horseman", factions: ["generic"], name: "Iberian horseman", description: "Horseman motif from Iberian coinage", url: "/maps/generic-iberian-horseman-standard.png", aspectRatio: PAINTED },
  { id: "sicilian-triskelion", factions: ["generic"], name: "Sicilian triskelion", description: "Ancient Sicilian three-legged emblem", url: "/maps/generic-sicilian-triskelion-standard.png", aspectRatio: PAINTED },
  { id: "etruscan-sphinx", factions: ["generic"], name: "Etruscan sphinx", description: "Etruscan decorative motif on a reconstructed banner", url: "/maps/generic-etruscan-sphinx-standard.png", aspectRatio: PAINTED },
  { id: "gallic-boar", factions: ["gauls"], name: "Gallic boar", description: "Celtic boar standard based on surviving martial imagery", url: "/maps/gallic-boar-standard.png", aspectRatio: PAINTED },
  { id: "gallic-carnyx", factions: ["gauls"], name: "Gallic carnyx", description: "War-horn standard inspired by Celtic carnyces", url: "/maps/gallic-carnyx-standard.png", aspectRatio: PAINTED },
] as const satisfies readonly ArmyStandard[];

export type ArmyStandardId = (typeof ARMY_STANDARDS)[number]["id"];

const FALLBACK = ARMY_STANDARDS.find((standard) => standard.id === "merchant-ship")!;

/** Every banner this power's armies may carry: its own, then the common ones. */
export function standardsForPolity(polityId: string): readonly ArmyStandard[] {
  return ARMY_STANDARDS.filter((standard) => {
    const factions: readonly string[] = standard.factions;
    return factions.includes(polityId) || factions.includes("generic");
  });
}

export function defaultStandardForPolity(polityId: string): ArmyStandard {
  return standardsForPolity(polityId)[0] ?? FALLBACK;
}

/** The banner a force of this power is drawn under, given what its record says it carries. */
export function standardFor(polityId: string, standardId: string | undefined): ArmyStandard {
  return standardsForPolity(polityId).find((standard) => standard.id === standardId) ?? defaultStandardForPolity(polityId);
}
