import type { PUNIC_WARS_GRAPH_SETTLEMENTS } from "./punic-wars-map-graph";

/**
 * Ostia, Rome's harbour at the mouth of the Tiber.
 *
 * The province that holds Rome ("Latium on the Almo") was an inland hill country with no port, so no venture could sail from Rome by sea (`hasPort`), and a
 * Roman merchant's first cargo went by land at a land's price. Ostia is Rome's own harbour in the age these games open in: the *castrum* at the river's mouth
 * is dated by excavation and by the tradition of Livy to about 349-338 BCE (the tradition that Ancus Marcius founded it, in the seventh century, is legend:
 * the earliest remains are of the fourth century), a small fortified colony of citizens that watched the mouth of the river and landed Rome's grain
 * and salt. It is placed in Rome's own province, as a port of its own, thirteen kilometres from the city: the map's separate province of the Numicus coast is
 * the country round it, not the town. Confidence: the castrum's date medium (about 349-338), its being Rome's port by 270 high (Livy 27.38 has the
 * coastal colonies of citizens, Ostia among them, claiming their exemption from service in 207), its size a guess.
 */
export const OSTIA_SETTLEMENTS: readonly (typeof PUNIC_WARS_GRAPH_SETTLEMENTS)[number][] = [
  { id: "settlement-ostia", name: "Ostia", kind: "port", provinceId: "it-l865w", controllerPolityId: "rome", size: 3, fortificationLevel: 2 },
];
