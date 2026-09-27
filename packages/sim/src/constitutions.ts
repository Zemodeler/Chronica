import {
  ALL_CHAMBER_POWERS,
  GOVERNMENT_FORM_IN_WORDS,
  allOffices,
  allSuccessionRules,
  boundedId,
  childrenOf,
  currentAgeYears,
  familyLinksOf,
  inferredGovernmentForm,
  isMagistracy,
  seatCharacterInOffice,
  stableHash,
  vacateOfficeOf,
  type BlocInterest,
  type ChamberPower,
  type Character,
  type Constitution,
  type ConstitutionAmendment,
  type ConstitutionOrigin,
  type FactProposalDraft,
  type Franchise,
  type GovernmentForm,
  type GovernmentInstitution,
  type Office,
  type PoliticalGroup,
  type Polity,
  type SuccessionRule,
  type VotingBloc,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Every power's government, as parts that can change.
 *
 * Only Rome had chambers. Every other power's questions could not be put to a
 * vote at all, a king who died was never followed by anybody, and no
 * government could become a different kind of government -- whatever was
 * said about a revolution in Syracuse, Syracuse went on having a king's
 * offices and no others.
 *
 * So a power's constitution is now its parts: chambers and what each may
 * decide, offices and how each is filled, who sits where. A form word seeds
 * them, once, the first time the world is reviewed; after that the parts are
 * the truth and the form is read back from them (`readForm`). A major power's
 * parts are authored in its scenario, where history knows them; a minor one's
 * are grown from its form's template, varied by a seed so that no two
 * confederations are the same.
 *
 * And they change: by a measure carried or a ruler's decree (`amend`), by force
 * (`recast`, from `regime.ts`), and by a line of kings dying out
 * (`keepThrones`).
 */

// What an office may do, in the world's own ops -- the scenario's four grades.
const CIVIL = ["social_events", "belief_set", "character_intent_set", "political_procedure_open", "political_support_set"];
const MAGISTRATE = [...CIVIL, "project_create", "project_milestone_update", "generic_entity_create", "generic_entity_update", "province_material_shift", "legitimacy_shift"];
const IMPERIUM = [...MAGISTRATE, "force_create", "force_modify", "force_engage", "political_procedure_resolve", "authority_grant_upsert", "character_create", "polity_stance_shift"];
const RULER = [...IMPERIUM];
const GRADES = { civil: CIVIL, magistrate: MAGISTRATE, imperium: IMPERIUM, ruler: RULER } as const;

/** Legitimacy a chamber starts with: earned, not given. One set up by force starts lower still. */
const NEW_CHAMBER_LEGITIMACY_BPS = { lawful: 5_000, forced: 3_000 } as const;
/** How long an empty throne waits for somebody to claim it before its council takes the choosing on. */
export const EMPTY_THRONE_DAYS = 60;
/** Below this age an heir reigns through a regent, and the regency is an opening. */
const MAJORITY_YEARS = 16;

interface BlocSpec {
  readonly key: string;
  readonly name: string;
  readonly interest: string;
  readonly interests: readonly BlocInterest[];
  readonly weight: number;
  readonly baseSupport: number;
}

interface ChamberSpec {
  readonly key: string;
  readonly name: string;
  readonly powers: readonly ChamberPower[];
  readonly advisory: boolean;
  readonly franchise: Franchise;
  readonly blocs: readonly BlocSpec[];
  readonly quorumBps: number;
  readonly passageThresholdBps: number;
  readonly denominator: "total" | "present" | "cast";
  /** A chamber key: where a rejected magistrate's question goes next. */
  readonly refersTo?: string;
}

interface OfficeSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: "magistracy" | "membership" | "priesthood";
  readonly grade: keyof typeof GRADES;
  readonly rank?: number;
  readonly seatCount?: number;
  readonly termDays?: number;
  readonly succession: { readonly kind: SuccessionRule["kind"]; readonly chamberKey: string | null; readonly label: string };
  readonly enrolsFormerMagistrates?: boolean;
  readonly treasury?: boolean;
}

export interface ConstitutionTemplate {
  readonly form: GovernmentForm;
  readonly chambers: readonly ChamberSpec[];
  readonly offices: readonly OfficeSpec[];
  /** The office that is head of state. */
  readonly rulerKey: string | null;
}

/** A seeded pick: the same power always draws the same name, and two powers rarely do. */
const pick = <T,>(seed: readonly (string | number)[], options: readonly T[]): T => options[stableHash(seed) % options.length]!;
/** A seeded integer in [low, high]. */
const between = (seed: readonly (string | number)[], low: number, high: number): number => low + (stableHash(seed) % (high - low + 1));
/** A seeded coin, true with the given chance in a hundred. */
const chance = (seed: readonly (string | number)[], inHundred: number): boolean => stableHash(seed) % 100 < inHundred;

/**
 * A power's name as a sentence would say it: "Carthage", "the Boii", "the
 * Roman Republic", "the Kingdom of Syracuse". A name of several words is
 * always a thing with an article; a single word is a city unless it is plainly
 * a people's plural.
 */
export function polityPhrase(name: string): string {
  if (/^the\s/iu.test(name)) return name;
  if (/\s/u.test(name.trim())) return `the ${name}`;
  return /(i|ae|ians|ites|ntes|res)$/u.test(name) ? `the ${name}` : name;
}

/** "of the Boii", "of Carthage" -- the way an office of the power would be styled, without "the Kingdom of". */
function ofName(polity: Polity): string {
  return `of ${polityPhrase(polity.name.replace(/^(the\s+)?kingdom\s+of\s+/iu, ""))}`;
}

/**
 * A form's parts for one power, with its seed's variety in them.
 *
 * The same power and form always give the same parts -- they are a function
 * of the world, not a roll -- and the seed moves what history would have
 * varied: what a council is called, how many sit in it, whether a king keeps
 * an assembly, whether a league's general serves one year or two.
 */
export function templateFor(polity: Polity, form: GovernmentForm): ConstitutionTemplate {
  const s = (part: string): readonly (string | number)[] => [polity.id, form, part];
  const of = ofName(polity);
  const lean = (part: string, base: number): number => base + between(s(`lean:${part}`), -8, 8);
  const weigh = (part: string, base: number): number => Math.max(5, base + between(s(`weight:${part}`), -10, 10));
  const bloc = (key: string, name: string, interest: string, interests: readonly BlocInterest[], weight: number, baseSupport: number): BlocSpec =>
    ({ key, name, interest, interests, weight: weigh(key, weight), baseSupport: lean(key, baseSupport) });
  const priest = (succession: OfficeSpec["succession"]): OfficeSpec =>
    ({ key: "priest", label: `Priest ${of}`, kind: "priesthood", grade: "civil", seatCount: between(s("priests"), 3, 12), succession });

  switch (form) {
    case "monarchy": {
      const title = pick(s("title"), ["King", "Prince", "Lord"]);
      const keepsAssembly = chance(s("assembly"), 45);
      const council: ChamberSpec = {
        key: "council", name: pick(s("council"), ["Royal Council", "Council of the King's Friends", "Council of the Court"]),
        powers: ALL_CHAMBER_POWERS, advisory: true, franchise: "council",
        blocs: [bloc("friends", "The king's friends", "the crown", ["crown"], 40, 20), bloc("houses", "The great houses", "the nobility", ["nobles", "landed"], 60, 0)],
        quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "cast",
      };
      const assembly: ChamberSpec = {
        key: "assembly", name: pick(s("assembly-name"), ["Assembly of the People", "Gathering of the Freemen"]),
        powers: ["war", "laws"], advisory: true, franchise: "citizens",
        blocs: [bloc("people", "The people", "the common people", ["commons"], 100, 0)],
        quorumBps: 4_000, passageThresholdBps: 5_001, denominator: "cast",
      };
      return {
        form, rulerKey: "ruler",
        chambers: keepsAssembly ? [council, assembly] : [council],
        offices: [
          { key: "ruler", label: `${title} ${of}`, kind: "magistracy", grade: "ruler", rank: 3, treasury: true, succession: { kind: "primogeniture", chamberKey: null, label: "Hereditary succession" } },
          { key: "councillor", label: `Councillor ${of}`, kind: "membership", grade: "civil", seatCount: between(s("councillors"), 10, 30), succession: { kind: "appointment", chamberKey: null, label: "Named by the ruler" } },
          { key: "general", label: `General ${of}`, kind: "magistracy", grade: "imperium", rank: 2, seatCount: between(s("generals"), 1, 3), succession: { kind: "appointment", chamberKey: null, label: "Named by the ruler" } },
          priest({ kind: "appointment", chamberKey: null, label: "Named by the ruler" }),
        ],
      };
    }
    case "oligarchic_republic": {
      const pair = chance(s("pair"), 70);
      const referral = chance(s("referral"), 50);
      return {
        form, rulerKey: "magistrate",
        chambers: [
          {
            key: "council", name: pick(s("council"), ["Council of Elders", "Great Council", "Council of the Hundred", "Gerousia"]),
            powers: ["laws", "war", "taxes", "constitution", "judgment"], advisory: false, franchise: "council",
            blocs: [bloc("old-houses", "The old houses", "the nobility", ["nobles", "landed"], 55, 15), bloc("new-men", "The new men", "the merchants", ["merchants"], 45, 0)],
            quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "present",
            ...(referral ? { refersTo: "assembly" } : {}),
          },
          {
            key: "assembly", name: pick(s("assembly"), ["Assembly of Citizens", "Popular Assembly", "Assembly of the People"]),
            powers: referral ? ["elections", "laws", "war"] : ["elections"], advisory: false, franchise: "citizens",
            blocs: [bloc("propertied", "The propertied", "the landowners", ["landed"], 60, 5), bloc("poorer", "The poorer citizens", "the common people", ["commons"], 40, -5)],
            quorumBps: 4_000, passageThresholdBps: 5_001, denominator: "cast",
          },
        ],
        offices: [
          { key: "magistrate", label: `${pick(s("magistrate"), ["Chief magistrate", "Archon", "Prytanis"])} ${of}`, kind: "magistracy", grade: "imperium", rank: 2, seatCount: pair ? 2 : 1, termDays: 365, treasury: true, succession: { kind: "elective", chamberKey: "assembly", label: "Elected by the citizens" } },
          { key: "treasurer", label: `Treasurer ${of}`, kind: "magistracy", grade: "magistrate", rank: 1, seatCount: between(s("treasurers"), 1, 4), termDays: 365, treasury: true, succession: { kind: "elective", chamberKey: "assembly", label: "Elected by the citizens" } },
          { key: "councillor", label: `Elder ${of}`, kind: "membership", grade: "civil", seatCount: between(s("elders"), 30, 120), enrolsFormerMagistrates: true, succession: { kind: "elective", chamberKey: "council", label: "Chosen by the council" } },
          priest({ kind: "elective", chamberKey: "council", label: "Chosen by the council" }),
        ],
      };
    }
    case "popular_republic": {
      const generals = between(s("generals"), 3, 10);
      return {
        form, rulerKey: "general",
        chambers: [
          {
            key: "assembly", name: pick(s("assembly"), ["Assembly of the People", "Ekklesia", "Assembly of Citizens"]),
            powers: ALL_CHAMBER_POWERS, advisory: false, franchise: "citizens",
            blocs: [bloc("propertied", "The propertied", "the landowners and merchants", ["landed", "merchants"], 40, 5), bloc("people", "The common people", "the common people", ["commons"], 60, 0)],
            quorumBps: 3_000, passageThresholdBps: 5_001, denominator: "cast",
          },
          {
            key: "council", name: pick(s("council"), ["Council", "Boule", "Council of Five Hundred"]),
            powers: ["judgment", "taxes"], advisory: false, franchise: "council",
            blocs: [bloc("councillors", "The councillors", "the well-to-do", ["merchants", "landed"], 100, 5)],
            quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "present",
          },
        ],
        offices: [
          { key: "general", label: `${pick(s("general"), ["General", "Strategos"])} ${of}`, kind: "magistracy", grade: "imperium", rank: 2, seatCount: generals, termDays: 365, treasury: true, succession: { kind: "elective", chamberKey: "assembly", label: "Elected by the people" } },
          { key: "magistrate", label: `Magistrate ${of}`, kind: "magistracy", grade: "magistrate", rank: 1, seatCount: between(s("magistrates"), 3, 9), termDays: 365, succession: { kind: "elective", chamberKey: "assembly", label: "Elected by the people" } },
          { key: "councillor", label: `Councillor ${of}`, kind: "membership", grade: "civil", seatCount: between(s("council-size"), 50, 500), termDays: 365, succession: { kind: "elective", chamberKey: "assembly", label: "Chosen by lot from the citizens" } },
          priest({ kind: "elective", chamberKey: "assembly", label: "Elected by the people" }),
        ],
      };
    }
    case "tribal_confederation": {
      const forLife = chance(s("for-life"), 55);
      const warriors = chance(s("warriors"), 50);
      const gathering: ChamberSpec = {
        key: "gathering", name: pick(s("gathering"), ["Gathering of the Chiefs", "Council of the Tribes", "Moot of the Chieftains"]),
        powers: ALL_CHAMBER_POWERS, advisory: false, franchise: "chiefs",
        blocs: [bloc("war-band", "The war-bands", "the warriors", ["soldiers"], 30, 10)],
        // Near-unanimity: a gathering that outvotes a tribe does not bind it.
        quorumBps: 6_000, passageThresholdBps: between(s("unanimity"), 6_000, 7_500), denominator: "present",
      };
      const host: ChamberSpec = {
        key: "host", name: pick(s("host"), ["Assembly of the Warriors", "Host in Arms"]),
        powers: ["war", "elections"], advisory: true, franchise: "soldiers",
        blocs: [bloc("young", "The young warriors", "the warriors", ["soldiers"], 100, 15)],
        quorumBps: 3_000, passageThresholdBps: 5_001, denominator: "cast",
      };
      return {
        form, rulerKey: "ruler",
        chambers: warriors ? [gathering, host] : [gathering],
        offices: [
          { key: "ruler", label: `${pick(s("title"), ["High chieftain", "War-king", "First chief"])} ${of}`, kind: "magistracy", grade: "ruler", rank: 2, ...(forLife ? {} : { termDays: 365 }), treasury: true, succession: { kind: "elective", chamberKey: "gathering", label: "Chosen by the chiefs" } },
          { key: "councillor", label: `Chief ${of}`, kind: "membership", grade: "civil", seatCount: between(s("chiefs"), 8, 40), succession: { kind: "seniority", chamberKey: null, label: "The eldest of his house" } },
          priest({ kind: "seniority", chamberKey: null, label: "The eldest of the order" }),
        ],
      };
    }
    case "soldier_commune": {
      const annual = chance(s("annual"), 60);
      return {
        form, rulerKey: "ruler",
        chambers: [
          {
            key: "assembly", name: pick(s("assembly"), ["Assembly of the Soldiers", "Assembly of the Company", "Host in Assembly"]),
            powers: ALL_CHAMBER_POWERS, advisory: false, franchise: "soldiers",
            blocs: [bloc("old-hands", "The old hands", "the veterans", ["soldiers", "veterans"], 60, 10), bloc("young", "The younger men", "the soldiers", ["soldiers"], 40, 5)],
            quorumBps: 4_000, passageThresholdBps: 5_001, denominator: "cast",
          },
          {
            key: "council", name: pick(s("council"), ["Council of Captains", "Council of Officers"]),
            powers: ALL_CHAMBER_POWERS, advisory: true, franchise: "council",
            blocs: [bloc("captains", "The captains", "the officers", ["soldiers"], 100, 5)],
            quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "present",
          },
        ],
        offices: [
          { key: "ruler", label: `${pick(s("title"), ["Leader", "Meddix", "Captain-general"])} ${of}`, kind: "magistracy", grade: "ruler", rank: 2, ...(annual ? { termDays: 365 } : {}), treasury: true, succession: { kind: "elective", chamberKey: "assembly", label: "Acclaimed by the soldiers" } },
          { key: "councillor", label: `Captain ${of}`, kind: "membership", grade: "civil", seatCount: between(s("captains"), 8, 20), succession: { kind: "elective", chamberKey: "assembly", label: "Acclaimed by the soldiers" } },
          priest({ kind: "appointment", chamberKey: null, label: "Named by the leader" }),
        ],
      };
    }
    case "league": {
      const twoYears = chance(s("two-years"), 30);
      return {
        form, rulerKey: "ruler",
        chambers: [
          {
            key: "synod", name: pick(s("synod"), ["Synod of the League", "Federal Assembly", "Council of the Cities"]),
            powers: ALL_CHAMBER_POWERS, advisory: false, franchise: "cities",
            blocs: [bloc("federal", "The federal party", "the league's officers", ["nobles"], 30, 10)],
            quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "present",
          },
          {
            key: "council", name: pick(s("council"), ["Federal Council", "Council of Magistrates"]),
            powers: ["laws", "taxes", "judgment"], advisory: false, franchise: "council",
            blocs: [bloc("magistrates", "The magistrates of the cities", "the nobility", ["nobles", "landed"], 100, 5)],
            quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "present",
          },
        ],
        offices: [
          { key: "ruler", label: `${pick(s("title"), ["Strategos", "President", "Meddix tuticus"])} ${of}`, kind: "magistracy", grade: "imperium", rank: 2, termDays: twoYears ? 730 : 365, treasury: true, succession: { kind: "elective", chamberKey: "synod", label: "Elected by the league" } },
          { key: "hipparch", label: `Commander of horse ${of}`, kind: "magistracy", grade: "imperium", rank: 1, termDays: 365, succession: { kind: "elective", chamberKey: "synod", label: "Elected by the league" } },
          { key: "councillor", label: `Delegate ${of}`, kind: "membership", grade: "civil", seatCount: between(s("delegates"), 20, 60), succession: { kind: "appointment", chamberKey: null, label: "Sent by his city" } },
          priest({ kind: "elective", chamberKey: "synod", label: "Elected by the league" }),
        ],
      };
    }
    case "temple_state": {
      return {
        form, rulerKey: "ruler",
        chambers: [
          {
            key: "college", name: pick(s("college"), ["College of Priests", "Council of the Temple"]),
            powers: ALL_CHAMBER_POWERS, advisory: false, franchise: "priests",
            blocs: [bloc("senior", "The senior priests", "the priesthood", ["priests"], 60, 10), bloc("estates", "The temple's landholders", "the temple lands", ["priests", "landed"], 40, 0)],
            quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "present",
          },
          {
            key: "faithful", name: pick(s("faithful"), ["Assembly of the Faithful", "Gathering at the Temple"]),
            powers: ["laws"], advisory: true, franchise: "citizens",
            blocs: [bloc("faithful", "The faithful", "the common people", ["commons", "priests"], 100, 5)],
            quorumBps: 3_000, passageThresholdBps: 5_001, denominator: "cast",
          },
        ],
        offices: [
          { key: "ruler", label: `High priest ${of}`, kind: "priesthood", grade: "ruler", rank: 3, treasury: true, succession: { kind: "elective", chamberKey: "college", label: "Chosen by the college" } },
          { key: "priest", label: `Priest ${of}`, kind: "priesthood", grade: "civil", seatCount: between(s("priests"), 10, 30), succession: { kind: "elective", chamberKey: "college", label: "Chosen by the college" } },
          { key: "treasurer", label: `Treasurer of the temple ${of}`, kind: "magistracy", grade: "magistrate", rank: 1, treasury: true, succession: { kind: "appointment", chamberKey: null, label: "Named by the high priest" } },
        ],
      };
    }
  }
}

// ── Reading the parts ────────────────────────────────────────────────────────

export interface GovernmentRules {
  readonly offices: readonly Office[];
  readonly successionRules: readonly SuccessionRule[];
}

export const chamberPowers = (institution: GovernmentInstitution): readonly ChamberPower[] => institution.powers ?? ALL_CHAMBER_POWERS;
export const chambersOf = (world: WorldState, polityId: string): GovernmentInstitution[] =>
  world.material.institutions.filter((institution) => institution.polityId === polityId);

/** The chamber that may change the constitution: its first chamber that binds and holds the power. */
export function sovereignChamberOf(world: WorldState, polityId: string): GovernmentInstitution | null {
  return chambersOf(world, polityId).find((institution) => institution.advisory !== true && chamberPowers(institution).includes("constitution")) ?? null;
}

/** The council a ruler consults and need not obey, where he keeps one. */
export function advisoryCouncilOf(world: WorldState, polityId: string): GovernmentInstitution | null {
  return chambersOf(world, polityId).find((institution) => institution.advisory === true) ?? null;
}

export const constitutionOf = (world: WorldState, polityId: string): Constitution | undefined =>
  world.constitutions.find((constitution) => constitution.polityId === polityId);

/** The office that is the power's head, as the record has it, else its highest magistracy. */
export function rulerOfficeOf(world: WorldState, polityId: string, government: GovernmentRules): Office | null {
  const offices = allOffices(world, government.offices).filter((office) => office.polityId === polityId && office.successionRuleId !== "abolished");
  const recorded = constitutionOf(world, polityId)?.rulerOfficeId;
  const byRecord = recorded == null ? undefined : offices.find((office) => office.id === recorded);
  if (byRecord !== undefined) return byRecord;
  return [...offices].filter((office) => isMagistracy(office) || office.rank !== undefined)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.id.localeCompare(b.id))[0] ?? null;
}

/** Who sits in the ruler's seat now, if anybody. */
export function rulerOf(world: WorldState, polityId: string, government: GovernmentRules): Character | null {
  const office = rulerOfficeOf(world, polityId, government);
  if (office === null) return null;
  const seat = world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status === "held");
  return world.characters.find((character) => character.id === seat?.holderCharacterId && character.alive) ?? null;
}

/**
 * What the parts read as. A throne that passes by blood with no chamber over
 * it is a monarchy; otherwise the chamber that may change the constitution
 * says what sort of state it is by who sits in it.
 */
export function readForm(world: WorldState, polityId: string, government: GovernmentRules): GovernmentForm {
  const sovereign = sovereignChamberOf(world, polityId);
  const ruler = rulerOfficeOf(world, polityId, government);
  const rule = ruler === null ? undefined : allSuccessionRules(world, government.successionRules).find((candidate) => candidate.id === ruler.successionRuleId);
  if (sovereign === null) return ruler?.kind === "priesthood" ? "temple_state" : "monarchy";
  if (rule !== undefined && (rule.kind === "primogeniture" || rule.kind === "seniority") && ruler?.kind !== "membership" && sovereign.franchise == null) return "monarchy";
  switch (sovereign.franchise) {
    case "soldiers": return "soldier_commune";
    case "chiefs": return "tribal_confederation";
    case "cities": return "league";
    case "priests": return "temple_state";
    case "citizens": return "popular_republic";
    default: return "oligarchic_republic";
  }
}

// ── Building the parts ──────────────────────────────────────────────────────

interface Built {
  readonly institutions: GovernmentInstitution[];
  readonly offices: Office[];
  readonly rules: SuccessionRule[];
  readonly rulerOfficeId: string | null;
}

const chamberId = (polityId: string, key: string): string => boundedId(polityId, key);
const officeId = (polityId: string, key: string): string => boundedId(polityId, key);

/** A template made into the world's own records, with ids that are the same on every replay. */
function build(polity: Polity, template: ConstitutionTemplate, treasuryAccountId: string | null, requirementIds: readonly string[]): Built {
  const institutions = template.chambers.map((chamber): GovernmentInstitution => {
    const id = chamberId(polity.id, chamber.key);
    const votingBlocs: VotingBloc[] = chamber.blocs.map((bloc) => ({
      id: boundedId(id, bloc.key),
      name: bloc.name,
      representedInterest: bloc.interest,
      weight: bloc.weight,
      baseSupport: Math.max(-100, Math.min(100, bloc.baseSupport)),
      yesThreshold: 15,
      noThreshold: -15,
      causes: [],
      interests: [...bloc.interests],
      groupId: null,
    }));
    return {
      id,
      polityId: polity.id,
      name: chamber.name,
      votingBlocs,
      totalVotingWeight: votingBlocs.reduce((sum, bloc) => sum + bloc.weight, 0),
      quorumBps: chamber.quorumBps,
      passageThresholdBps: chamber.passageThresholdBps,
      denominator: chamber.denominator,
      powers: [...chamber.powers],
      advisory: chamber.advisory,
      franchise: chamber.franchise,
      refersFailuresTo: chamber.refersTo === undefined ? null : chamberId(polity.id, chamber.refersTo),
    };
  });
  const rules: SuccessionRule[] = [];
  const offices = template.offices.map((spec): Office => {
    const ruleId = boundedId(polity.id, spec.key, "succession");
    rules.push({ id: ruleId, label: spec.succession.label, kind: spec.succession.kind, institutionId: spec.succession.chamberKey === null ? null : chamberId(polity.id, spec.succession.chamberKey) });
    return {
      id: officeId(polity.id, spec.key),
      label: spec.label.slice(0, 120),
      polityId: polity.id,
      authorisedActionIds: [...GRADES[spec.grade]],
      sponsorableCategories: [],
      treasuryAccountId: spec.treasury === true ? treasuryAccountId : null,
      treasuryPermissions: spec.treasury === true && treasuryAccountId !== null ? (spec.grade === "ruler" ? ["view", "propose_spending", "spend_without_vote"] : ["view", "propose_spending"]) : [],
      incomeSourceId: null,
      expectedBlocId: null,
      successionRuleId: ruleId,
      eligibilityRequirementIds: [...requirementIds],
      kind: spec.kind,
      ...(spec.rank === undefined ? {} : { rank: spec.rank }),
      ...(spec.seatCount === undefined ? {} : { seatCount: spec.seatCount }),
      ...(spec.termDays === undefined ? {} : { termDays: spec.termDays }),
      ...(spec.enrolsFormerMagistrates === true ? { enrolsFormerMagistrates: true } : {}),
    };
  });
  return { institutions, offices, rules, rulerOfficeId: template.rulerKey === null ? null : officeId(polity.id, template.rulerKey) };
}

/** The requirements every office of a power asks: alive, one of its people, not disqualified. Made where missing. */
function ensureRequirements(world: WorldState, polity: Polity): { world: WorldState; ids: string[] } {
  const wanted = [
    { id: "req-alive", kind: "alive" as const, label: "Must be alive", params: {} },
    { id: "req-not-disqualified", kind: "not_disqualified" as const, label: "Must carry no disqualifying status", params: {} },
    { id: `req-${polity.id}-polity`.slice(0, 120), kind: "polity_membership" as const, label: `Must belong to ${polity.name}`.slice(0, 160), params: { polityId: polity.id } },
  ];
  const known = new Set(world.material.eligibilityRequirements.map((requirement) => requirement.id));
  const missing = wanted.filter((requirement) => !known.has(requirement.id));
  const next = missing.length === 0 ? world : { ...world, material: { ...world.material, eligibilityRequirements: [...world.material.eligibilityRequirements, ...missing] } };
  return { world: next, ids: wanted.map((requirement) => requirement.id) };
}

const treasuryOf = (world: WorldState, polityId: string): string | null =>
  world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)?.id ?? null;

/** An elective office nobody has held gets its first seat on record, so the opening election fills it. */
function withOpeningSeats(world: WorldState, offices: readonly Office[], rules: readonly SuccessionRule[]): WorldState {
  const elective = new Set(rules.filter((rule) => rule.kind === "elective").map((rule) => rule.id));
  const seats = [...world.material.officeSeats];
  for (const office of offices) {
    if (!elective.has(office.successionRuleId) || office.seatCount !== undefined || office.kind === "membership") continue;
    if (seats.some((seat) => seat.officeId === office.id)) continue;
    seats.push({
      id: boundedId(office.id, "seat", 0), officeId: office.id, seatIndex: 0, holderCharacterId: null, status: "vacant", vacancyCause: "never_filled",
      termStartedAtStep: null, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [...office.eligibilityRequirementIds],
    });
  }
  return seats.length === world.material.officeSeats.length ? world : { ...world, material: { ...world.material, officeSeats: seats } };
}

export interface EnsureConstitutionsInput {
  readonly world: WorldState;
  readonly government: GovernmentRules;
  readonly toDay: number;
}

/**
 * Every power gets a constitution the first time the world is reviewed.
 *
 * A power whose chambers the scenario authored is recorded as it stands.
 * Every other power is given its form's parts, seeded, and its scenario
 * offices of the same key -- a template power's ruler, councillors and priests
 * -- are reformed into them rather than doubled. Silent: they were always
 * there.
 */
export function ensureConstitutions(input: EnsureConstitutionsInput): WorldState {
  let world = input.world;
  const recorded = new Set(world.constitutions.map((constitution) => constitution.polityId));
  for (const polity of world.map.polities) {
    if (recorded.has(polity.id)) continue;
    const authored = chambersOf(world, polity.id);
    if (authored.length > 0) {
      const form = readForm(world, polity.id, input.government);
      // The head is the highest office somebody actually holds as the world
      // opens: Rome's consuls, not a dictatorship nobody has been named to.
      const heldIds = new Set(world.material.officeSeats.filter((seat) => seat.status === "held").map((seat) => seat.officeId));
      const heads = allOffices(world, input.government.offices).filter((office) => office.polityId === polity.id && isMagistracy(office) && office.successionRuleId !== "abolished");
      const ruler = [...heads].filter((office) => heldIds.has(office.id)).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.id.localeCompare(b.id))[0]
        ?? rulerOfficeOf(world, polity.id, input.government);
      world = {
        ...world,
        constitutions: [...world.constitutions, {
          polityId: polity.id, form, origin: "scenario", adoptedAtStep: input.toDay, rulerOfficeId: ruler?.id ?? null,
          sovereignInstitutionId: sovereignChamberOf(world, polity.id)?.id ?? null, history: [],
        }],
      };
      continue;
    }
    const form = polity.governmentForm ?? formFromOffices(world, polity.id, input.government) ?? inferredGovernmentForm(polity);
    world = install(world, polity, form, input.government, input.toDay, "generated", null, NEW_CHAMBER_LEGITIMACY_BPS.lawful + 2_000).world;
  }
  return world;
}

/**
 * A form read from the offices a power already has, for a world written
 * before powers stated one: a magistracy elected for a year is a republic's
 * (Carthage's suffetes, in a save older than v33). Nothing else is read --
 * every template power has a hereditary "ruler", which says only that
 * nobody wrote it anything better. Null leaves it to cohesion.
 */
function formFromOffices(world: WorldState, polityId: string, government: GovernmentRules): GovernmentForm | null {
  const rules = new Map(allSuccessionRules(world, government.successionRules).map((rule) => [rule.id, rule]));
  const offices = allOffices(world, government.offices).filter((office) => office.polityId === polityId && isMagistracy(office));
  return offices.some((office) => rules.get(office.successionRuleId)?.kind === "elective" && office.termDays != null) ? "oligarchic_republic" : null;
}

/** Puts a template's parts into the world for one power, beside whatever it already has. */
function install(
  world: WorldState,
  polity: Polity,
  form: GovernmentForm,
  government: GovernmentRules,
  atStep: number,
  origin: ConstitutionOrigin,
  byCharacterId: string | null,
  legitimacyBps: number,
): { world: WorldState; built: Built } {
  const required = ensureRequirements(world, polity);
  const built = build(polity, templateFor(polity, form), treasuryOf(required.world, polity.id), required.ids);
  const builtOfficeIds = new Set(built.offices.map((office) => office.id));
  const builtRuleIds = new Set(built.rules.map((rule) => rule.id));
  let next: WorldState = {
    ...required.world,
    offices: [...required.world.offices.filter((office) => !builtOfficeIds.has(office.id)), ...built.offices],
    successionRules: [...required.world.successionRules.filter((rule) => !builtRuleIds.has(rule.id)), ...built.rules],
    material: {
      ...required.world.material,
      institutions: [...required.world.material.institutions, ...built.institutions],
      institutionLegitimacy: [
        ...required.world.material.institutionLegitimacy,
        ...built.institutions.map((institution) => ({ institutionId: institution.id, legitimacyBps: legitimacyBps, causes: [] })),
      ],
    },
  };
  next = withOpeningSeats(next, built.offices, built.rules);
  const constitution: Constitution = {
    polityId: polity.id,
    form,
    origin,
    adoptedAtStep: atStep,
    rulerOfficeId: built.rulerOfficeId,
    sovereignInstitutionId: null,
    history: [],
  };
  next = { ...next, constitutions: [...next.constitutions.filter((entry) => entry.polityId !== polity.id), constitution] };
  next = {
    ...next,
    constitutions: next.constitutions.map((entry) => (entry.polityId === polity.id
      ? { ...entry, sovereignInstitutionId: sovereignChamberOf(next, polity.id)?.id ?? null }
      : entry)),
  };
  void byCharacterId;
  return { world: next, built };
}

// ── Taking parts away ───────────────────────────────────────────────────────

/**
 * A chamber done away with, and everything that pointed at it.
 *
 * Its open questions lapse, saying why; questions it settled keep their
 * record but no longer name it (the schema asks that a named chamber exist);
 * its blocs' declared positions go with it; a succession rule it elected by
 * elects nobody now.
 */
function removeChamber(world: WorldState, institutionId: string, atStep: number, why: string): WorldState {
  const institution = world.material.institutions.find((candidate) => candidate.id === institutionId);
  if (institution === undefined) return world;
  const blocIds = new Set(institution.votingBlocs.map((bloc) => bloc.id));
  const open = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);
  return {
    ...world,
    successionRules: [
      ...world.successionRules.filter((rule) => rule.institutionId !== institutionId),
      ...world.successionRules.filter((rule) => rule.institutionId === institutionId).map((rule) => ({ ...rule, institutionId: null })),
    ],
    material: {
      ...world.material,
      institutions: world.material.institutions
        .filter((candidate) => candidate.id !== institutionId)
        .map((candidate) => (candidate.refersFailuresTo === institutionId ? { ...candidate, refersFailuresTo: null } : candidate)),
      institutionLegitimacy: world.material.institutionLegitimacy.filter((entry) => entry.institutionId !== institutionId),
      reservedPowers: world.material.reservedPowers.filter((rule) => rule.institutionId !== institutionId),
      motions: world.material.motions.filter((motion) => motion.institutionId !== institutionId),
      inheritanceRules: world.material.inheritanceRules.map((rule) => (rule.institutionId === institutionId ? { ...rule, institutionId: null, kind: rule.kind === "elective" ? "appointment" as const : rule.kind } : rule)),
      supportPositions: world.material.supportPositions.filter((position) => !(position.supporterKind === "group" && blocIds.has(position.supporterId))),
      politicalProcedures: world.material.politicalProcedures.map((procedure) => {
        if (procedure.institutionId !== institutionId) return procedure;
        const detached = { ...procedure, institutionId: null, resolutionMechanism: procedure.resolutionMechanism === "vote" ? "sponsor_discretion" as const : procedure.resolutionMechanism };
        return open.has(procedure.stage)
          ? { ...detached, stage: "withdrawn" as const, outcome: "withdrawn" as const, outcomeReason: `${institution.name} ${why}, and the question lapsed with it.`.slice(0, 400), resolvedAtStep: atStep }
          : detached;
      }),
    },
  };
}

/**
 * An office done away with. Kept, so the men who held it are still described
 * as having held it; emptied of every power, and of the rule that refilled it.
 * Its holders are put out with the cause given -- "abolished" by law,
 * "deposed" by force -- and returned, so the fallen can be gathered.
 */
function abolishOffice(world: WorldState, office: Office, cause: "abolished" | "deposed", atStep: number): { world: WorldState; ousted: string[] } {
  let next = world;
  const ousted: string[] = [];
  for (const seat of world.material.officeSeats.filter((candidate) => candidate.officeId === office.id && candidate.holderCharacterId !== null)) {
    ousted.push(seat.holderCharacterId!);
    next = vacateOfficeOf(next, seat.holderCharacterId!, office.id, cause, atStep);
  }
  return {
    world: {
      ...next,
      offices: [...next.offices.filter((candidate) => candidate.id !== office.id), {
        ...office, authorisedActionIds: [], successionRuleId: "abolished", treasuryAccountId: null, treasuryPermissions: [],
      }],
      material: { ...next.material, officeSeats: next.material.officeSeats.filter((seat) => seat.officeId !== office.id) },
    },
    ousted,
  };
}

/**
 * The fallen, gathered: whoever the change put out of office, led by the man
 * who held the highest seat, or his heir. They do not vanish. They are a party
 * now, with a claim, and they are what a restoration is made of
 * (`sim/society.ts` keeps them, and lets them fade).
 */
export function foundDeposedParty(world: WorldState, polityId: string, leaderId: string | null, memberIds: readonly string[], atStep: number, formerForm: GovernmentForm): WorldState {
  const members = [...new Set(memberIds)].filter((id) => world.characters.some((character) => character.id === id && character.alive));
  if (leaderId === null && members.length === 0) return world;
  const leader = leaderId ?? members[0]!;
  const leaderName = world.characters.find((character) => character.id === leader)?.name ?? leader;
  const id = boundedId("group", "deposed", polityId, atStep);
  if (world.material.politicalGroups.some((group) => group.id === id)) return world;
  const group: PoliticalGroup = {
    id,
    name: `The party of ${leaderName}`.slice(0, 120),
    polityId,
    type: "deposed_party",
    leaderCharacterId: leader,
    platform: [`Restore ${GOVERNMENT_FORM_IN_WORDS[formerForm]} and those who governed it`.slice(0, 200)],
    resourceAccountId: null,
    publicReputationBps: 4_000,
    active: true,
    emergentKey: boundedId("deposed", polityId, atStep),
    strengthBps: 6_000,
    interest: "loyalists",
    foundedAtStep: atStep,
    endedAtStep: null,
  };
  return {
    ...world,
    material: {
      ...world.material,
      politicalGroups: [...world.material.politicalGroups, group],
      groupMemberships: [
        ...world.material.groupMemberships,
        ...[leader, ...members.filter((member) => member !== leader)].map((characterId, index) => ({
          characterId, groupId: id, role: index === 0 ? "leader" : "member", influenceBps: index === 0 ? 8_000 : 4_000, loyaltyBps: 60,
          visibility: "public" as const, joinedAtStep: atStep, leftAtStep: null, joinProvenanceEventId: null, leaveProvenanceEventId: null,
        })),
      ],
    },
  };
}

export interface RecastInput {
  readonly world: WorldState;
  readonly polityId: string;
  readonly toForm: GovernmentForm;
  readonly origin: ConstitutionOrigin;
  readonly byCharacterId: string | null;
  /** Put in the new ruler's seat, where the new form has one: the man who took the state. */
  readonly seatRuler: string | null;
  readonly government: GovernmentRules;
  readonly atStep: number;
  readonly summary: string;
}

/**
 * The whole constitution recast into another form.
 *
 * Every chamber goes, and every office the new form does not have; an office
 * it keeps under the same key stays, and so do the men in it. The new form's
 * parts are seeded exactly as a power first meeting the world would have been
 * -- history has diverged by now, so even a major power's new government is
 * its template's. Treaties, debts and laws stand: they bind the power, not
 * its form. New chambers start with little legitimacy, less if they were set
 * up by force; the men put out become a party.
 */
export function recast(input: RecastInput): { world: WorldState; facts: FactProposalDraft[] } {
  const polity = input.world.map.polities.find((candidate) => candidate.id === input.polityId);
  if (polity === undefined) return { world: input.world, facts: [] };
  const before = constitutionOf(input.world, polity.id);
  const fromForm = before?.form ?? readForm(input.world, polity.id, input.government);
  const oldRuler = rulerOf(input.world, polity.id, input.government);
  const forced = input.origin === "seizure" || input.origin === "imposition" || input.origin === "restoration";
  const why = forced ? "was swept away" : "was abolished";

  let world = input.world;
  for (const chamber of chambersOf(world, polity.id)) world = removeChamber(world, chamber.id, input.atStep, why);

  const template = templateFor(polity, input.toForm);
  const keptIds = new Set(template.offices.map((spec) => officeId(polity.id, spec.key)));
  const ousted: string[] = [];
  for (const office of allOffices(world, input.government.offices).filter((candidate) => candidate.polityId === polity.id && candidate.successionRuleId !== "abolished")) {
    if (keptIds.has(office.id)) continue;
    const gone = abolishOffice(world, office, forced ? "deposed" : "abolished", input.atStep);
    world = gone.world;
    if (office.kind !== "priesthood") ousted.push(...gone.ousted);
  }
  // A ruler who keeps his seat's key under a new form -- a king made a mere
  // magistrate -- is still put out when the state was taken from him.
  if (forced && oldRuler !== null && oldRuler.id !== input.seatRuler) {
    for (const seat of world.material.officeSeats.filter((candidate) => candidate.holderCharacterId === oldRuler.id && candidate.status === "held")) {
      world = vacateOfficeOf(world, oldRuler.id, seat.officeId, "deposed", input.atStep);
    }
    ousted.push(oldRuler.id);
  }

  const installed = install(world, polity, input.toForm, input.government, input.atStep, input.origin, input.byCharacterId,
    forced ? NEW_CHAMBER_LEGITIMACY_BPS.forced : NEW_CHAMBER_LEGITIMACY_BPS.lawful);
  world = installed.world;

  if (input.seatRuler !== null && installed.built.rulerOfficeId !== null) {
    const office = allOffices(world, input.government.offices).find((candidate) => candidate.id === installed.built.rulerOfficeId);
    if (office !== undefined) {
      const sitting = world.material.officeSeats.find((seat) => seat.officeId === office.id && seat.status === "held");
      if (sitting?.holderCharacterId != null && sitting.holderCharacterId !== input.seatRuler) {
        ousted.push(sitting.holderCharacterId);
        world = vacateOfficeOf(world, sitting.holderCharacterId, office.id, "deposed", input.atStep);
      }
      if (sitting?.holderCharacterId !== input.seatRuler) {
        const vacant = world.material.officeSeats.find((seat) => seat.officeId === office.id && seat.status === "vacant")?.id ?? null;
        world = seatCharacterInOffice(world, input.seatRuler, { office, vacantSeatId: vacant }, input.atStep, office.termDays ?? null);
      }
    }
  }

  const change = { atStep: input.atStep, origin: input.origin, fromForm, toForm: input.toForm, summary: input.summary.slice(0, 400), byCharacterId: input.byCharacterId };
  world = {
    ...world,
    constitutions: world.constitutions.map((entry) => (entry.polityId === polity.id
      ? { ...entry, history: [...(before?.history ?? []), change].slice(-24) }
      : entry)),
  };
  if (forced && ousted.length > 0) {
    world = foundDeposedParty(world, polity.id, oldRuler?.id ?? null, ousted.filter((id) => id !== input.seatRuler), input.atStep, fromForm);
  }

  const chambers = chambersOf(world, polity.id).map((chamber) => `${chamber.name}${chamber.advisory === true ? " (advisory)" : ""}`);
  return {
    world,
    facts: [{
      localId: `constitution_${polity.id}_${input.atStep}`.slice(0, 60),
      kind: "constitution_changed",
      summary: `${polity.name} is now ${GOVERNMENT_FORM_IN_WORDS[input.toForm]}${fromForm === input.toForm ? ", under new laws" : `, and no longer ${GOVERNMENT_FORM_IN_WORDS[fromForm]}`}. ${input.summary} ${chambers.length > 0 ? `It is governed through ${chambers.join(" and ")}.` : ""}`.trim().slice(0, 600),
      affectedRefs: [{ kind: "polity", id: polity.id }, ...(input.byCharacterId === null ? [] : [{ kind: "character" as const, id: input.byCharacterId }]), ...[...new Set(ousted)].slice(0, 4).map((id) => ({ kind: "character" as const, id }))],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 85,
    }],
  };
}

/**
 * One part of a constitution changed, by a measure carried or a decree.
 *
 * A whole form is `recast`. A chamber founded gets a standing bloc of its
 * members and seats for the world's groups as its franchise admits; one
 * reformed keeps its blocs; one abolished takes its open questions with it.
 * A succession changed is a rule of the world's, pointed at the office.
 */
export function amend(
  world: WorldState,
  polityId: string,
  amendment: ConstitutionAmendment,
  government: GovernmentRules,
  atStep: number,
  ids: IdFactory,
  title: string,
  byCharacterId: string | null,
): { world: WorldState; facts: FactProposalDraft[]; said: string[] } {
  if (amendment.form != null) {
    const done = recast({ world, polityId, toForm: amendment.form, origin: "reform", byCharacterId, seatRuler: null, government, atStep, summary: `${title} was carried.` });
    return { world: done.world, facts: done.facts, said: [`the constitution is recast as ${GOVERNMENT_FORM_IN_WORDS[amendment.form]}`] };
  }
  let next = world;
  const said: string[] = [];
  const chamber = amendment.chamber ?? null;
  if (chamber !== null) {
    const existing = chamber.institutionId === null ? undefined : next.material.institutions.find((candidate) => candidate.id === chamber.institutionId && candidate.polityId === polityId);
    if (chamber.abolish) {
      if (existing !== undefined) {
        next = removeChamber(next, existing.id, atStep, "was abolished by law");
        said.push(`${existing.name} is abolished`);
      }
    } else if (existing !== undefined) {
      next = {
        ...next,
        material: {
          ...next.material,
          institutions: next.material.institutions.map((candidate) => (candidate.id === existing.id
            ? {
              ...candidate,
              ...(chamber.name === null ? {} : { name: chamber.name }),
              ...(chamber.powers === null ? {} : { powers: [...chamber.powers] }),
              ...(chamber.advisory === null ? {} : { advisory: chamber.advisory }),
              ...(chamber.franchise === null ? {} : { franchise: chamber.franchise }),
            }
            : candidate)),
        },
      };
      const changes = [
        chamber.powers === null ? null : `may now decide ${chamber.powers.join(", ") || "nothing"}`,
        chamber.advisory === null ? null : chamber.advisory ? "now only advises" : "its vote now binds",
        chamber.franchise === null ? null : `is now filled by ${FRANCHISE_IN_WORDS[chamber.franchise]}`,
      ].filter((part) => part !== null);
      said.push(`the ${(chamber.name ?? existing.name).replace(/^the\s+/iu, "")} ${changes.join(", and ") || "is reformed"}`);
    } else {
      const id = ids.next("institution");
      const name = chamber.name ?? "The new council";
      next = {
        ...next,
        material: {
          ...next.material,
          institutions: [...next.material.institutions, {
            id, polityId, name,
            votingBlocs: [{ id: `${id}-members`, name: "Members", representedInterest: "its members", weight: 100, baseSupport: 0, yesThreshold: 10, noThreshold: -10, causes: [], interests: [], groupId: null }],
            totalVotingWeight: 100, quorumBps: 5_000, passageThresholdBps: 5_001, denominator: "cast",
            powers: [...(chamber.powers ?? ["laws"])], advisory: chamber.advisory ?? false, franchise: chamber.franchise ?? "council", refersFailuresTo: null,
          }],
          institutionLegitimacy: [...next.material.institutionLegitimacy, { institutionId: id, legitimacyBps: NEW_CHAMBER_LEGITIMACY_BPS.lawful, causes: [] }],
        },
      };
      said.push(`${name} is founded`);
    }
  }
  const succession = amendment.succession ?? null;
  if (succession !== null) {
    const office = allOffices(next, government.offices).find((candidate) => candidate.id === succession.officeId && candidate.polityId === polityId);
    if (office !== undefined) {
      const ruleId = boundedId(office.id, "succession", atStep);
      const body = succession.institutionId === null ? undefined : next.material.institutions.find((candidate) => candidate.id === succession.institutionId);
      const label = succession.kind === "elective" ? `Elected by ${body?.name ?? "the assembly"}` : succession.kind === "primogeniture" ? "Hereditary succession" : succession.kind === "seniority" ? "The eldest of the house" : "Appointed";
      next = {
        ...next,
        successionRules: [...next.successionRules.filter((rule) => rule.id !== ruleId), { id: ruleId, label, kind: succession.kind, institutionId: body?.id ?? null }],
        offices: [...next.offices.filter((candidate) => candidate.id !== office.id), { ...office, successionRuleId: ruleId }],
      };
      said.push(`the office of ${office.label} is now ${label.toLowerCase()}`);
    }
  }
  if (said.length > 0) next = rereadForm(next, polityId, government, atStep, "reform", `${title}: ${said.join("; ")}.`, byCharacterId);
  return { world: next, facts: [], said };
}

const FRANCHISE_IN_WORDS: Record<Franchise, string> = {
  council: "the men of the council", citizens: "the citizens", soldiers: "the soldiers", chiefs: "the chiefs", cities: "delegates of the cities", priests: "the priests",
};

/** The record brought back in step with the parts after a change: every change goes into its history, whether or not the form it reads as moved. */
function rereadForm(world: WorldState, polityId: string, government: GovernmentRules, atStep: number, origin: ConstitutionOrigin, summary: string, byCharacterId: string | null): WorldState {
  const before = constitutionOf(world, polityId);
  const form = readForm(world, polityId, government);
  const sovereignInstitutionId = sovereignChamberOf(world, polityId)?.id ?? null;
  const history = before === undefined ? [] : [...before.history, { atStep, origin, fromForm: before.form, toForm: form, summary: summary.slice(0, 400), byCharacterId }].slice(-24);
  const entry: Constitution = before === undefined
    ? { polityId, form, origin, adoptedAtStep: atStep, rulerOfficeId: rulerOfficeOf(world, polityId, government)?.id ?? null, sovereignInstitutionId, history: [] }
    : { ...before, form, sovereignInstitutionId, history };
  return { ...world, constitutions: [...world.constitutions.filter((candidate) => candidate.polityId !== polityId), entry] };
}

// ── Thrones ─────────────────────────────────────────────────────────────────

/** Who last held an office, from the record of tenures -- a vacant seat has forgotten. */
function lastHolderOf(world: WorldState, officeIdValue: string): Character | null {
  return [...world.characters]
    .map((character) => ({ character, tenure: character.officesHeld.find((held) => held.officeId === officeIdValue) }))
    .filter((entry) => entry.tenure !== undefined)
    .sort((a, b) => b.tenure!.lastHeldAtStep - a.tenure!.lastHeldAtStep || a.character.id.localeCompare(b.character.id))[0]?.character ?? null;
}

/** Eldest first, sons before daughters: the order a throne passed in, in this age. */
function byClaim(world: WorldState, candidates: readonly Character[], atStep: number): Character[] {
  return [...candidates].sort((a, b) =>
    (a.gender === "male" ? 0 : 1) - (b.gender === "male" ? 0 : 1)
    || currentAgeYears(b, atStep) - currentAgeYears(a, atStep)
    || a.id.localeCompare(b.id));
}

/**
 * Who a throne passes to. By blood: the late ruler's children, then his
 * brothers and sisters, then any kinsman the family knows. By seniority: the
 * eldest of his kin, before his children. Only the living, and only his own
 * people -- a prince who went over to the enemy has gone over.
 */
export function heirTo(world: WorldState, lastHolder: Character, kind: "primogeniture" | "seniority", atStep: number): Character | null {
  const eligible = (id: string): Character | undefined => world.characters.find((character) => character.id === id && character.alive && character.polityId === lastHolder.polityId && character.legalStatus !== "enslaved");
  const children = childrenOf(world, lastHolder.id).map(eligible).filter((character): character is Character => character !== undefined);
  const kin = familyLinksOf(world, lastHolder.id, atStep)
    .filter((view) => view.kind === "sibling" || view.kind === "other_relative")
    .map((view) => eligible(view.counterpartCharacterId))
    .filter((character): character is Character => character !== undefined);
  const order = kind === "seniority" ? [...byClaim(world, [...kin, ...children], atStep)] : [...byClaim(world, children, atStep), ...byClaim(world, kin, atStep)];
  return order[0] ?? null;
}

export interface KeepThronesInput {
  readonly world: WorldState;
  readonly government: GovernmentRules;
  readonly playerCharacterId?: string | null | undefined;
  readonly toDay: number;
}

/**
 * A throne that passes by blood is filled by blood the day it falls vacant.
 *
 * Nothing did this. A king who died left a seat nobody filled, and a kingdom
 * went on without a king until a model happened to crown somebody -- which,
 * for a question nobody had been handed, it never did. Now the heir takes the
 * seat; a child reigns through the openings a regency makes (`openings.ts`);
 * and where there is no heir, the throne stands empty for `EMPTY_THRONE_DAYS`
 * while whoever could take it is told so. If nobody does, the power's council
 * takes the choosing on: the throne becomes elective, by it.
 */
export function keepThrones(input: KeepThronesInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const rules = allSuccessionRules(world, input.government.successionRules);
  for (const polity of world.map.polities) {
    const office = rulerOfficeOf(world, polity.id, input.government);
    if (office === null) continue;
    const rule = rules.find((candidate) => candidate.id === office.successionRuleId);
    if (rule === undefined || (rule.kind !== "primogeniture" && rule.kind !== "seniority")) continue;
    const seat = world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status === "vacant"
      && candidate.vacancyCause !== "never_filled" && candidate.vacancyCause !== "abolished" && candidate.vacancyCause !== "deposed");
    if (seat === undefined || world.material.officeSeats.some((candidate) => candidate.officeId === office.id && candidate.status === "held")) continue;
    const late = lastHolderOf(world, office.id);
    const heir = late === null ? null : heirTo(world, late, rule.kind, input.toDay);
    if (heir !== null) {
      world = seatCharacterInOffice(world, heir.id, { office, vacantSeatId: seat.id }, input.toDay, null);
      const age = currentAgeYears(heir, input.toDay);
      facts.push({
        localId: `throne_${office.id}_${input.toDay}`.slice(0, 60),
        kind: "succession",
        summary: `${heir.name} succeeds ${late!.name} as ${office.label}${age < MAJORITY_YEARS ? `, a child of ${age}, and will reign through a regent` : ""}.`,
        affectedRefs: [{ kind: "character", id: heir.id }, { kind: "character", id: late!.id }, { kind: "polity", id: polity.id }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 75,
      });
      continue;
    }
    // No heir. Empty for a while; then the council chooses.
    const since = seat.termExpiresAtStep ?? input.toDay;
    if (input.toDay < since + EMPTY_THRONE_DAYS) continue;
    const council = chambersOf(world, polity.id).find((chamber) => chamber.franchise === "council") ?? chambersOf(world, polity.id)[0];
    if (council === undefined) continue;
    const ruleId = boundedId(office.id, "succession", "elective", input.toDay);
    world = {
      ...world,
      successionRules: [...world.successionRules, { id: ruleId, label: `Chosen by ${council.name}`, kind: "elective", institutionId: council.id }],
      offices: [...world.offices.filter((candidate) => candidate.id !== office.id), { ...office, successionRuleId: ruleId }],
      material: {
        ...world.material,
        officeSeats: world.material.officeSeats.map((candidate) => (candidate.id === seat.id ? { ...candidate, vacancyCause: "never_filled" as const } : candidate)),
      },
    };
    world = rereadForm(world, polity.id, input.government, input.toDay, "extinction", `The line of ${late?.name ?? "the old rulers"} died out; no heir was found, and ${council.name} took the choosing of the ${office.label} upon itself.`, null);
    facts.push({
      localId: `extinct_${office.id}_${input.toDay}`.slice(0, 60),
      kind: "constitution_changed",
      summary: `No heir came forward for the throne of ${polity.name}. ${council.name} will choose the next ${office.label}.`,
      affectedRefs: [{ kind: "polity", id: polity.id }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 75,
    });
  }
  return { world, facts };
}
