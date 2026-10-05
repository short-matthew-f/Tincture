# v0.2 contracts (shared by every worker on the v0.2 plan)

Read `docs/PLAN-v0.2.md` (the Amendments section first) and this file before
touching code. Decisions taken: prices shown from the start; no Purify coin
gate; all difficulty tiers free, revealed by colors; diagonals stay; line
sequence ~1.5 s with a pause; haptics unchanged (iPhone has none; sound and
motion carry weight).

## State additions (SAVE_VERSION 2)

```js
state.unlocks = {                       // coin-bought systems; reset on Renovate
  shelf: false, hunters: false, gallery: false, shipping: false, commissions: false,
}
state.shelf = { cols: 6, rows: 6, cells: Array(36), colors: ['madder', ...≤5], waiting: 0, ... }
  // `rowLabels` removed; `colors` = the five chips; `waiting` = vials piled
  // behind the glass before the shelf is bought (becomes vials on unlock)
state.keep = { [colorId]: jars }        // shop sells only above this; default 20 for pinned
                                        // colors and colors used by a started painting
state.settings.puzzleTier.purify = 'relaxed'
state.onboarding.seen = { [guideId]: true }   // one entry per subgame guide
state.stats.lines = 0; state.stats.lineSkips = 0; state.stats.wrongDrops = 0;
state.stats.rejectedDrags = 0; state.stats.coachDismissed = 0
state.stations.mixers starts with TWO mixers.
```

`migrate` v1 → v2: add `unlocks` and grant any system the save already
used (shelf had containers → shelf: true; roster non-empty → hunters: true;
gallery.unlocked → gallery; rooms has loading-yard → shipping; phase ≥ 3 →
commissions); add a second mixer if there is one; shelf 35 → 36 cells in
reading order, drop `rowLabels`, derive `colors` from containers present
(max 5); add `keep`, `puzzleTier.purify`, `onboarding.seen`, stats counters;
set `flags.whatsNew = '0.2'` so the UI shows the one-time paper note.

## Unlocks (src/sim/unlocks.js)

```js
export const UNLOCKS = [
  { id: 'shelf',       name: 'Merge Shelf',   revealColors: 8,  cost: 400,   object: 'shelf' },
  { id: 'hunters',     name: 'Hue Hunters',   revealColors: 15, cost: 2500,  object: 'map-window' },
  { id: 'gallery',     name: 'Gallery Wing',  revealColors: 25, cost: 8000,  room: 'gallery-wing' },   // the room IS the purchase
  { id: 'shipping',    name: 'Loading Yard',  revealColors: 35, cost: 40000, room: 'loading-yard' },  // the room IS the purchase
  { id: 'commissions', name: 'Commissions',   revealColors: 30, cost: 20000, requiresPhase: 3 },
];
export function status(state, id) -> { id, name, cost, revealColors, colorsLeft, revealed, affordable, open }
export function canBuy(state, id) -> boolean
export function buy(state, { id }, now) -> { ok, reason? }   // deducts coins, sets unlocks[id] (and buys the room for gallery/shipping), emits 'unlock' {id}
export function batchRebuy(state, now) -> { ok, cost, ids }   // after Renovate: one purchase reopens everything that was open before
export function tierRevealed(state, tier) -> boolean          // steady 10, tricky 25, master 45 colors; always free
```

`shelf.unlocked`, `hunters.unlocked`, `gallery.unlocked`, commissions and
shipping availability all read `state.unlocks.*` (not color counts).
`prestige.renovate` records `state.renovateReopen = [ids]` and resets
`unlocks`; Heritage tree gains `keep-shelf`, `keep-map`, `keep-gallery`
nodes that skip the reset.

## Spillover before the shelf is bought

From 6 discovered colors, `tickSpillover` increments `state.shelf.waiting`
(cap 12) instead of placing vials. `buy('shelf')` converts `waiting` into
vials on the new shelf. The workshop's shelf tag reads "N vials waiting".

## Discovery slowdown

`grading.revealedTints`: relaxed 1, steady 1, tricky 2, master 2. Happy
accidents: Phase 1 every 4 h of production, later 6 h.

## fx.js motion vocabulary (src/ui/fx.js)

```js
spring(el, { from, to, preset: 'soft'|'firm'|'heavy' }) -> Promise  // WAAPI with a precomputed spring curve; `from`/`to` are keyframe objects
lift(el), settle(el)                      // scale 1.06 + shadow on pointerdown; 3% overshoot on release
drag(el, { board, cellAt, onMove, onDrop, magnet })  // see below
coinArc(fromEl, toEl, n) -> Promise       // coins fan out then converge; resolves when the last lands
stamp(el, text) -> Promise                // a paper stamp lands with squash + thunk
pour(svg, hex, from) -> Promise           // existing pourFill + surface wobble
```

`drag` contract: pointer capture; 8 px threshold; the ghost is drawn fully
above the finger (base at y − 12); the drop resolves at the ghost's base
via `board.cellAt(x, y)` (board-local maths to the nearest cell, bounds
+12 px); hysteresis (target changes 25% into a neighbour); `magnet(cell)`
returns a score so legal partners within 24 px win over empties; no
positional lag; tilt from velocity capped 6°; `pointercancel` restores the
source. Emits `onMove(cell)` for highlights and `onDrop(cell)`.

## guide() coach mechanism (src/ui/guide.js)

```js
guide(id, steps, ctx) -> { start(), stop(), replay() }
// steps: [{ anchor: '[data-coach=x]', text: ≤15 words, when?: (state) => boolean, endsOn?: 'action'|'got-it', side?: 'above'|'below' }]
```
Runs once per `id` (persists in `state.onboarding.seen`), at most 2 steps
before the first action step, never covers its anchor or shares the screen
with a toast or sheet (it pauses toasts), waits for `when` triggers, and
exposes `replay()` for the "How this works" link each subgame header shows.
`whatsNext(ctx, { more, next })` renders the two-choice card after a first
success or on leaving a subgame; it never navigates on its own.

## Single "Next" button (workshop)

`sim.next(state, now) -> { label, action, cost?, affordable }` picks one
thing: the flow-meter suggestion when affordable, else the cheapest
affordable upgrade, else the Almost-there item nearest completion, else
"Collect". The home screen renders exactly one primary button from it.

## Line rule (src/sim/shelf.js)

`findLines(state) -> [{ kind:'row'|'col'|'diag', cells:[6 idx], family }]`
(full lines of one hue family; golden counts as any). `resolveLines(state,
now) -> { lines, tier, value, coins, double }`: all lines found in one
check resolve together; tier = highest TIER_VALUES sum allows; value ×1.5
(×2 more for a double); coins credited; cells cleared; Cask → Essence to
the family's most-stocked color. Called after every merge/move; a chain
finishes first. Diagonals included.

## Purify

Spawn: at most one muddy batch per random 2–3 min while producing, backlog
10, offline catch-up adds at most 3. `isSolved`: every non-empty tube is
uniform AND full. Tiers relaxed 4/6 (free extra tube), steady 6/8, tricky
8/10, master 9/11; rewards pure/pure/flawless/flawless and reward minutes
4/6/10/16; `sizeForTier(tier)`. Muddy batches never block All caught up.
