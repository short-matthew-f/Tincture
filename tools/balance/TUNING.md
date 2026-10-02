# Era 1 balance tuning (real engine)

`tools/balance/sim-player.js` replaces the spreadsheet model in docs/DESIGN.md
"Balance model and testing" with scripted players that drive the actual sim
(`src/sim`). `node tools/balance/run.js --seeds 30` prints the doc's tables;
`test/balance.test.js` runs 5 seeds per profile and asserts the "Automated
balance tests" list.

Fixed by the design doc and left untouched: cost growth 1.15 (vats 1.10),
milestone doublings at 10/25/50/100/150/200, puzzle reward
max(k·r·60, 0.25·m·c_min) with k 8/12/20/32, Heritage floor(sqrt(E/1e7)),
admission 2×10⁻⁵ of piece value per second (the piece value formula too; only
the paint price was changed, change 6), Essence +5% per star, Phase gates
(10 colors + Mill Room, 30 colors + Loading Yard), base costs of every station
and room (except the three starter sources, change 7).

## The player

| Profile | Check-ins (hour of day) | Puzzles per check-in | Tier |
| --- | --- | --- | --- |
| Forgetful | 8, 20 | 1 in the morning | Relaxed (1 min each) |
| Casual (target player) | 8, 12, 16, 20 | 2 | Steady (1.5 min) |
| Engaged | 7, 10, 13, 16, 19, 22 | 4 | Tricky (2.5 min) |

Each also runs with no puzzles (no grading, no orders, muddy batches sold
instead of purified). Every check-in: the world ticks to that time (`sim.tick`,
the step `catchUp` runs; the Morning Ledger is skipped because nobody reads it),
she collects, claims happy accidents, purifies muddy batches, reassigns mixers
(most valuable mixable colors, one per mixer), tends the shelf, fills two match
orders at Great, buys, plays her puzzles (each pays `puzzleReward`, reveals
`revealedTints` from a real `createBoard` of her palette, and is followed by an
affordability check and a buying round), paints at every other check-in once the
Gallery is open (her canvases in turn, every region in one of her most valuable
colors round-robin, at `gallery.regionCost`; she skips the piece if any color
runs short), renovates when `shouldSuggest` and the gain is at least 10,
sends idle hunters on the longest trip that is back by her next check-in
(overnight at the last one), and buys again.

Buying is greedy in this order: (1) keep the offline window (capacity ÷
production, the flow meter's `windowMs`) at 8 hours with the cheapest vat or
cellar level; (2) save for the next room once its color gate is met, then for
the Dispatcher once the fleet exists; (3) hire a hunter she can afford; (4) the
flow meter's suggestion (plus a Millstone/Roller Mill swap when grinders are the
limit).

Choices the doc does not spell out, made here:

- **Merge Shelf.** Merge greedily (lowest tier first, golden vials join any
  partner); keep merging toward Casks while the color has Essence to gain; sell
  Bottles and up of colors at full Essence, and sell more (smallest first) only
  to keep a third of the shelf free. Selling every Bottle each check-in, as the
  old model did, would never form a Cask, so Essence (a doc table column) would
  stay at zero.
- **Heritage tree.** Before each Renovate she spends carried Heritage on Deep
  Pockets, Spare Vats, Quick Hands and Second Table (cheapest useful first).
- **Apprentices.** Errand Runner at once (free); the Dispatcher is saved for as
  soon as the Loading Yard adds a fleet (without it the fleet never ships while
  she is away). Vehicles get one route each (best premium for what she makes;
  the last one runs Weavers' Row).
- **Time inside a session.** Her puzzle minutes advance the clock, and the world
  ticks once at the end of the session, so the affordability check ignores the
  few minutes of idle income during the session (a conservative gap).
- **Always-progress gap.** After every puzzle: is `cheapestUpgrade.cost ≤
  coins`? The gap is (consecutive puzzles with nothing affordable + 1) × puzzle
  minutes; a streak still open when the session ends counts one more puzzle.

## Tuning changes the simulation forced

| # | Problem found | Change made | Result |
| --- | --- | --- | --- |
| 1 | Vats held 50 jars per level against 0.5 jars/s per mixer level, so keeping 8 hours of storage took ~290 vat levels per mixer level. The greedy buyer sank everything into vats (vats level 118 while mixers sat at 25) and Casual reached Renovate on day 13 | Vat capacity per level 50 → 500 jars; cellar 200 + 100/level → 2,000 + 1,000/level (×10) | The 8-hour window held for every profile; production was free to grow and Casual's first Renovate jumped to day 2.0 |
| 2 | Raising costs barely slows this economy: ×30 on every station base cost moved Casual's first Renovate only from day 2.0 to 2.5 (levels grow with the log of Coins) | Reverted; every base cost is back at the doc's value | — |
| 3 | Income too fast: Casual renovated on day 2 to 3, Engaged on day 1.5 (targets 5.7 and 3.5) | Every production and sales output ÷ 12.5: starter sources 1.0 → 0.08 raw/s per level (hunter sources likewise, e.g. Saffron 1.6 → 0.128), grinder 2 → 0.16 (Mortar / Millstone / Roller Mill 2 / 12 / 60 → 0.16 / 0.96 / 4.8), mixer and shop 0.5 → 0.04 jars/s; vats 500 → 400, cellar 1,600 + 800/level so storage keeps the same share. `MIXER.batchSeconds` 10 → 125 and `SHOP.baseSellRate` 0.5 → 0.04 follow so the constants agree | Casual first Renovate day 6.0, Engaged 4.0, Forgetful 10.0 |
| 4 | The shop kept half the display capacity as reserve before selling anything. With 8-hour vats that is about 4 hours of production: a new player's first sale came after 4+ hours and ~4 hours of stock stayed locked forever | `SHOP_RESERVE_SHARE` 0.5 → 0.02 (about 10 minutes of production at the 8-hour window; still enough working stock for paint and orders) | First sale about 10 minutes in |
| 5 | Players who skip puzzles still found colors far faster than the doc (Casual, no puzzles: 50 colors on day 5.0, 68 by day 21; doc 18.9 and 54), because Phase 2+ happy accidents fired every 2 hours of production | `ACCIDENT_MS.later` 2 h → 6 h (Phase 1 stays at 3 h, doc change #3) | Casual, no puzzles: 50 colors on day 7.0, 70 by day 21; tier ratios settled (Master 1.36× on seeds 1–5) |
| 6 | Gallery admission was ~0.3% of income (target 10–20%): paint cost a fixed size × 3 jars a region, so a piece was worth the same on day 2 and day 20 while income grew by orders of magnitude | Paint scales with production (`sim/gallery.js`): a canvas costs `PAINT_SECONDS` of her current mixer output (`rates().jars`, floored at `MIN_PAINT_RATE` 0.05 jars/s), split across regions by size, rate locked when the piece starts, jars stored per region. The doc's 20 minutes (1,200 s) gave 48% because the engine opens up to 24 walls by day 14 (the doc's model hung about 4) and the greedy painter's tints make a piece worth ~2.2× its paint (rarity 2 × variety ~1.1), not 1.3×. `PAINT_SECONDS` 1,200 → 150 (2.5 minutes of production); `VALUE_MULT` left at 1 (value formula unchanged) | Casual admission share at day 14: 0.3% → 15.2% (30 seeds; 14.8% on 10, 13.1% on the test's seeds 1–5). 240 s gave 19.8%, 300 s 23.3%. A tint piece repays its paint in ~6 h, a primary-only piece in ~13–14 h (doc: about 11 h) |
| 7 | Early pace (DESIGN.md "First ten minutes": about 10 upgrades, an upgrade right after the first puzzles). After the first order and the first board she held about 7 Coins against a cheapest upgrade of 12 (11.5), and the shop sells nothing for ~10 minutes (the change-4 reserve), so the walk needed 5 minutes of `debug.advance` for 2 upgrades | (a) a new workshop starts with `STARTING_COINS = 25` ("a few coins left in the drawer", `src/state.js`; Renovate still starts at Deep Pockets); (b) the tour's first order (`order.tutorial`) and first grading board (`onboarding.flags.firstBoardPaid`) each pay a tutorial reward of 1× the cheapest upgrade on top (`economy.tutorialReward`); (c) starter sources' base cost 10 → 6. Shop and vat base costs stay at 40 / 60: cutting them in proportion (24 / 36) put Master at 1.60× Relaxed on the test seeds (cap 1.6; 1.32× without it), while sources alone leave every table unchanged | Measured by `test/first-ten-minutes.e2e.mjs`, which now buys the flow meter's suggestion when affordable, else the cheapest Level up: after the first order (+9.5) and board (+8.6) she holds 43.1 Coins with the cheapest upgrade at 6.9, buys 5 upgrades at once, and 3 more after a second order (~25 Coins): **8 upgrades in 5.5 minutes of session clock with 5.1 minutes of `debug.advance`** (was 2 upgrades after 5+ minutes advanced). With (a)+(b) alone: 55 Coins against 11.5, 4 upgrades. 30-seed tables below: within noise of change 6 (Casual Renovate 6.2, Master 1.45×) |

Unchanged on purpose: `STORE_TARGET_MS` (the player keeps 8 hours regardless;
the flow meter's phase targets only steer the suggestion), puzzle reward
constants, muddy chance, spillover numbers and the admission rate.

## Pacing

Median day (since install) over 30 seeds, 21 days. "—" means most runs never
got there. The doc's targets are in brackets.

| Profile | Phase 2 | Phase 3 | First Renovate | 50 colors | Colors by day 21 |
| --- | --- | --- | --- | --- | --- |
| Engaged | 0.0 [0.4] | 0.5 [1.4] | 4.0 [3.5] | 1.3 [2.8] | 104 [100] |
| Engaged, no puzzles | 1.4 [1.5] | 5.0 [16.8] | 8.5 [16.8] | 10.1 [—] | 59 [35] |
| Casual | 0.3 [0.9] | 1.8 [3.9] | 6.2 [5.7; test 5–8] | 3.3 [7.6] | 91.5 [94] |
| Casual, no puzzles | 1.5 [2.1; test ≤ 3] | 4.2 [11.3] | 9.0 [11.3] | 7.2 [18.9] | 70 [54] |
| Forgetful | 1.0 [2.3] | 3.5 [10.3] | 9.3 [11.6] | 6.0 [15.8] | 82 [69] |
| Forgetful, no puzzles | 3.5 [2.3] | 7.0 [10.8] | 12.5 [12.1] | 10.8 [16.3] | 66 [68] |

Rerun after change 7 (early pace; change 6 moved these last). Admission
compounds into income, so Engaged and Casual fit one more Renovate in 21 days
than before change 6.

Colors include the running weekly event's page (it counts toward the catalog
and the phase gates), which is how Engaged passes 100.

### Full tables (`node tools/balance/run.js --seeds 30`)

Tincture Era 1 balance simulation (real engine), 21 days, 30 seeds per profile. Medians; "—" means most runs never got there.

#### Milestone results

| Profile | Phase 2 | Phase 3 | Renovate (10 Heritage) | 50 colors | Colors by day 21 |
| --- | --- | --- | --- | --- | --- |
| Engaged | 0.0 | 0.5 | 4.0 | 1.3 | 104 |
| Engaged, no puzzles | 1.4 | 5.0 | 8.5 | 10.1 | 59 |
| Casual (target player) | 0.3 | 1.8 | 6.2 | 3.3 | 91.5 |
| Casual, no puzzles | 1.5 | 4.2 | 9.0 | 7.2 | 70 |
| Forgetful | 1.0 | 3.5 | 9.3 | 6.0 | 82 |
| Forgetful, no puzzles | 3.5 | 7.0 | 12.5 | 10.8 | 66 |

#### Difficulty tiers (Casual schedule)

| Tier | First Renovate (day) | Active minutes over 21 days | Active Coins per minute (vs Relaxed) |
| --- | --- | --- | --- |
| Relaxed | 6.5 | 168 | 1.00× |
| Steady | 6.2 | 252 | 1.12× |
| Tricky | 5.5 | 420 | 1.33× |
| Master | 5.1 | 672 | 1.45× |

#### Always-progress check

| Profile | Worst gap | One puzzle takes | Target |
| --- | --- | --- | --- |
| Engaged | 2.5 min | 2.5 min (Tricky) | ≤ 5 min: pass |
| Casual | 1.5 min | 1.5 min (Steady) | ≤ 5 min: pass |
| Forgetful | 1 min | 1 min (Relaxed) | ≤ 5 min: pass |
| Casual at relaxed | 1 min | 1 min | ≤ 5 min: pass |
| Casual at tricky | 2.5 min | 2.5 min | ≤ 5 min: pass |
| Casual at master | 4 min | 4 min | ≤ 5 min: pass |

#### Gallery and Merge Shelf

| Profile | Gallery opens (day) | Admission share, day 14 / day 21 | Shelf share, day 14 | Avg Essence stars, day 7 / 14 / 21 | Pieces painted by day 21 | Worst progress gap |
| --- | --- | --- | --- | --- | --- | --- |
| Engaged | 0.3 | 12.7% / 11.2% | 0.0% | 2.4 / 5.7 / 9.3 | 62 | 2.5 min |
| Casual | 1.0 | 15.3% / 14.8% | 0.0% | 2.8 / 5.3 / 7.9 | 37 | 1.5 min |
| Forgetful | 2.3 | 10.9% / 15.5% | 0.0% | 2.8 / 3.0 / 4.3 | 17 | 1 min |

#### Economy

| Profile | Puzzle share of Coins | Income/s day 7 | Income/s day 14 | Income/s day 21 | Offline window after day 1 (median of min) | Worst | Renovates in 21 days |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Engaged | 34.0% | 11.4K | 48.4K | 110.5K | 8.0 h | 7.6 h | 6.5 |
| Engaged, no puzzles | 0.0% | 4.9K | 14.6K | 41.4K | 7.7 h | 7.2 h | 5 |
| Casual | 10.7% | 3.3K | 21.8K | 59.8K | 7.9 h | 7.3 h | 5 |
| Casual, no puzzles | 0.0% | 5.1K | 10.2K | 35.9K | 7.9 h | 7.2 h | 4 |
| Forgetful | 1.3% | 5.1K | 9.0K | 19.4K | 7.9 h | 7.2 h | 3 |
| Forgetful, no puzzles | 0.0% | 948.8 | 4.8K | 13.2K | 8.0 h | 7.3 h | 2 |

## Open

- **About 10 upgrades in the first ten minutes** (DESIGN.md) is reached only
  with a second order (8 in the e2e walk). The shop sells nothing for its
  first ~10 minutes (change 4 keeps 24 jars, 10 minutes of one mixer, in
  reserve), so idle income does not help the first session. Lowering the
  reserve for Phase 1, or a cheaper second mixer, are the levers if playtests
  want more. Puzzles are not the bottleneck: once her first mixer runs,
  r_idle counts the shop's sell rate (0.12 Coins/s), so a Relaxed board pays
  8 × 60 × 0.12 ≈ 58 Coins and an order 2–4 minutes of it (the walk's second
  order paid ~25), each several upgrades at 7–12 Coins. Only puzzles played
  before a mixer has a recipe fall back to the 0.25 × c_min floor, which is why
  the tour's first order and board carry the tutorial reward.

- **Gallery paint is 2.5 minutes of production, not the doc's 20.** The doc's
  model hung about 4 pieces worth 1.3× their paint; the engine opens up to 24
  walls by day 14 (walls come back to 4 after each Renovate) and the greedy
  painter's pieces are worth ~2.2× their paint, so 20 minutes would put
  admission near 50% of income. Updating docs/DESIGN.md "Gallery and Merge
  Shelf in the simulation" to 2.5 minutes (or lowering `VALUE_MULT` and raising
  `PAINT_SECONDS` together, which keeps the share but stretches the repay time
  past 11 hours) is a doc decision. Day-14 share per seed (10 seeds) ranges
  11% to 21%: it swings with where the day falls in the Renovate cycle.
- **Master's per-minute edge sits near the cap.** It reads 1.45× over 30 seeds
  (1.47× after change 6, 1.54× before it; doc model: 1.57×), but per seed it ranges
  1.1× to 2.3× because the 21-day window lands at
  different points of each run's Renovate cycle (Master fits five Renovates,
  Relaxed four). A run where Master reveals only one tint per board was just as
  far ahead, so the edge comes from the 32 production-minutes per puzzle
  compounding through Renovate, not from discovery. The doc's suggested lever
  (Master k 32 → 28) was not touched because k is fixed for this pass.
- **Phase 3 comes early** (Casual day ~1.8 vs 3.9): grading tints plus Great
  orders reach 30 colors fast and the Loading Yard (40,000) is cheap by then.
  Nothing tests it; the levers are the Loading Yard cost or the tint rate.
- **Not modeled:** commissions (their 11 signature colors are never found, so
  the catalog tops out near 89 plus event colors), quests and Seals, boosts,
  collectors, vehicle upgrades to Wagon/Barge (fleet slots fill with handcarts
  and the Dispatcher keeps them busy, so they are never idle to replace), packing
  bonus, the Order Clerk, Packer and Steward.
- **Speed.** A 21-day run takes 0.3 s (Forgetful) to 1.4 s (Engaged). Most of it
  is the engine: with the Dispatcher, `tickFactory` sub-steps up to 48 times per
  catch-up and each step re-runs `autoDispatch` → `bestPicks`, which recomputes
  hue family and route demand for every stocked color per vehicle; the rest is
  one `flowMeter` read per purchase (thousands per run, more with each
  Renovate rebuild). The test spreads its 45 runs over worker threads
  (`tools/balance/parallel.js`): about 10 s on 4 cores.
