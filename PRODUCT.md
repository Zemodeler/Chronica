# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Grand-strategy players first: people who know Crusader Kings, Europa
Universalis and their kin, and want a sandbox where a written order replaces
the menu of verbs. They play alone, at a desktop, at their own pace, and they
read.

Right now the site is seen by an invited playtest group, not by strangers.
Coins are mostly given, as gift codes, rather than bought.

## Product Purpose

Chronica is a single-player historical world. You play one person inside a
curated scenario, such as Rome in 270 BC, and you act by writing what you want
in ordinary language. The world carries it out, time passes, and you read a
Chronicle of what happened, written only from what your character could know.

It succeeds when a player forgets they are giving commands to a system and
starts thinking like the person they chose to be.

## Positioning

**Play anyone.** A consul, a senator short of money, a Carthaginian merchant,
a legionary in the ranks, an outlaw: any person in the scenario, historical or
invented. The game does not pick a ruler for you. Each role sees a different
world, because what you hold, whom you can reach and what you hear all follow
from who you are.

Two things back that up and no menu-driven strategy game can copy them:

- Orders are plain language. The AI decides what your officials actually do
  with an order; the engine owns the arithmetic, the calendar and the record,
  so the consequences hold.
- The world waits. Nothing moves until you send an order, and between orders
  the world is perfectly still.

## Operating Context

The loop: write an order, the world carries it out and time passes, read what
happened, write the next one.

The game is played in two places: the Office, a painted room whose objects open
the Chronicle, letters, the treasury, the muster roll, the council and the
player's own standing; and the Map, an atlas of the Mediterranean in 270 BC.
Outside the game there are the saves shelf, the scenario list, character
creation ("Who do you want to play as?"), the account, and coins.

A turn can take real seconds while the world moves. Sending an order spends
coins, because turns run on paid model calls.

## Capabilities and Constraints

- Desktop browser only. Layouts use a min-width floor (1200px in the game),
  not responsive fallbacks.
- At most three saves per account.
- Two scenarios today, *Punic Wars* (270 BC) and *The Numidian Decision*
  (264 BC). Multiplayer is out of scope.
- Character creation researches the person you describe with a model call, so
  it costs money; the Office cannot be reached without it.
- One coin is US$1. A save has a spending cap set when it is created.
- Sign-in and billing work without JavaScript.
- Undecided: when and how the game opens to strangers, and what a signed-out
  visitor should see. Today they are sent straight to the login page.

## Brand Commitments

- The name is Chronica. There is no logo mark yet; the wordmark is set in
  Alegreya.
- The game's voice is the world's voice: plain, historical, never gamified
  ("Sending for the muster roll…"). Sentence case and plain verbs throughout.

## Evidence on Hand

- Painted Office rooms for five cultures (Roman, Carthaginian, Greek, Gallic,
  neutral), each with an empty variant, and cut-out objects for the Roman room:
  `apps/web/public/office/`. The art brief is `docs/office-art.md`.
- The atlas map tiles: `apps/web/public/maps/`.
- Six account avatars: `apps/web/public/avatars/`.
- Real Chronicle prose is produced in play; there is a sample passage in
  `docs/VISION.md` §25.
- There are no testimonials, press, player counts or reviews. Do not invent
  any.
- Every save and scenario uses the same thumbnail,
  `apps/web/public/images/basic-scenario-map.png`. There is no key art for
  each scenario yet.

## Product Principles

1. **The person, not the throne.** Who you chose to be decides what you see,
   what you may do and what it costs you.
2. **The world is still until you speak.** Nothing happens behind the player's
   back; the pace is theirs.
3. **Words, not verbs.** An order is written, not picked from a list, and the
   shorter it is, the more the player has left to others.
4. **What you know is not what is true.** The player learns only what their
   character could have learned, and news takes time to travel.
5. **Consequences persist.** Money, time, promises and breaches are kept
   exactly, and the world remembers them.

## Accessibility & Inclusion

Desktop only, but accessible on its own terms: real controls, a sensible tab
order, visible focus, and labels a screen reader can use. Text meets 4.5:1
contrast; `prefers-reduced-motion` turns motion into cuts.
