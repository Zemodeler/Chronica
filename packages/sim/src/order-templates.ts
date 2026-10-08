import {
  OrchestratorOutputSchema,
  WorldDeltaSchema,
  fitStrengthOf,
  isNavalForce,
  monthlyTakings,
  readDepartments,
  type Force,
  type OrchestratorOutput,
  type ScenarioWarfareRules,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { chestOfPower, payerOf, planSupply } from "./supply-plan";
import { safeLocalId } from "./safe-local-id";

/**
 * The common routine orders, understood by rule (the user's rule, 2026-10-08: "Orders from a player should still be automatic: an order like 'find supply for my army'
 * should automatically delegate to other NPCs which in turn use deterministic ways of doing it").
 *
 * Most of what a commander or a magistrate says in a day is one of a few things said the same few ways: find bread for the army, hold, set the tribute at a rate, build
 * a depot or a road, raise so many men. Reading these takes no model. A clause that fits one of the templates below, with its slots filled from what the player said and
 * what he commands, is turned into the acts or the delegations the orchestrator would have written; an order of which every clause fits is answered without a call, and
 * the ledger is written from what it made. One that is political, conditional, ambiguous (two armies and none named) or simply not in the table is the orchestrator's, as
 * it was, whole: a half-understood order is never half-carried.
 *
 *   supply     "find supply for my army", "feed the legions for two months", "provision the army at Messana" -> a delegation to the man who feeds it (`supplyDelegateOf`)
 *              with a supply ask, carried out by `supply-plan.ts`; the army's own commander, where he is the player, does it himself
 *   hold       "hold the army", "stand fast at Rhegium"                                                     -> force_modify, hold
 *   tax        "set the tribute at 12 percent", "lower the tax to 8%"                                       -> tax_policy_set
 *   build      "build a depot at Messana", "build a road", "raise walls at Rhegium"                         -> project_create with a standing effect
 *   levy       "raise 3000 men", "levy two thousand men at Rome"                                           -> force_create
 */

export interface TemplateMatch {
  readonly output: OrchestratorOutput;
  /** The templates that read it, in the order of the clauses. */
  readonly templates: readonly string[];
}

interface Clause {
  readonly part: { readonly said: string; readonly whyNot?: string | null };
  /** What the engine itself found, in the officer's words, for the answer to the order. */
  readonly note?: string;
  readonly deltas: readonly WorldDelta[];
  readonly delegations: readonly { readonly recipientId: string; readonly instruction: string; readonly ask: { readonly kind: "supply"; readonly ref: string; readonly amount: number } }[];
  readonly template: string;
  readonly domain: string;
}

/** Words that make an order conditional, political or long: not for a template. */
const NOT_FOR_A_TEMPLATE = /\b(if|unless|otherwise|until|whenever|provided|should|would|except|but|vote|senate|assembly|propose|motion|treaty|ally|allies|ambassador|envoy|letter|declare|war on|peace|plot|assassinate|bribe|secretly|marry|adopt)\b/i;

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100 };

const numberIn = (text: string): number | null => {
  const digits = /\b(\d[\d,]*(?:\.\d+)?)\b/.exec(text);
  if (digits !== null) return Number(digits[1]!.replace(/,/g, ""));
  const word = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety)\b/i.exec(text);
  return word === null ? null : NUMBER_WORDS[word[1]!.toLowerCase()] ?? null;
};

/** How many days of bread a clause asks for: "for two months", "for 40 days", "for the winter", else a month. */
function daysAsked(text: string): number {
  const span = /\bfor\s+(?:the\s+next\s+|about\s+|another\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(day|days|week|weeks|month|months|season|seasons)\b/i.exec(text);
  if (span !== null) {
    const n = /^\d+$/.test(span[1]!) ? Number(span[1]) : NUMBER_WORDS[span[1]!.toLowerCase()] ?? 1;
    const unit = span[2]!.toLowerCase();
    const per = unit.startsWith("day") ? 1 : unit.startsWith("week") ? 7 : unit.startsWith("month") ? 30 : 90;
    return Math.max(1, Math.min(360, n * per));
  }
  if (/\b(winter|the winter)\b/i.test(text)) return 120;
  if (/\bfortnight\b/i.test(text)) return 14;
  return 30;
}

/** The land armies under the player: those he commands or controls, or, where he heads a power, all of its own. */
export function forcesUnder(world: WorldState, playerId: string, warfare?: ScenarioWarfareRules): Force[] {
  const player = world.characters.find((character) => character.id === playerId);
  if (player === undefined) return [];
  const heads = player.polityId !== null && readDepartments(world).rulers(player.polityId).some((ruler) => ruler.id === playerId);
  return world.material.forces
    .filter((force) => force.outlaw !== true && !isNavalForce(force, warfare) && fitStrengthOf(force) > 0
      && (force.commanderCharacterId === playerId || force.controllerCharacterId === playerId || force.memberCharacterIds.includes(playerId) || (heads && force.polityId === player.polityId)))
    .sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a) || a.id.localeCompare(b.id));
}

const GENERIC = new Set(["army", "legion", "legio", "field", "force", "host", "troops", "the", "of", "and", "forces", "armies", "legions"]);
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0);

/** The army the clause names, the only one he has, or null where it cannot be told (none, or several and none named). */
export function armyNamed(world: WorldState, playerId: string, text: string, warfare?: ScenarioWarfareRules): { readonly force: Force | null; readonly ambiguous: boolean } {
  const mine = forcesUnder(world, playerId, warfare);
  if (mine.length === 0) return { force: null, ambiguous: false };
  const lower = text.toLowerCase();
  const named = mine.filter((force) => lower.includes(force.name.toLowerCase())
    || (() => {
      const distinct = wordsOf(force.name).filter((word) => word.length >= 4 && !GENERIC.has(word));
      return distinct.length > 0 && distinct.every((word) => lower.includes(word));
    })());
  if (named.length === 1) return { force: named[0]!, ambiguous: false };
  if (named.length > 1) return { force: null, ambiguous: true };
  // "the army", "my legions": the only army he has, or the one a place names (the army at Messana).
  const here = mine.filter((force) => {
    const place = world.map.provinces.find((province) => province.id === force.locationId)?.name.toLowerCase();
    return place !== undefined && place.length >= 4 && lower.includes(place);
  });
  if (here.length === 1) return { force: here[0]!, ambiguous: false };
  if (here.length > 1) return { force: null, ambiguous: true };
  return mine.length === 1 ? { force: mine[0]!, ambiguous: false } : { force: null, ambiguous: true };
}

/** The province a clause names, by its name. */
function provinceNamed(world: WorldState, text: string): string | null {
  const lower = text.toLowerCase();
  const found = world.map.provinces.filter((province) => province.name.length >= 4 && new RegExp(`\\b${province.name.toLowerCase().replace(/[.*+?^${"$"}{}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
  const longest = found.sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id))[0];
  return longest?.id ?? null;
}

const QUAESTOR = /quaest|praefect\w*\s+fabr|praefectus\s+fabrum|supply|commissar|paymaster|sitarch|stratopedarch|logisti/i;

/**
 * The man who feeds an army, found by rule and never asked for: a post in the army that is the quaestor's or the prefect of works', else the head of the power's supply
 * (the department that keeps it), else the army's commander where he is not the player. Null where the player is the only one there is.
 */
export function supplyDelegateOf(world: WorldState, force: Force, playerId: string): { readonly id: string; readonly name: string; readonly office: string } | null {
  const alive = (id: string | null | undefined): id is string => id != null && id !== playerId && world.characters.some((character) => character.id === id && character.alive);
  const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
  for (const post of force.posts ?? []) {
    const rank = establishment?.ranks.find((candidate) => candidate.id === post.rankId);
    if (rank !== undefined && QUAESTOR.test(`${rank.label} ${rank.id}`) && alive(post.characterId)) {
      const man = world.characters.find((character) => character.id === post.characterId)!;
      return { id: man.id, name: man.name, office: rank.label };
    }
  }
  const holding = readDepartments(world).holding({ kind: "polity", id: force.polityId }, "supply");
  if (holding.department !== null) {
    const man = [holding.head, ...holding.people].find((candidate) => candidate !== null && candidate !== undefined && alive(candidate.id));
    if (man !== null && man !== undefined) return { id: man.id, name: man.name, office: holding.department.name };
  }
  if (alive(force.commanderCharacterId)) {
    const man = world.characters.find((character) => character.id === force.commanderCharacterId)!;
    return { id: man.id, name: man.name, office: "the commander" };
  }
  return null;
}

// ── The templates ───────────────────────────────────────────────────────────

const SUPPLY = /\b(?:supply|supplies|provision(?:s|ed|ing)?|victual(?:s|ling)?|feed|bread|grain|rations?|forage)\b/i;
const ARMY_NOUN = /\b(?:army|armies|legions?|troops|soldiers|men|host|force|forces|garrison|camp)\b/i;
const NOT_AN_ARMY_SUPPLY = /\b(?:city|town|people|plebs|poor|citizens|market|markets|dole|rome(?:\s+itself)?|price|prices|famine|stores? of the city|granar(?:y|ies))\b/i;

function supplyClause(world: WorldState, playerId: string, text: string, warfare?: ScenarioWarfareRules): Clause | null {
  if (!SUPPLY.test(text) || NOT_AN_ARMY_SUPPLY.test(text.replace(/\brome\b/gi, "")) && !ARMY_NOUN.test(text)) return null;
  if (!ARMY_NOUN.test(text) && armyNamed(world, playerId, text, warfare).force === null) return null;
  // "supply" the noun (a supply of grain) without an army to feed is not this.
  const { force, ambiguous } = armyNamed(world, playerId, text, warfare);
  if (force === null || ambiguous) return null;
  const days = daysAsked(text);
  const stays = /\b(stay|stays|staying|winter|wintering|remain|quarters|siege|camp(?:s|ed)?\s+(?:at|in|before)|garrison)\b/i.test(text);
  const delegate = supplyDelegateOf(world, force, playerId);
  const instruction = `Find bread for ${force.name}, for ${days} days${stays ? ", and a depot where it stays" : ""}.`;
  if (delegate === null) {
    // The player is the army's commander and nobody feeds it for him: he does it himself, by the same plan (`supply-plan.ts`), which is the only way bread is found for it.
    const plan = planSupply(world, force, days, { payAccountId: payerOf(world, playerId, force), stays, warfare });
    const player = world.characters.find((character) => character.id === playerId)!;
    const standing = plan.legitimacyCost > 0 && force.polityId === player.polityId
      ? [WorldDeltaSchema.parse({ op: "legitimacy_shift", target: "polity", targetId: force.polityId, legitimacyBpsDelta: -plan.legitimacyCost, causeLabel: `Bread taken by requisition for ${force.name}`.slice(0, 120), reason: "The country's patience is spent on the army's bread." })]
      : [];
    if (!plan.ok) return { part: { said: text.trim().slice(0, 200), whyNot: plan.refusal }, deltas: [], delegations: [], template: "supply", domain: "logistics", note: plan.words };
    return { part: { said: text.trim().slice(0, 200) }, deltas: [...plan.deltas, ...standing], delegations: [], template: "supply", domain: "logistics", note: plan.words };
  }
  return { part: { said: text.trim().slice(0, 200) }, deltas: [], delegations: [{ recipientId: delegate.id, instruction, ask: { kind: "supply", ref: force.id, amount: days } }], template: "supply", domain: "logistics" };
}

function holdClause(world: WorldState, playerId: string, text: string, warfare?: ScenarioWarfareRules): Clause | null {
  if (!/^(?:please\s+)?(?:hold|stand\s+fast|halt|stay\s+put|keep\s+(?:the\s+)?(?:army|legions?)\s+(?:where|in\s+camp))\b/i.test(text.trim())) return null;
  // "Hold Messana" is a place to be held, not an army to be stopped.
  const place = provinceNamed(world, text);
  const { force, ambiguous } = armyNamed(world, playerId, text, warfare);
  if (force === null || ambiguous || !ARMY_NOUN.test(text) && place === null) return null;
  if (place !== null && !/\b(army|legions?|troops|men|host|force)\b/i.test(text) && place !== force.locationId) return null;
  return {
    part: { said: text.trim().slice(0, 200) },
    deltas: [WorldDeltaSchema.parse({ op: "force_modify", forceRef: force.id, hold: true, reason: `${force.name} holds where it stands, by its commander's word.` })],
    delegations: [], template: "hold", domain: "military",
  };
}

function taxClause(world: WorldState, playerId: string, text: string): Clause | null {
  const match = /\b(?:set|fix|lay|raise|lower|reduce|cut|put|make|increase)\b.*?\b(?:the\s+)?(?:tribute|tax|taxes|tax\s+rate|tithe)\b.*?\b(?:to|at)\s+(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent|in\s+a\s+hundred)/i.exec(text);
  if (match === null) return null;
  const player = world.characters.find((character) => character.id === playerId);
  if (player?.polityId == null) return null;
  const rateBps = Math.round(Number(match[1]) * 100);
  if (!Number.isFinite(rateBps) || rateBps < 0 || rateBps > 5_000) return null;
  return {
    part: { said: text.trim().slice(0, 200) },
    deltas: [WorldDeltaSchema.parse({ op: "tax_policy_set", scope: "polity", polityId: player.polityId, provinceId: null, regime: "land_levy", rateBps, reason: `The tribute is laid at ${match[1]} in a hundred, by the order of ${player.name}.`.slice(0, 240) })],
    delegations: [], template: "tax", domain: "administration",
  };
}

/** What each public work is, what it stands for, and what it costs at the scale of a power that takes in 300 000 a month. */
const WORKS: readonly { readonly word: RegExp; readonly name: string; readonly structure: "depot" | "wall" | "watchtower" | "fortress" | "market" | "temple" | "other"; readonly effects: readonly { quantity: string; band: string }[]; readonly cost: number; readonly days: number }[] = [
  { word: /\bdepots?\b|\bstorehouses?\b|\bmagazines?\b/i, name: "depot", structure: "depot", effects: [{ quantity: "supply", band: "marked" }], cost: 3_000, days: 30 },
  { word: /\bgranar(?:y|ies)\b|\bhorrea\b/i, name: "granary", structure: "other", effects: [{ quantity: "food_security", band: "marked" }], cost: 5_000, days: 60 },
  { word: /\broads?\b|\bcauseway\b/i, name: "road", structure: "other", effects: [{ quantity: "development", band: "marked" }], cost: 8_000, days: 90 },
  { word: /\baqueducts?\b/i, name: "aqueduct", structure: "other", effects: [{ quantity: "stability", band: "marked" }, { quantity: "development", band: "slight" }], cost: 14_000, days: 150 },
  { word: /\bwalls?\b|\bramparts?\b/i, name: "walls", structure: "wall", effects: [{ quantity: "defense", band: "marked" }], cost: 9_000, days: 90 },
  { word: /\bwatch-?towers?\b/i, name: "watchtower", structure: "watchtower", effects: [{ quantity: "defense", band: "slight" }], cost: 1_800, days: 30 },
  { word: /\bfort(?:ress)?\b/i, name: "fortress", structure: "fortress", effects: [{ quantity: "defense", band: "marked" }], cost: 20_000, days: 150 },
  { word: /\bmarket(?:-?place)?\b/i, name: "market", structure: "market", effects: [{ quantity: "income", band: "slight" }], cost: 5_000, days: 60 },
];

function buildClause(world: WorldState, playerId: string, text: string): Clause | null {
  if (!/^(?:please\s+)?(?:build|construct|raise|repair|found|lay\s+down|erect|begin)\b/i.test(text.trim())) return null;
  const work = WORKS.find((candidate) => candidate.word.test(text));
  if (work === undefined) return null;
  const player = world.characters.find((character) => character.id === playerId);
  if (player?.polityId == null) return null;
  const provinceId = provinceNamed(world, text) ?? player.locationProvinceId;
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  if (province === undefined) return null;
  // A power's work is done in its own ground, or where it holds the army: not in another's country.
  if (province.controllerPolityId !== player.polityId) return null;
  const chest = chestOfPower(world, player.polityId);
  if (chest === null) return null;
  const scale = Math.max(0.05, Math.min(3, monthlyTakings(world, player.polityId) / 300_000));
  const named = /\b(?:for|costing|at\s+a\s+cost\s+of)\s+(\d[\d,]*)\b/i.exec(text);
  const cost = named === null ? Math.max(500, Math.round(work.cost * scale)) : Math.max(100, Number(named[1]!.replace(/,/g, "")));
  const label = `${work.name[0]!.toUpperCase()}${work.name.slice(1)} at ${province.name}`.slice(0, 120);
  return {
    part: { said: text.trim().slice(0, 200) },
    deltas: [WorldDeltaSchema.parse({
      op: "project_create", localId: safeLocalId(`${work.name}_${province.id}`).toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60), kind: work.name, label,
      sponsorRef: { kind: "polity", id: player.polityId }, fundingAccountRef: chest,
      milestones: [
        { label: `The ground is cleared and the stuff gathered`, dueInDays: Math.max(7, Math.round(work.days / 3)), costAmount: Math.round(cost / 2) },
        { label: `The ${work.name} is finished`, dueInDays: work.days, costAmount: cost - Math.round(cost / 2) },
      ],
      completionOutcome: { kind: "structure", label, amount: work.structure === "other" ? 0 : 200, provinceId: province.id, polityId: player.polityId, structureKind: work.structure,
        effects: work.effects.map((effect) => ({ quantity: effect.quantity, direction: "raise", band: effect.band, scope: "here" })) },
      reason: `${player.name} orders a ${work.name} raised at ${province.name}.`.slice(0, 240),
    })],
    delegations: [], template: "build", domain: "public works",
  };
}

function levyClause(world: WorldState, playerId: string, text: string): Clause | null {
  const match = /^(?:please\s+)?(?:raise|levy|muster|recruit|enlist)\s+(?:a\s+(?:levy|force)\s+of\s+)?(\d[\d,]*|one|two|three|four|five|six|eight|ten|twelve|twenty)\s*(?:thousand\s+)?(?:more\s+)?men\b/i.exec(text.trim());
  if (match === null) return null;
  const player = world.characters.find((character) => character.id === playerId);
  if (player?.polityId == null) return null;
  const base = /^\d/.test(match[1]!) ? Number(match[1]!.replace(/,/g, "")) : NUMBER_WORDS[match[1]!.toLowerCase()] ?? 0;
  const men = /\bthousand\b/i.test(match[0]) ? base * 1_000 : base;
  if (!(men >= 100 && men <= 60_000)) return null;
  const at = provinceNamed(world, text) ?? player.locationProvinceId;
  const province = world.map.provinces.find((candidate) => candidate.id === at);
  if (province === undefined || province.controllerPolityId !== player.polityId) return null;
  const polity = world.map.polities.find((candidate) => candidate.id === player.polityId);
  return {
    part: { said: text.trim().slice(0, 200) },
    deltas: [WorldDeltaSchema.parse({
      op: "force_create", localId: safeLocalId(`levy_${province.id}_${men}`).toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60), name: `Levy of ${polity?.name ?? "the power"} at ${province.name}`.slice(0, 120), polityId: player.polityId,
      commanderCharacterRef: player.id, controllerCharacterRef: player.id, locationId: province.id, authorizedStrength: men, payObligationRef: null,
      reason: `${player.name} calls ${men} men to the standards at ${province.name}.`.slice(0, 240),
    })],
    delegations: [], template: "levy", domain: "military",
  };
}

const TEMPLATES: readonly ((world: WorldState, playerId: string, text: string, warfare?: ScenarioWarfareRules) => Clause | null)[] = [supplyClause, holdClause, taxClause, buildClause, levyClause];

/** The clauses of an order: its lines, and its sentences. */
export function clausesOf(order: string): string[] {
  return order.split(/\r?\n+|(?<=[.;!?])\s+/).map((clause) => clause.trim().replace(/[.;!?]+$/, "")).filter((clause) => clause.length > 0);
}

/**
 * The order read by template, or null where any clause of it is not in the table. Nothing is written to the world here: the output is the orchestrator's own shape,
 * for the burst to apply as it would have applied his.
 */
export function matchOrderTemplates(world: WorldState, playerId: string, orderText: string | null, warfare?: ScenarioWarfareRules): TemplateMatch | null {
  if (orderText === null || orderText.trim().length === 0 || orderText.length > 400) return null;
  const clauses = clausesOf(orderText);
  if (clauses.length === 0 || clauses.length > 4) return null;
  const read: Clause[] = [];
  for (const text of clauses) {
    if (NOT_FOR_A_TEMPLATE.test(text) || /\?\s*$/.test(text)) return null;
    // A clause that fits two templates ("raise three thousand men and feed them") is two orders, and not for a template.
    const hits = TEMPLATES.map((template) => template(world, playerId, text, warfare)).filter((candidate): candidate is Clause => candidate !== null);
    if (hits.length !== 1) return null;
    read.push(hits[0]!);
  }
  const deltas: WorldDelta[] = [];
  const parts = read.map((clause) => ({ said: clause.part.said, acts: clause.deltas.map((delta) => { deltas.push(delta); return deltas.length - 1; }), goals: [], spend: null, factLocalIds: [], whyNot: clause.part.whyNot ?? null }));
  const delegations = read.flatMap((clause, index) => clause.delegations.map((delegation, at) => ({
    localId: safeLocalId(`${clause.template}_${index}_${at}`), issuerRef: { kind: "character" as const, id: playerId }, recipientRef: { kind: "character" as const, id: delegation.recipientId },
    claimedAuthorityGrantRef: null, instruction: delegation.instruction, part: index, ask: delegation.ask,
  })));
  const output = OrchestratorOutputSchema.parse({
    intent: { summary: read.map((clause) => clause.part.said).join("; ").slice(0, 280), domains: [...new Set(read.map((clause) => clause.domain))].slice(0, 6), parts },
    narrativeSummary: (read.map((clause) => clause.note).filter((note): note is string => note !== undefined).join(" ") || "The order was understood as it was given, and put in hand.").slice(0, 600),
    frictions: [], deltas, facts: [], delegations, schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  });
  return { output, templates: read.map((clause) => clause.template) };
}
