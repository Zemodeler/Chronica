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
  readonly kind: "army" | "navy";
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
  { kind: "army", id: "roman-wolf", factions: ["rome"], name: "Wolf signum", description: "Early Roman animal standard", url: "/maps/roman-wolf-signum.png", aspectRatio: PAINTED },
  { kind: "army", id: "legio-i-adiutrix", factions: ["rome"], name: "Capricorn standard", description: "Roman legionary Capricorn emblem", url: "/maps/legio-i-adiutrix-standard.png", aspectRatio: 1 },
  { kind: "army", id: "spqr", factions: ["rome"], name: "SPQR standard", description: "The Roman Senate and People", url: "/maps/roman-spqr-banner.png", aspectRatio: 289 / 229 },
  { kind: "army", id: "eagle", factions: ["rome"], name: "Legion eagle", description: "Gold eagle on crimson", url: "/maps/roman-eagle-banner.png", aspectRatio: PAINTED },
  { kind: "army", id: "laurel", factions: ["rome"], name: "Laurel standard", description: "Victory wreath on deep red", url: "/maps/roman-laurel-banner.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-boar", factions: ["rome"], name: "Boar signum", description: "Early Roman animal standard", url: "/maps/roman-boar-signum.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-minotaur", factions: ["rome"], name: "Minotaur signum", description: "Early Roman animal standard", url: "/maps/roman-minotaur-signum.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-horse", factions: ["rome"], name: "Horse signum", description: "Early Roman animal standard", url: "/maps/roman-horse-signum.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-fasces", factions: ["rome"], name: "Fasces vexillum", description: "Roman civic emblem on a reconstructed banner", url: "/maps/roman-fasces-vexillum.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-victory", factions: ["rome"], name: "Victory vexillum", description: "Roman Victoria motif on a reconstructed banner", url: "/maps/roman-victory-vexillum.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-wolf-twins", factions: ["rome"], name: "She-wolf and twins", description: "The wolf suckling Romulus and Remus, as on Rome's first silver", url: "/maps/roman-wolf-twins-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-horse-ear", factions: ["rome"], name: "Horse and grain ear", description: "Horse head and ear of wheat from the Romano-Campanian didrachm", url: "/maps/roman-horse-ear-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "roman-taras", factions: ["rome"], name: "Taras on the dolphin", description: "Tarentum's founder, from the coinage of Rome's newest ally", url: "/maps/roman-taras-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-tanit", factions: ["carthage"], name: "Sign of Tanit", description: "Punic religious symbol attested on stelae", url: "/maps/carthaginian-tanit-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-horse", factions: ["carthage"], name: "Punic horse", description: "Horse motif attested on Carthaginian coinage", url: "/maps/carthaginian-horse-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-palm", factions: ["carthage"], name: "Punic palm", description: "Palm motif from Punic coin imagery", url: "/maps/carthaginian-palm-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-crescent", factions: ["carthage"], name: "Crescent and disk", description: "Punic celestial motif on a reconstructed vexillum", url: "/maps/carthaginian-crescent-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-elephant", factions: ["carthage"], name: "Punic elephant", description: "War elephant motif attested in Punic warfare", url: "/maps/carthaginian-elephant-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-solar-disk", factions: ["carthage"], name: "Punic solar disk", description: "Solar emblem on a reconstructed Punic banner", url: "/maps/carthaginian-solar-disk-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-horse-head", factions: ["carthage"], name: "Punic horse head", description: "Horse-head motif attested on Carthaginian coinage", url: "/maps/carthaginian-horse-head-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "carthage-palm-disk", factions: ["carthage"], name: "Palm and disk", description: "Punic palm and celestial imagery", url: "/maps/carthaginian-palm-disk-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "syracusan-horseman", factions: ["syracuse"], name: "Syracusan horseman", description: "Charging cavalryman from the coinage of Hieron II", url: "/maps/syracusan-horseman-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "syracusan-trident", factions: ["syracuse"], name: "Trident and dolphins", description: "Poseidon's trident between dolphins, a Syracusan sea emblem", url: "/maps/syracusan-trident-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "mamertine-eagle", factions: ["mamertines"], name: "Eagle on the thunderbolt", description: "Zeus's eagle from the Mamertine coinage of Messana", url: "/maps/mamertine-eagle-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "campanian-bull", factions: ["rhegium-campanians"], name: "Man-headed bull", description: "The Campanian river-bull, carried by the legion that took Rhegium", url: "/maps/campanian-bull-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "hellenic-owl", factions: ["generic"], name: "Hellenic owl", description: "Athena's owl, widely attested in Greek civic imagery", url: "/maps/generic-hellenic-owl-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "macedonian-sun", factions: ["generic"], name: "Macedonian sun", description: "Argead star emblem", url: "/maps/generic-macedonian-sun-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "hellenic-gorgon", factions: ["generic"], name: "Gorgon emblem", description: "Apotropaic Hellenic shield motif", url: "/maps/generic-gorgon-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "merchant-ship", factions: ["generic"], name: "Merchant ship", description: "Mediterranean maritime standard", url: "/maps/generic-merchant-ship-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "syracusan-dolphin", factions: ["generic"], name: "Syracusan dolphin", description: "Dolphin imagery from Syracusan coinage", url: "/maps/generic-syracusan-dolphin-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "corinthian-pegasus", factions: ["generic"], name: "Corinthian Pegasus", description: "Pegasus motif from Corinthian coinage", url: "/maps/generic-corinthian-pegasus-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "spartan-lambda", factions: ["generic"], name: "Spartan lambda", description: "Lacedaemonian shield emblem", url: "/maps/generic-spartan-lambda-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "samnite-bull", factions: ["generic"], name: "Samnite bull", description: "Italic bull motif from regional coinage", url: "/maps/generic-samnite-bull-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "numidian-horse", factions: ["generic"], name: "Numidian horse", description: "North African cavalry motif", url: "/maps/generic-numidian-horse-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "iberian-horseman", factions: ["generic"], name: "Iberian horseman", description: "Horseman motif from Iberian coinage", url: "/maps/generic-iberian-horseman-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "sicilian-triskelion", factions: ["generic"], name: "Sicilian triskelion", description: "Ancient Sicilian three-legged emblem", url: "/maps/generic-sicilian-triskelion-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "etruscan-sphinx", factions: ["generic"], name: "Etruscan sphinx", description: "Etruscan decorative motif on a reconstructed banner", url: "/maps/generic-etruscan-sphinx-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "gallic-boar", factions: ["gauls"], name: "Gallic boar", description: "Celtic boar standard based on surviving martial imagery", url: "/maps/gallic-boar-standard.png", aspectRatio: PAINTED },
  { kind: "army", id: "gallic-carnyx", factions: ["gauls"], name: "Gallic carnyx", description: "War-horn standard inspired by Celtic carnyces", url: "/maps/gallic-carnyx-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-roman-corvus", factions: ["rome"], name: "Corvus quinquereme", description: "Roman warship with its boarding bridge raised", url: "/maps/roman-navy-corvus-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-roman-rostra", factions: ["rome"], name: "Rostrum and dolphin", description: "Bronze ship's ram beneath a dolphin", url: "/maps/roman-navy-rostra-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-roman-neptune", factions: ["rome"], name: "Neptune's trident", description: "Trident, dolphin, and waves", url: "/maps/roman-navy-neptune-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-roman-duilius", factions: ["rome"], name: "Duilius's rostral column", description: "Victory atop the column of captured ship's rams", url: "/maps/roman-navy-duilius-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-punic-warship", factions: ["carthage"], name: "Punic warship", description: "Carthaginian galley with a horse-head stern", url: "/maps/carthaginian-navy-warship-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-punic-tanit-prow", factions: ["carthage"], name: "Tanit and prow", description: "Sign of Tanit above a rammed prow", url: "/maps/carthaginian-navy-tanit-prow-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-punic-hippocamp", factions: ["carthage"], name: "Punic hippocamp", description: "Rearing sea-horse above waves", url: "/maps/carthaginian-navy-hippocamp-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-punic-melqart-ship", factions: ["carthage"], name: "Melqart's ship", description: "Phoenician merchant galley beneath the sun", url: "/maps/carthaginian-navy-melqart-ship-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-syracusan-arethusa", factions: ["syracuse"], name: "Arethusa and dolphins", description: "Syracusan nymph encircled by dolphins", url: "/maps/syracusan-navy-arethusa-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-syracusan-tetrareme", factions: ["syracuse"], name: "Syracusan tetrareme", description: "Greek warship beneath a trident", url: "/maps/syracusan-navy-tetrareme-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-athenian-trireme", factions: ["generic"], name: "Athenian trireme", description: "Three-banked warship with Athena's owl", url: "/maps/generic-navy-athenian-trireme-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-rhodian-sun", factions: ["generic"], name: "Rhodian sun", description: "Helios and the rose of Rhodes", url: "/maps/generic-navy-rhodian-sun-standard.png", aspectRatio: PAINTED },
  { kind: "navy", id: "navy-massaliot-lion-prow", factions: ["generic"], name: "Massaliot lion prow", description: "Lion-headed ram with a dolphin", url: "/maps/generic-navy-massaliot-lion-prow-standard.png", aspectRatio: PAINTED },
] as const satisfies readonly ArmyStandard[];

export type ArmyStandardId = (typeof ARMY_STANDARDS)[number]["id"];

/** Every banner a force of this kind may carry: its own, then the common ones. */
export function standardsForPolity(polityId: string, kind: ArmyStandard["kind"]): readonly ArmyStandard[] {
  return ARMY_STANDARDS.filter((standard) => {
    const factions: readonly string[] = standard.factions;
    return standard.kind === kind && (factions.includes(polityId) || factions.includes("generic"));
  });
}

export function defaultStandardFor(polityId: string, kind: ArmyStandard["kind"]): ArmyStandard {
  return ARMY_STANDARDS.find((standard) => standard.kind === kind && (standard.factions as readonly string[]).includes(polityId))
    ?? ARMY_STANDARDS.find((standard) => standard.kind === kind && (standard.factions as readonly string[]).includes("generic"))!;
}

/** The banner a force of this power is drawn under, given what its record says it carries. */
export function standardFor(polityId: string, kind: ArmyStandard["kind"], standardId: string | undefined): ArmyStandard {
  return standardsForPolity(polityId, kind).find((standard) => standard.id === standardId) ?? defaultStandardFor(polityId, kind);
}
