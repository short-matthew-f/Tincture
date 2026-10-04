# Plan: v0.2 — pacing, gating and the three puzzle fixes

Written 2026-10-04 from playtest notes (Matthew and his wife, builds 0.1.0–0.1.3).
No code has changed yet. This is the work order for the next session.

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

## Order of work and cost

| Step | Theme | Workers | Model |
| --- | --- | --- | --- |
| 1 | A: start state, unlocks block, coin gates, paint palette, shop reserve | 1 sim (Opus) + 1 UI (Sonnet) | |
| 2 | A: balance re-tune and tests | 1 (Opus, owns balance tooling) | |
| 3 | B + E: 6×6 match shelf + gallery sell/discard | 1 sim (Opus) + 1 UI (Sonnet) | |
| 4 | C: purify rate, strict solve, tiers | 1 puzzle+sim (Opus) + 1 UI (Sonnet) | |
| 5 | D: guide mechanism + 11 scripts + Next strip | 1 app core (Opus) + 2 UI (Sonnet) | |
| 6 | Integration walk past minute ten, screenshots, version bump, deploy | 1 (Opus) | |

Steps 1–2 must land before 3–5 (they change the start state and unlock
model everything else reads). 3, 4 and 5 can run in parallel after that.
Each step ends with `npm test` green, `npm run e2e` green, a version bump
and a push, so the phone can pick up each theme as it lands.

Rough size: about the same as the UX pass (five or six workers, one
integration pass). Budget one session for steps 1–2, one for 3–5 in
parallel plus step 6.

## Decisions I need from you before starting

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
