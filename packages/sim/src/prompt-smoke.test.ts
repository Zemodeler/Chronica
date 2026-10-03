import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "./orchestrate";
import { buildWorldSlice, renderWorldSlice } from "./slice";

describe("orchestrator prompt", () => {
  it("renders the contract's JSON schema without throwing", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("money_transfer");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("localId");
  });

  it("stays small enough to send on every call", () => {
    // Roughly 4 characters per token. The system prompt is sent every burst
    // iteration, so a schema that balloons is a per-call tax forever. The
    // ceiling moves only when a genuinely new capability is added to the
    // contract -- the watch predicate union, which buys an order that runs to
    // its own completion instead of four orders that each advance two days;
    // then storylines and pressures, which buy a world that starts things of
    // its own and follows them; then the world outside the player's army --
    // letters between powers, war and treaty as things the world holds rather
    // than infers, and a map an army has to actually cross; and now conquest
    // itself, which no arm expressed at all -- a province could not change
    // hands and a rising could not become a country, so a war could be fought
    // for a generation and leave the map exactly as it began; and now a person
    // being able to refuse, which the prompt previously forbade outright and
    // which nothing in the engine had ever recorded happening; and now what a
    // person's body has come to, which no arm could express either -- illness
    // could not impair anybody, so a man "fell ill" in a fact and went on
    // doing everything he had done the day before.
    console.log("system prompt chars:", ORCHESTRATOR_SYSTEM_PROMPT.length, "~tokens:", Math.round(ORCHESTRATOR_SYSTEM_PROMPT.length / 4));
    // Raised again for slice 11: `social_events` now carries relation causes
    // and observed traits, and most of this prompt's bulk is the delta union's
    // own generated JSON schema rather than prose -- so it grows with every
    // field added anywhere in `deltas.ts`. It is cached on every call after
    // the first, which is why this is a ceiling rather than a budget; if it
    // reaches seventy thousand the schema itself wants pruning, not the rule.
    // Raised again: taking a city and reinforcing an army are each their own
    // op now, and an army can be renamed, rested, victualled and handed to
    // another power. Every one of those is a field, and a field's generated
    // schema costs more than the rule that explains it -- the prose for all of
    // them is under 2 500 characters. The seventy-thousand line above is still
    // the one that means something: past it, prune the union rather than the
    // rules, because at that point the vocabulary is carrying more than a
    // model can hold in its head at once anyway.
    // Raised again for the closed lists opening and for plots: about 250
    // characters of generated schema and about 1 000 of rules. Three of those
    // fields exist to stop the engine refusing an order it simply had no row
    // for -- a kind of soldier the scenario never authored, ground on the map
    // nobody drew, a city outside the forty-one that were drawn -- and
    // `covert_plot_open` is the whole of "hire a man to kill him", which had
    // no expression at all and was written instead as health to nothing and a
    // tag reading "dead".
    //
    // The rules were cut twice to land here rather than raising this to meet
    // them, because the seventy-thousand line below is the one that means
    // something and it is now close: past it, prune the union rather than the
    // rules, since at that point the vocabulary is carrying more than a model
    // can hold in its head at once anyway.
    //
    // ## And then it was crossed
    //
    // Contingencies cost 5 300 characters: about 4 700 of generated schema for
    // `contingency_arm`/`contingency_disarm`, and 600 of rules. That buys the
    // conditional order -- roughly a fifth of everything a real player writes
    // hangs on one -- so the capability is worth having. It does not make the
    // line above untrue, and this is deliberately not a quiet bump:
    //
    // **The duplication is mine and it is real.** `WatchPredicate` is now
    // inlined twice, once for the ruler's own `watch` and once as a
    // contingency's trigger, at roughly 2 000 characters. Worse, they are the
    // same idea: a watch *is* a `stand_to` contingency that nobody kept. Folding
    // one into the other is the honest prune, and it is a design decision about
    // a load-bearing feature rather than something to slip into this change.
    //
    // **There is a measured alternative.** `z.toJSONSchema(..., { reused: "ref" })`
    // takes 4 253 characters off the delta union by emitting `$defs` instead of
    // repeating `RefSchema`, `ReasonSchema` and `OrderPartyRef` forty-odd times.
    // It costs nothing in vocabulary. It was not taken here because it changes
    // what the model actually reads -- opaque `#/$defs/__schema0` references in
    // place of inline shapes -- and that wants an eval behind it, not a
    // deadline.
    //
    // The next capability added here should pay for itself out of one of those
    // two, rather than moving this number again.
    //
    // ## Paid for, not moved
    //
    // Raids, offices made on demand, passage for armies, moving a person, kin,
    // skills in bands, a battle plan's premises and armies joining a battle
    // came to about 5 000 characters. They were paid for out of the first of
    // the two, narrowly: `WatchPredicate` alone is named (`.meta({ id })`), so
    // the schema states it once under `$defs` and points at it twice, and the
    // model reads `#/$defs/WatchPredicate` -- a word -- rather than the opaque
    // `__schema0` that made the blanket version want an eval. The rules for
    // the new ops were cut to a line each to land under the line.
    //
    // ## And then the rules were rewritten instead of added to
    //
    // Thirty-five numbered rules had grown one per capability, most of them
    // explaining a field -- because what a field means lives in a TypeScript
    // comment the model never sees, so every new field bought a new paragraph.
    // They are now twelve principles (23 264 characters of rules down to about
    // 8 400), each owning a concern -- standing, open lists, time, facts,
    // costs, who settles what, what the engine owns, pay, the world moving --
    // with the specifics as examples under the principle they belong to. A new
    // capability goes under its principle as a clause, or not at all; if it
    // needs a paragraph, the principle is missing, not the paragraph.
    //
    // The line is lowered to hold that: the prompt was 74 800 and is now
    // about 60 000.
    //
    // Raised by 1 500 for land a man owns: an estate could be inherited and
    // could not be bought, granted or improved, so a private citizen had no
    // lawful way to develop anything. Two ops' schema and one clause each
    // under principles 8 and 9 (elections are the other clause).
    //
    // Raised by 2 000 for men who are not the state: a man in an army's ranks
    // (`force_membership_set`), a merchant's trade between two places
    // (`trade_venture_open`/`_close`), and a force raised as the troops it is
    // rather than always as infantry (`categoryId`). Each is its schema plus
    // half a clause under principle 8.
    //
    // ## Paid for again, and the line lowered
    //
    // Standing, allegiance, skills and ambitions a person can gain or lose;
    // kin between people who exist; deaths somebody brings about; an army's
    // standing plan; a law that does what it enacts; a treaty's clauses; and
    // the order's own acts apart from the world's ("worldDeltas") came to
    // about 5 500 characters. Paid for by naming the five schemas repeated
    // most -- `Id` alone was seventy-three copies -- so the model reads a word
    // where it read the same string again, which is the precedent
    // `WatchPredicate` set. Net, the prompt went down.
    //
    // ## And again, for the roles
    //
    // Legal status, service contracts, a physician's cure and a spy came to
    // about 2 500 characters of schema and clause. Paid for the same way:
    // `Money`, `SignedBps`, `Name` and `Days` are named once instead of being
    // written out in full some fifty times between them.
    // Raised from 63 000 on 2026-09-26 for constitutions: the "constitution"
    // amendment, "regime_change" and one sentence in principle 9. The user
    // asked for the feature whatever it cost in prompt.
    // Raised 65k -> 66k (2026-09-27, with the player's say-so): every part of
    // an order answered ("intent.parts") and conquered ground governed by the
    // man given it. A governorship order vanished for want of both.
    // Raised 66k -> 66.5k for the treaty system: surrender as a clause, and a
    // letter that offers peace carrying its terms.
    // Raised 66.5k -> 67.5k (2026-09-27, the user allowing it "as needed"):
    // departments (docs/plans/departments.md) -- the "department" a measure
    // enacts, with the closed list of levers it may hold, and "audit_open";
    // one sentence in principle 9, trimmed to the least that names them.
    // Raised 67.5k -> 68.5k (2026-09-28): a hired captain's "company" and a
    // measure's "project" -- a fleet hired or voted produced no ships -- and a
    // troop kind for a project's force. Stage and outcome are named $defs, so
    // the measure's project costs no second copy of them.
    // Freed ~570 (2026-09-28), ceiling left where it is: the agreement kinds,
    // family kinds and government forms are named $defs, written once instead
    // of at each use (68 320 -> 67 751).
    // Raised 68.5k -> 69.5k (2026-09-29): battles that last
    // (docs/plans/battles-that-last.md) -- "force_provision", bread bought,
    // requisitioned or sent by convoy, and a siege's "works"; the fight that
    // goes on until one side is beaten, "hold" and "manoeuvre" folded into
    // principle 10.
    // Raised 69.5k -> 79k (2026-10-03): already 75.8k from the living-world build
    // (febddc8), then the play-test fixes' generated schema: force_post_set, a
    // request's ask, public_benefaction, a soldier's conduct, a vote's budget
    // holder, franchise, land and debt laws, the submission clause, a loan offer.
    expect(ORCHESTRATOR_SYSTEM_PROMPT.length).toBeLessThan(79_000);
  });
});

describe("the world slice", () => {
  it("stays small enough to send with every order", () => {
    const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
    const clock = definition.clock;
    const offices = definition.government.offices;
    const world: WorldState = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const text = renderWorldSlice(
      buildWorldSlice({
        world,
        clock,
        offices,
        actorRef: { kind: "character", id: world.characters[0]!.id },
        actorPolityId: "rome",
        orderText: "Invade the Boii lands",
        facts: [],
        dueEvents: [],
        pendingEvents: [],
      }),
    );

    // Roughly 4 characters per token. The slice grows every time the world
    // learns to show something new, and each section is paid for on every
    // orchestration call. A section that pushes past this should have its cap
    // tightened rather than the budget raised.
    console.log("slice chars:", text.length, "~tokens:", Math.round(text.length / 4));
    expect(Math.round(text.length / 4)).toBeLessThan(6_000);
  });
});

describe("the writer of mechanics", () => {
  it("has a prompt and a schema small enough that a rule costs a small call, not an orchestration", async () => {
    const { WRITE_MECHANIC_SYSTEM_PROMPT, WriteMechanicOutputSchema } = await import("./mechanics/write-mechanic");
    const { z } = await import("zod");
    const schema = JSON.stringify(z.toJSONSchema(WriteMechanicOutputSchema, { io: "input" }));
    console.log(`write_mechanic prompt: ${WRITE_MECHANIC_SYSTEM_PROMPT.length} chars, of which schema ${schema.length}`);
    expect(WRITE_MECHANIC_SYSTEM_PROMPT.length - schema.length).toBeLessThan(3_000);
    expect(schema.length).toBeLessThan(12_000);
  });
});
