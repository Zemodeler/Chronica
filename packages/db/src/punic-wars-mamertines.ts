import type { ScenarioHistoricalPressure } from "@chronica/shared";
import { PUNIC_IDS } from "./punic-ids";

/**
 * The dated pressure of 265-264 BCE: how the war with Carthage comes to the door (docs/plans/scenario-notes-war-gaps.md).
 *
 * Nothing here opens a war between Rome and Carthage. Three things the age dated are done by the rules on their days (`a-dated-war.ts`): Hiero II of
 * Syracuse beats the Mamertines at the river Longanus and shuts them up in Messana (c. 265); the Mamertines write to Rome and to Carthage for a protector
 * (264; Polybius 1.10-11); and a Carthaginian garrison goes into the citadel of Messana (264; Polybius 1.11, Diodorus 23.1, Livy's epitome 16). A power
 * hard pressed in a war asks for help of the strong powers near it by rule already (`decideCallsForHelp`), and a request for help from a people at war
 * is a cause of war for the one asked (`theAppealBehind`); a fourth entry is the age's lean on Rome toward Carthage once Carthage is in the strait,
 * which the war score reads as a pull and never a schedule. What Rome then does -- the Senate hesitates, the consul takes the question to the
 * people (Polybius 1.11), the people vote it -- is the rules' own business (`the-appeal-goes-to-the-people.ts`).
 *
 * Days are from the opening (day 0 is 1 March 270 BCE): 1,995 is 16 August 265, 2,210 the first days of March 264 and 2,230 the first week of April 264.
 * Confidence: that Hiero beat the Mamertines at the Longanus in the years about 265-264 (Polybius 1.9), high; its exact year, medium (the
 * lists put it in 265 or 264); that the Mamertines appealed to both powers and that the Carthaginian garrison came first, high (Polybius 1.10-11; Appian
 * and Dio say the garrison was a Carthaginian one under Hanno, put in on the invitation of one party of the Mamertines); the size of the garrison, a guess.
 */
export const MAMERTINE_DATES: readonly ScenarioHistoricalPressure[] = [
  {
    id: "hiero-beats-the-mamertines",
    label: "Hiero beats the Mamertines at the Longanus and shuts them up in Messana",
    kind: "world_event",
    brief: "Hiero II of Syracuse has beaten the Mamertine levy at the river Longanus and shut the survivors up in Messana.",
    weight: 1,
    severity: "serious",
    secret: false,
    oneShot: true,
    when: { politiesExist: ["syracuse", "mamertines"], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 1_995, notAfterDay: 2_900, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "syracuse", provinceId: PUNIC_IDS.messana, otherPolityId: null },
    happens: {
      atDay: 1_995,
      summary: "Hiero of Syracuse beat the Mamertines at the river Longanus, and shut what was left of them up in Messana.",
      warOpens: { polityId: "syracuse", otherPolityId: "mamertines", terms: "Syracuse is at war with the Mamertines of Messana." },
      armyBeaten: { polityId: "mamertines", lossBps: 3_000 },
    },
  },
  {
    id: "messana-asks-rome-and-carthage",
    label: "The Mamertines ask Rome and Carthage for a protector",
    kind: "world_event",
    brief: "The Mamertines of Messana, shut up by Hiero, have written to Rome and to Carthage for help.",
    weight: 1,
    severity: "serious",
    secret: false,
    oneShot: true,
    when: { politiesExist: ["rome", "carthage", "mamertines"], polityHolds: [], atWar: [{ polityId: "syracuse", otherPolityId: "mamertines" }], atPeace: [], notBeforeDay: 2_210, notAfterDay: 3_000, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "mamertines", provinceId: PUNIC_IDS.messana, otherPolityId: null },
    happens: {
      atDay: 2_210,
      summary: "The Mamertines of Messana, hard pressed by Hiero, sent to Rome and to Carthage for help, offering the city to whichever of them would take it under its protection.",
      appeals: { polityId: "mamertines", toPolityIds: ["rome", "carthage"], terms: "The Mamertines are shut up in Messana by Hiero of Syracuse. They ask Rome, and Carthage, to take the city under their protection and to send men." },
    },
  },
  {
    id: "a-carthaginian-garrison-enters-messana",
    label: "A Carthaginian garrison goes into the citadel of Messana",
    kind: "world_event",
    brief: "A party of the Mamertines has let a Carthaginian garrison into the citadel of Messana.",
    weight: 1,
    severity: "grave",
    secret: false,
    oneShot: true,
    when: { politiesExist: ["carthage", "mamertines"], polityHolds: [], atWar: [], atPeace: [], notBeforeDay: 2_230, notAfterDay: 3_000, afterPressureIds: [], forcesPresent: [] },
    target: { polityId: "carthage", provinceId: PUNIC_IDS.messana, otherPolityId: "mamertines" },
    happens: {
      atDay: 2_230,
      summary: "A Carthaginian garrison went into the citadel of Messana, at the call of those of the Mamertines who would have Carthage for a protector, and Hiero drew off.",
      garrisonEnters: { polityId: "carthage", provinceId: PUNIC_IDS.messana, name: "Carthaginian garrison of Messana", men: 1_500, commanderCharacterId: "hannibal-gisco" },
    },
  },
  {
    // The age's lean, not an event: with Carthage in the strait the strongest reason Rome has for a war is what is on the other shore (Polybius 1.10-11:
    // the fear that Carthage, holding Messana, would hold the crossing to Italy). Doubled by the war score, it is a pull; the odds and the moment must allow.
    id: "carthage-in-the-strait",
    label: "Carthage is in the strait, and Rome will not have it across the water from Rhegium",
    kind: "world_event",
    brief: "Carthage holds the citadel of Messana, three miles from the Italian shore.",
    weight: 12,
    severity: "grave",
    secret: false,
    oneShot: false,
    when: {
      politiesExist: ["rome", "carthage", "mamertines"], polityHolds: [], atWar: [], atPeace: [{ polityId: "rome", otherPolityId: "carthage" }], notBeforeDay: 2_230, notAfterDay: 3_300, afterPressureIds: [],
      forcesPresent: [{ polityIds: ["carthage"], provinceId: PUNIC_IDS.messana }],
    },
    target: { polityId: "rome", provinceId: PUNIC_IDS.messana, otherPolityId: "carthage" },
  },
];
