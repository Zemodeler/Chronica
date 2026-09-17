# Product guide

What the game is, and how it plays today. For where it is going, see
[VISION.md](VISION.md); for how it is built, see [architecture.md](architecture.md).

## The game

A single-player historical world. You play one person inside a curated scenario — a Roman consul in
264 BC, say — and you rule by writing what you want in ordinary language:

> Raise two new legions.

There is no menu of verbs and no build queue. The AI decides what your government actually does
about the order: where recruitment happens, who pays for it, who is put in charge, how long it
takes, and who else notices. The engine owns the arithmetic, the calendar, and the record, so the
consequences persist and stay consistent.

## The loop

```
write an order → the world carries it out and time passes → read what happened → write the next one
```

**The world moves only when you send an order.** Between orders it is perfectly still. This is
deliberate: it is your game, paced by you, and nothing happens behind your back while you are
reading.

When you send one, the world advances to the next moment that matters — far enough for word to
travel and for the people your order touched to answer it, then on to whatever was next on the
calendar. A single order can therefore carry the world days or months, depending on what is pending.

You get back a **Chronicle**: a short historical passage covering what happened since your last
order. Occasionally, instead, you get a **decision** — a fork that genuinely needs your own
authority, like a peace offer. Those are meant to be rare.

## What the AI decides, and what it cannot

The AI has real authority over causality. It reads your intent, invents the officials and
institutions the situation needs, and creates plausible consequences.

It cannot do arithmetic, invent identities, or pick dates. It proposes a change; deterministic code
validates it, assigns every id, and applies it. So a treasury never drifts, a person the world
invented never quietly vanishes, and nothing is scheduled into the past.

## Delegation

The shorter the order, the more you have delegated.

- *Raise two legions* leaves financing and method to your officials.
- *Raise two legions, but do not borrow money* takes the financing decision back.

Orders aimed at a person become something that person decides about. They can accept, delay, refuse,
ignore — or comply with an order you had no right to give, which is recorded as subversion rather
than obedience. Competence and loyalty therefore matter: two officials given the same instruction
will not do the same thing with it.

## Authority

Acting beyond your authority is not blocked. It is recorded as a breach. A general who marches
without orders has not done something impossible; he has committed insubordination, and the world
will remember it. This is what makes coups, embezzlement, and unauthorised wars possible at all.

## What you know

The world distinguishes what is true from what you know. A secret arrangement exists the moment it
happens, but reaches you only if someone tells you, and news takes time to travel. Your Chronicle is
written strictly from what your government could actually have learned — if a senator is plotting
against you and nobody has discovered it, the Chronicle will not mention it.

## Conversations

You can talk to the people your character can reach. Conversations are not a side channel: what you
are told enters what you know, what you promise becomes an obligation the world will hold you to,
and either can be the reason someone acts later. A private conversation stays private to the people
in the room.

## Money and time

Once something is established — a tax, an army's wages, a construction programme — it runs on
arithmetic, not judgment. Revenue is collected, wages are paid, and projects reach their milestones
as the days pass, with no model involved. An army that cannot be paid falls into arrears, and that
is recorded as the political fact it is.

The AI is involved when circumstances *change* the economy: a new tax, a blockade, a conquest, a
debt crisis.

## Not in the game yet

Combat resolution, diplomacy as a system, espionage and intrigue, and deep economic modelling.
The engine they will plug into exists; the systems themselves do not. Multiplayer is out of scope.
