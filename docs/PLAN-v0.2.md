# Plan: v0.2 — pacing, gating and the three puzzle fixes

Written 2026-10-04 from playtest notes (Matthew and his wife, builds 0.1.0–0.1.3).
No code has changed yet. This is the work order for the next session.

## Amendments after the UX handbook review (2026-10-05)

Source: `docs/UX-GUIDELINES-REVIEW.md` (handbook under `ux_guidelines/`).
These override the matching items below. Three of them touch Matthew's
own directions and are marked **needs Matthew**.

**Order of work changes.** Step 1 now also builds the two UI foundations
everything else consumes, so the shelf drag and the onboarding are built
once: `fx.js` motion vocabulary (spring, lift/settle, `drag` with
board-local hit testing, ghost offset, hysteresis, magnet, coin arc, stamp)
and the `guide()` coach mechanism with its hygiene rules. Theme F's
per-screen feel pass then uses that vocabulary at step 6. A step 0
(15 minutes of decisions) comes first. Full table in the review, §E.

**Theme A (pacing and gating)**
- Show the price from the start: the tag reads "Shelf: 8 colors · 400
  coins, 3 more colors". Never hide a number she could plan toward.
- Let her feel the need first: from 6 colors, spillover vials visibly stack
  behind the closed shelf's glass ("6 vials waiting"); buying opens a
  stocked shelf. Same pattern later for the map window (a knock, "Wren is
  waiting").
- Tapping a locked object opens a "What this opens" sheet (one looping
  illustration, one sentence, the price). Every purchase plays a shared
  1.5 s `unlockCeremony` in the scene that hands off to that subgame's
  guide.
- **Drop the Purify coin gate.** The first muddy batch is already a felt
  need; charging between a problem and its fix is a toll, and it conflicts
  with Theme C's tutorial-on-first-batch. *Needs Matthew: it narrows "pay
  for every new game" to shelf, hunters, gallery, shipping, commissions.*
- **Grading tiers stay free**, revealed by colors one segment at a time
  (Steady at 10, Tricky at 25, Master at 45). Decision 4 already made
  purify tiers free; two rules for one control is worse. *Needs Matthew.*
- The third mixer (~60 coins) is the flow-meter suggestion right after
  the tutorial: the first-session "new possibility".
- Easel: greyed colors carry a paper tag "Set a mixer to make this" and
  open the mixer picker as a sheet over the easel, never a navigation away.
- Shop reserve: the default "keep 20 jars" does the work; the per-color
  toggle lives in the vat's detail sheet.
- Renovate lists which unlocks will close; after it, one batch re-buy
  ("Reopen the shelf, map and gallery for 3.1K") instead of six.
- Workshop split: ONE primary on the home screen. The flow-meter
  suggestion and Theme D's Next strip become a single "Next" button;
  Collect folds into the coin pill; Almost there moves to the bottom or the
  Ledger. Show only segments with content (Shipping appears with the
  Loading Yard). Remember the last segment; deep links scroll to the row
  and flash it. Scene objects are shortcuts into their section. Rows show
  before → after ("0.08 → 0.11 a second").
- Rewrite DESIGN's First ten minutes and the e2e for the new gates (table
  in the review §C): naming stays the high point, the third mixer is the
  new possibility, the shelf becomes session two's landmark, at most 5
  coach bubbles, no chain-merge target in minute ten.

**Theme B (6×6 match shelf)**
- Hit testing is board-local maths to the nearest cell (gaps and planks
  count), bounds extended 12 px. Today's `elementFromPoint` drops nothing
  on the planks and snaps back, which is the real drag bug.
- Draw the dragged container fully above the finger (base at y − 12 px,
  the color sits at the bottom of a vial) and resolve the drop where the
  container is, not the finger. Hysteresis: target changes only 25% into
  a neighbour. Magnet: within 24 px of a legal partner, snap; empties
  second. No positional lag on the drag.
- Pickup preview: exact-color partners ring; cells that would complete a
  family line get a faint guide in the family color.
- Family glyph on every cork and on the color chips (pairs match on exact
  color, lines on family; two look-alike rules need a non-color cue). A
  same-family different-color drop just moves, with a quiet name label.
- Default chips to five different families; two in one family allowed.
- **Line sequence trimmed to ~1.5 s** to respect DESIGN's 1.5 s cap and
  "skippable": lean-ins 6 × 60 ms with notes and no per-step haptic (the
  80 ms throttle would drop half), pop 280 ms + heavy haptic, glowing hold
  350 ms (500 ms for her first line ever), tip + coin arc + roll + "Sold"
  stamp 400 ms with a medium haptic, shimmer-clear 150 ms. A tap at any
  point jumps to the end with coins credited; from the hold on, cells
  outside the line accept a new drag. *Needs Matthew: you asked for a real
  pause; this keeps the pause but shortens the whole to the doc's cap.*
- **Diagonals stay in** (Matthew's direction) but are taught the first
  time a diagonal has five, not upfront. Rows and columns are taught at
  the first clear and first column-of-five.
- Lines found in the same check resolve together as one "double line":
  one sequence, two coin arcs that join, ×2 on the 1.5× bonus. Defined in
  the sim before the UI.
- Cascades: merge, 90 ms, then the line; a chain keeps its 90 ms steps and
  the line waits for the last pop.
- Judge the pause with local counters `stats.lines` / `stats.lineSkips`
  in the debug panel and by watching her play; if she skips more than half
  after her first ten, shorten the hold.
- Seeded onboarding row goes on the bottom row (nearest the thumb); the
  coach sits above the board, never over rows.
- Tests: a perturbation harness (200 drops at random offsets up to half a
  cell, including gap and plank midpoints, ≥ 99% land right), fit at
  375×667 as well as 390×844, frame probe during a double line.
- Header folds to one line above the chips; "The shelf is resting: make
  room for new vials" while paused; migration shows one paper line
  explaining the new rules.

**Theme C (purify)**
- Offline catch-up adds at most 3 batches (live play keeps 2–3 min, cap 10).
- Muddy batches never block "All caught up"; the Ledger line reads "3
  muddy batches to sort, if you like". Cut "Purify all later"; add "Sell
  all as is" with a one-line total confirm.
- Tier control lives on the Puzzle table's Purify card, same component
  and position as grading; each tier shows an expected length ("about
  1 / 2 / 3 / 5 min"); Relaxed by default for her first three batches;
  mid-batch tier change restarts the batch with nothing lost.
- The whole tube column is the tap target; gaps resolve to the nearest
  tube; check 11 tubes at 375 wide. Teach the cork just in time (first
  tube one layer from full).

**Theme D (subgame onboarding)**
- `guide()` hygiene, enforced in the mechanism: a step that can end on an
  action ends on it ("Got it" only on information steps); at most 2 steps
  before her first action; ≤ 15 words a step; the bubble never covers its
  anchor or the next target and never shares the screen with a toast or
  sheet; steps may wait for a trigger state; every subgame header gets a
  "How this works" replay link.
- The "what's next" card appears when she leaves a subgame or after her
  first success, never mid-play; two equal choices ("One more" / "Next:
  the catalog"); it never navigates by itself.
- Scripts fire from each unlock's ceremony, so introduction order follows
  unlock order; hop copy updated to the new gates. Where cheap, a character
  speaks the script (first hunter for the Map, a visitor for the Gallery, a
  customer for Commissions).
- No separate Next strip (folded into Theme A's single "Next" button).

**Theme E (gallery)**
- Scrap confirm says what goes ("12 painted panes will be cleared; the
  jars stay spent") as a second tap on the same button.
- Selling a signed piece: a sheet with the thumbnail and price; a "Sold to
  a collector" card with the thumbnail stays in the archive. "Take down"
  gets a 44 px target.

**Theme F (feel)**
- No 40 ms drag lag; tilt from velocity, capped at 6°; hit testing, ghost
  offset, hysteresis and magnet live in `fx.drag`, shared by shelf, board
  and packing.
- **Confirm the test phones first.** `haptics.js` uses `navigator.vibrate`,
  which iOS Safari lacks: on an iPhone every haptic in the spec is silent
  and the Playwright iPhone descriptor can't show it. Haptics are never
  the only carrier of meaning.
- Button press animation is cosmetic: the action fires on release at once.
  Repeated buys collapse to one squash per frame. Test `pointercancel`
  from the iOS edge swipe on the shelf and board. Run the frame probe on
  a double line and a merge-then-line cascade.

**New items (from review §D):** toast discipline (one at a time, never
carried across screens) and tab highlight by home tab are still open from
the audit and go in step 1; 375×667 joins the e2e screenshot set; before →
after values on every Level up row; local-only counters (wrong drop,
rejected drag, line skips, coach dismissed without acting) in the debug
panel; a "What changed in 0.2" paper note for existing saves. Later: hold-
to-repeat on Level up from level 10, separate effects/ambience volume,
undo the last shelf move.

**Decisions for step 0 (Matthew):** show prices from the start (yes, by
default); drop the Purify coin gate; keep all difficulty tiers free; keep
diagonals (yes, your call); line sequence 1.5 s with skip vs your 2.2 s;
which phone(s) the playtest uses.

## What the playtest said, and what's actually behind it

| # | Note | Root cause in the build |
| --- | --- | --- |
| 1 | Each subgame needs its own onboarding and should flow into the next | Onboarding only covers the first ten minutes on the workshop; the puzzle, shelf, map, gallery and commission screens open cold with no "how this works" or "what's next" |
| 2 | Unlocks should cost money, not just colors | Rooms cost coins + colors, but the shelf (5 colors), Gallery door (20 colors + room), hunters (10 colors) and puzzle tiers are color-count gates only |
| 3 | Things open too fast | Shelf at 5 colors, hunters at 10, Gallery at 20, with discovery handing out 2–3 colors per board. Phase 2 arrives on day 0.2 for Casual in the balance sim (the design doc wanted end of day 1) |
| 4 | Vial merging has too many colors, scrolls, is overwhelming | Shelf is 5×7 = 35 cells and taller than a phone screen; spillover picks a random *active* color every 10 minutes, so every assigned recipe seeds the shelf; no cap on distinct colors. Direction: 6×6, five colors, match-style lines of six |
| 5 | Vial sorting (purify) spawns too fast (one a second), can't be cleared; ends too early; needs difficulties | Muddy chance is rolled per batch while batch time shrinks as mixers level, so a leveled mixer spawns one every few seconds (bug). Pending cap 6. `isSolved` counts a tube as done when it is uniform even if not full; no tier picker for purify |
| 6 | Only one color available to mix and to paint with | **One mixer slot at start**; the second comes with the Mill Room (500 coins, 10 colors); the paint palette lists only colors with jars in stock; the shop sells stock down. So the easel shows the one color the single mixer makes |
| 7 | No way to discard or sell a painting | `gallery.discardPiece` exists in the sim for unsigned pieces; nothing in the UI calls it, and signed pieces have no sell/discard path at all |

## The shape of the fix

Three themes, in the order to build them. Each theme is a version bump
with its own balance-sim run and browser walk.

### Theme A — Pacing and gating (items 2, 3, 6)   → 0.2.0

**Design decision to confirm first:** every system is bought, with coins,
and colors only *reveal* the purchase. The paper tag on a locked thing
says "Open for 1.2K" once the color requirement is met, and "3 more colors
to see the price" before. Nothing opens by itself.

1. **Start with two mixers, not one.** Item 6 is unfixable otherwise. The
   first thing she buys after the tutorial is the third mixer (a cheap
   station purchase, ~60 coins), not a room. Mill Room then adds a grinder
   slot and the fourth mixer.
2. **Paint palette and mixer picker explain themselves.** The easel lists
   every discovered color; those with no stock are greyed with "Set a mixer
   to make this" and tap-through to the mixer picker. The mixer picker
   shows what each color is for ("paints the Harbor Window", "Harbor Town
   pays +40% for blues").
3. **A shop reserve she can see.** The shop currently sells everything
   above a tiny reserve, so stock for painting never accumulates. Add a
   per-color "keep N jars" toggle on the vat (default: keep 20 jars of any
   color that is pinned or used by a started painting).
4. **Coin-gated unlocks** (new `unlocks` block in state; they reset on
   Renovate like rooms, and the Heritage tree can auto-buy them in later
   runs):
   | Unlock | Reveal at | Cost | Was |
   | --- | --- | --- | --- |
   | Grading boards (free play) | tutorial | free | free |
   | Merge Shelf | 8 colors | 400 coins | 5 colors, free |
   | Purifying | first muddy batch (see Theme C) | 250 coins | automatic |
   | Hue Hunters (the map window) | 15 colors | 2,500 coins | 10 colors, free |
   | Gallery Wing | 25 colors | 8,000 (room, unchanged) | 20 colors |
   | Loading Yard / shipping / packing | 35 colors | 40,000 (room) | 30 colors |
   | Commissions | Phase 3 | 20,000 coins | phase only |
   | Steady / Tricky / Master tiers | 10 / 25 / 45 colors | 300 / 3,000 / 20,000 coins | free |
5. **Slower discovery.** Relaxed boards reveal 1 tint (not 1–2), Steady 1,
   Tricky 2, Master 2. Bench discovery radius stays ΔE 4. Happy accidents
   every 4 h in Phase 1 (was 3 h). Target: Phase 2 at the end of day 1 for
   Casual, matching the design doc's pacing table.
6. **Balance:** re-run `tools/balance/run.js`, keep the always-progress
   test green, re-tune starter costs so the first session still buys ~8
   upgrades. Update TUNING.md and the pacing table in DESIGN.md.
7. **Split the workshop page.** The home screen carries the scene, the
   flow meter, every station panel, rooms, apprentices, fleet and the
   Almost-there card on one scroll. Split it: the home screen keeps the
   scene, the flow meter, Collect and Almost there; a segmented control
   under the scene opens one section at a time: **Stations** (sources,
   grinders, mixers, vats, cellar, shop), **Shipping** (fleet, routes,
   yard), **Rooms & staff** (rooms, apprentices, Steward). The ledger's
   deep links pass `{panel}` as they do now and land on the right section.
8. **Tests:** unlock gating (`canBuyUnlock`, reveal vs cost), start state
   has 2 mixers, paint palette lists greyed colors, balance assertions.

### Theme B — Merge Shelf as a match game (item 4)   → 0.2.1

Matthew's direction (2026-10-04): 6×6, five colors, lines of six auto-merge.

1. **6×6 grid, fits one screen.** 36 cells sized to the viewport (no page
   scroll at 390×844 with the tab bar visible; cells ~52 px). No expansion
   purchases; the grid is the grid.
2. **Five colors, chosen by her.** A row of 5 color chips above the shelf
   sets which colors spillover delivers (default: the mixers' recipes, then
   the most-stocked colors). Spillover never delivers a sixth color. Changing
   a chip doesn't remove containers already on the shelf.
3. **Lines of six.** Whenever a full row, column or main diagonal (two of
   them) holds six containers of one **hue family** (any tiers, golden
   counts as any family), the line resolves: the six merge into the highest
   tier their combined vial-value allows (sum of TIER_VALUES → tier), that
   container sells immediately at value × 1.5 (a "full shelf" bonus), the
   six cells clear, the rising scale plays one note per cell, and a Cask
   formed this way still grants Essence to the family's most-stocked color.
   Resolution happens after every drop (merge or move), so a drop can
   trigger a merge and then a line. Rows, columns and diagonals are checked
   in that order; overlapping lines resolve one at a time.
   **The line sequence (Matthew, 2026-10-04):** it must have weight.
   (a) the six containers lift and lean toward the line's centre, one after
   another from the ends inward (60 ms apart, rising scale note each);
   (b) they squash together into one big container at the centre, which
   pops out one size bigger with a ring burst and a heavy haptic;
   (c) a pause of about 500 ms with the new container sitting there glowing
   (the player sees what she made);
   (d) the sell: the container tips, coins pour out in an arc to the coin
   pill with coin patter rising, the counter rolls up and slows, a stamp
   "Sold" lands on the empty row with a thunk;
   (e) the six cells clear with a short shimmer and the shelf settles.
   Total about 2.2 s, skippable by tap after (b). Reduced motion: fades,
   same sounds and haptics.
4. **Hue family, not exact color.** Line matching uses `hueFamily` so a
   row of madder, russet, rose and brick counts as red. Ordinary two-piece
   merges stay exact-color, per the design doc.
5. **Spillover pacing.** One vial per 10 minutes of production (unchanged),
   pauses when fewer than 6 cells are empty so a line can always be built.
6. **Row labels are gone.** The family-line rule replaces the "tidy shelf"
   +10% bonus; remove the label tags and their sheet.
7. **Onboarding on the shelf** (template for Theme D): first open shows
   two matching vials with a "drag one onto the other" mark, then a seeded
   row of five reds with one gap and a red vial to drop in, so her first
   session sees a line clear.
8. Tests: 36 cells, viewport fit (Playwright `scrollHeight <= clientHeight`),
   five-color cap, line detection on rows/columns/both diagonals, line
   value and clear, cascade (merge then line), pause threshold, migration
   of 35-cell saves (containers kept in reading order; extras become jars).

### Theme C — Purifying (item 5)   → 0.2.2

1. **Spawn rate: fix the bug, then tune.** The "one a second" she saw is
   a bug: muddy chance is rolled per *batch*, and batch size is fixed in
   jars while mixer output scales with level, so a high-level mixer at the
   50% cap turns out a muddy batch every few seconds. Roll muddiness per
   **minute of production** instead, with a hard ceiling: while mixers run,
   **one new muddy batch every 2–3 minutes** at most (random in that
   window), **backlog cap 10**. Offline catch-up adds at most the cap.
   Purify stays frequent because it is fun; it just can't flood.
2. **Solved = every tube capped.** `isSolved` requires each non-empty tube
   to be uniform **and full** (capacity 4), i.e. corked. The generator
   already produces states where that is reachable; add a solver check in
   the test for the stricter rule. A tube corks (sound + cork) the moment
   it is full and uniform; the puzzle ends when all are corked.
3. **Difficulty tiers for purify**, chosen on the batch card: Relaxed (4
   colors, 6 tubes, free extra tube), Steady (6 / 8), Tricky (8 / 10),
   Master (9 / 11, no extra tube). Reward: purity pure / pure / flawless /
   flawless, plus the puzzle-reward minutes 4 / 6 / 10 / 16. Remembered
   per `settings.puzzleTier.purify`.
4. **Clearing the backlog:** "Sell as is" stays, plus a "Purify all later"
   that parks batches without the ledger nagging. Batches never expire.
5. **Onboarding:** the first muddy batch opens a 4-color Relaxed board with
   a three-step coach (pick a tube, pour onto a match, cork).
6. Tests: spawn-rate ceiling over a simulated day, strict solved rule,
   tier sizes, extra tube only on Relaxed.

### Theme D — Subgame onboarding and flow (item 1)   → 0.2.3

A shared mechanism, then one script per subgame.

1. **Mechanism:** `state.onboarding.seen[subgameId]` plus a tiny
   `guide(screenId, steps)` helper in `onboarding.js`: a 2–4 step coach
   script that runs the first time a screen opens, each step anchored to a
   `data-coach` target already on the screen, dismissable, never repeated.
   Every script ends with a **"what's next" card** that names the next
   thing to try and navigates there.
2. **Scripts** (first open → next hop):
   - Orders / Matching → "Boards reveal new colors" → Puzzles
   - Grading → "Your fifth color opens the shelf" → Workshop shelf tag
   - Merge Shelf → "Casks give Essence; see the catalog" → Catalog
   - Catalog → "Pin a color to chase it" → Workshop
   - Purify (first batch) → "Pure stock pays more at the shop" → Workshop
   - Map / first hunter → "She's back in 30 min; the Ledger will tell you" → Ledger
   - Album (first card) → "8 cards finish the Meadow set" → Map
   - Gallery / Paint → "Hang it; visitors pay admission" → Gallery walls
   - Packing (first crate) → "Clean crates ship for +25%" → Workshop yard
   - Commissions → "Deliver by the step" → Orders
   - Heritage → "What stays, what resets" → Workshop
3. **A "Next" strip on the workshop** that always shows the one
   recommended next step (from the same list the Morning Ledger's
   "Almost there" uses), so the flow between games is visible outside
   onboarding.
4. Tests: each script runs once, survives reload, never blocks a tap; the
   browser walk extends past minute ten through each first-open script.

### Theme E — Gallery discard and sell (item 7)   → ships with 0.2.1

1. Unsigned piece: "Scrap this canvas" (two-step confirm) → `discardPiece`
   (exists); the canvas returns to the list.
2. Signed piece: "Sell this painting" → pays `pieceValue × 2` once (a
   collector buys the original), the piece leaves the archive, the canvas
   can be painted again. "Keep forever" stays the default. Also "Take
   down" (unhang) is already there; make it visible on the hung tile.
3. Tests: discard refunds nothing, sell pays once and removes the piece,
   hung count updates.

### Theme F — Mobile feel pass (new, 2026-10-04)   → 0.2.4

"Interactions should feel deeply satisfying. Things should have weight.
Lovely animations." The design doc's Interaction spec table is the
checklist; today most of it is approximated or missing. One worker per
screen group, on a real phone-sized viewport with touch events, and a
shared physics vocabulary so everything feels like one material.

1. **Shared motion vocabulary in fx.js** (one worker first):
   - `spring(el, {from, to, stiffness, damping})` built on the Web
     Animations API with a precomputed spring curve, so every move has
     mass; three presets: `soft` (paper), `firm` (wood), `heavy` (cask).
   - `lift(el)` / `settle(el)`: scale 1.06 + shadow grows on pointerdown,
     settles with a 3% overshoot on release.
   - `drag(el, {onMove, onDrop})`: pointer capture, 8 px threshold, the
     element follows the finger with a 40 ms lag and a slight tilt in the
     direction of travel, drops with a bounce; the target cell glows as
     the finger approaches (magnet radius 24 px).
   - `pour(svg, hex, from)`: the flood already exists; add a wobble on the
     surface as it fills and a glug pitched to the region size.
   - `coinArc(from, to, n)`: coins fan out then converge, with the counter
     rolling up and slowing; `stamp(el)`: a stamp lands with squash and a
     thunk; `shimmer`, `ringBurst` keep their current behaviour.
   - Every effect has a reduced-motion twin (fade) and respects the
     80 ms haptic throttle.
2. **Per-screen pass** against the Interaction spec rows:
   - Buttons everywhere: press down 2 px with the shadow collapsing, spring
     back; the paper tick; light haptic. Today it's a CSS transform only.
   - Collect: coins arc to the pill (exists) + the pill squashes on arrival.
   - Buy an upgrade: the station card squashes 94% → 104% → 100%, the
     wooden thunk, a chime on milestones; the level number rolls.
   - Grading tiles: lift on touch, slide with overshoot, the correct tile
     settles with a one-frame shimmer and its own note; the solve sweep.
   - Shelf: drag with tilt and magnet; merge lean-in and pop; the line
     sequence above; chain scale.
   - Purify: the stream arcs, the layer lands with a wobble, the cork pops
     with a medium haptic.
   - Packing: the jar drops with a bounce, the lid closes, the stamp lands.
   - Paint: the pour floods from the fingertip, the chip lifts when picked.
   - Postcard: the 3D flip with the stamp landing.
   - Ledger: the All caught up stamp with ink spread.
   - Close up shop: lights dim, shutters lower (a drawn shutter over the
     scene), vats glow, evening bell.
3. **Touch correctness** on a real device: `touch-action` set per
   draggable, no 300 ms tap delay, no scroll fighting on the shelf and the
   board, no double-fire from pointer + click, safe areas respected.
4. **Verification:** Playwright with touch emulation (`hasTouch`,
   `isMobile`, iPhone 14 descriptor) driving drags on the shelf and board;
   a frame-timing probe (no long tasks > 50 ms during a merge chain);
   screenshots mid-animation for the eye check. Then a thumb test by
   Matthew.

## Order of work and cost

| Step | Theme | Workers | Model |
| --- | --- | --- | --- |
| 1 | A: start state, unlocks block, coin gates, paint palette, shop reserve | 1 sim (Opus) + 1 UI (Sonnet) | |
| 2 | A: balance re-tune and tests | 1 (Opus, owns balance tooling) | |
| 3 | B + E: 6×6 match shelf + gallery sell/discard | 1 sim (Opus) + 1 UI (Sonnet) | |
| 4 | C: purify rate, strict solve, tiers | 1 puzzle+sim (Opus) + 1 UI (Sonnet) | |
| 5 | D: guide mechanism + 11 scripts + Next strip | 1 app core (Opus) + 2 UI (Sonnet) | |
| 6 | F: motion vocabulary in fx.js, then per-screen feel pass | 1 fx (Opus) then 3 UI (Sonnet) | |
| 7 | Integration walk past minute ten, screenshots, version bump, deploy | 1 (Opus) | |

Steps 1–2 must land before 3–5 (they change the start state and unlock
model everything else reads). 3, 4 and 5 can run in parallel after that.
Each step ends with `npm test` green, `npm run e2e` green, a version bump
and a push, so the phone can pick up each theme as it lands.

Rough size: about the same as the UX pass (five or six workers, one
integration pass). Budget one session for steps 1–2, one for 3–5 in
parallel plus step 6.

## Decisions (taken 2026-10-04, Matthew's answers or my defaults)

1. Two mixers at start. (default)
2. Coin gates reset on Renovate; Heritage tree gains nodes to keep them. (default)
3. Shelf: 6×6, five colors, line-of-six auto-merge, auto-sell at 1.5× with the full sequence. (Matthew)
4. Purify tiers are free; the reward difference is the incentive. (default)
5. Purify spawns at most one batch every 2–3 minutes while producing, backlog 10. (Matthew)

## Decisions as originally posed

1. **Two mixers at start** (my recommendation) versus one mixer plus a
   cheap second-mixer purchase in the first two minutes of onboarding.
2. **Coin gates survive Renovate?** My recommendation: no, they reset like
   rooms, and the Heritage tree gains "Keep the shelf / map / gallery open"
   nodes so later runs skip the re-buy.
3. **Line bonus on the shelf:** sell at 1.5× (my pick) or keep the merged
   container on the shelf for her to sell by hand.
4. **Purify tiers paid in coins or Seals** for the unlock, or free tiers
   with the reward difference as the incentive (the grading tiers are free
   today).

## Save migration

All four themes change state. One bump to `SAVE_VERSION = 2` with a
`migrate` step: add `unlocks` (granted for anything already in use so
nobody loses access), add a second mixer to saves that have one, convert
35-cell shelves to 36 cells (containers kept in reading order), add
`settings.puzzleTier.purify`, add `onboarding.seen`. Test: a 0.1.3 save
loads and plays.
