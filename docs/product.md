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

What is yours is yours to use. Spending your own purse, buying land with it, or improving your own
estate needs nobody's leave. Spending the treasury, granting public land, or developing a province
you do not govern is the government's business.

## Soldiering

You can serve in the ranks. Declare yourself a legionary, a hoplite or a rower and you are enlisted
in an army of your own country and stand where it stands; declare yourself an officer and you
command. A man in the ranks shares his army's fortune in battle — he can come through, be wounded,
be maimed, or die, as often as the men beside him do — and the Chronicle tells him what became of
him. His comrades and his officer notice what happens to him, and if he deserts, his side knows it
and his commander hears of it.

## Trading

A merchant puts money into trade between two places — from Syracuse to Messana, say — and the
engine says what that costs and what it returns each month: no richer than the poorer end. A war
with the power at the far end stops it, and so does an enemy fleet off either of its ports; he is
told when it stops and when it starts again. He can fit out a ship of his own and command it,
lend his own money to his government, and hear the news of the ports his trade runs through.

## Offices

Offices change hands on the calendar. A Roman consul serves a year; when his term ends the seat
falls vacant, and the men who could win it are told so. One of them may call the Senate to an
election — or you may, and stand yourself. If nobody does within a month, the election is called
anyway. On polling day the vote is counted: a candidate's standing, plus whoever has declared for
or against him. You can win an office by standing for it and gathering backing; you are never
handed one you did not seek.

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

A country's taxes are bounded by what its lands can bear, and that depends on how orderly they are.
Raise the tributum a little and it pays. Raise it hard and it still pays, but the provinces grow
sullen. Raise it past what the land can give and the collectors come back short while order breaks
down — so a tax multiplied by five ends the year raising less than one tripled. Your treasury shows
how hard you are pressing.

Men own land. The leading figures have estates that pay them every month, and anyone can buy an
estate with his own money or improve the one he has; the engine, not the AI, says what land costs
and what it yields. An improvement pays for itself in about two and a half years, and no estate
yields more than its land can give.

## Not in the game yet

Combat, diplomacy and espionage exist now: battles are resolved phase by phase, letters and
agreements pass between powers, and plots are laid and discovered. What is still missing is deeper
economic modelling beyond incomes, estates, ventures and the tax ceiling, and mechanics the world
invents for itself rather than picks from a list. Multiplayer is out of scope.
