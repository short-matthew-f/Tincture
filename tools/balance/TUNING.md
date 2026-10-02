# Era 1 balance tuning (real engine)

`tools/balance/sim-player.js` replaces the spreadsheet model in docs/DESIGN.md
"Balance model and testing" with scripted players that drive the actual sim
(`src/sim`). `node tools/balance/run.js --seeds 30` prints the doc's tables;
`test/balance.test.js` runs 5 seeds per profile and asserts the "Automated
balance tests" list.

Fixed by the design doc and left untouched: cost growth 1.15 (vats 1.10),
milestone doublings at 10/25/50/100/150/200, puzzle reward
max(k·r·60, 0.25·m·c_min) with k 8/12/20/32, Heritage floor(sqrt(E/1e7)),
admission 2×10⁻⁵ of piece value per second, Essence +5% per star, Phase gates
(10 colors + Mill Room, 30 colors + Loading Yard), base costs of every station
and room.

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
Gallery is open, renovates when `shouldSuggest` and the gain is at least 10,
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

Unchanged on purpose: `STORE_TARGET_MS` (the player keeps 8 hours regardless;
the flow meter's phase targets only steer the suggestion), puzzle reward
constants, muddy chance, spillover numbers and the admission rate.

## Pacing

Median day (since install) over 30 seeds, 21 days. "—" means most runs never
got there. The doc's targets are in brackets.

| Profile | Phase 2 | Phase 3 | First Renovate | 50 colors | Colors by day 21 |
| --- | --- | --- | --- | --- | --- |
| Engaged | 0.1 [0.4] | 0.5 [1.4] | 4.0 [3.5] | 1.3 [2.8] | 104 [100] |
| Engaged, no puzzles | 1.4 [1.5] | 4.8 [16.8] | 8.6 [16.8] | 9.3 [—] | 69 [35] |
| Casual | 0.2 [0.9] | 1.5 [3.9] | 6.2 [5.7; test 5–8] | 3.3 [7.6] | 92.5 [94] |
| Casual, no puzzles | 1.5 [2.1; test ≤ 3] | 4.2 [11.3] | 9.2 [11.3] | 7.4 [18.9] | 68.5 [54] |
| Forgetful | 1.0 [2.3] | 3.0 [10.3] | 9.5 [11.6] | 6.0 [15.8] | 83 [69] |
| Forgetful, no puzzles | 3.5 [2.3] | 7.0 [10.8] | 12.5 [12.1] | 10.8 [16.3] | 68.5 [68] |

Colors include the running weekly event's page (it counts toward the catalog
and the phase gates), which is how Engaged passes 100.

### Full tables (`node tools/balance/run.js --seeds 30`)

Tincture Era 1 balance simulation (real engine), 21 days, 30 seeds per profile. Medians; "—" means most runs never got there.

#### Milestone results

| Profile | Phase 2 | Phase 3 | Renovate (10 Heritage) | 50 colors | Colors by day 21 |
| --- | --- | --- | --- | --- | --- |
| Engaged | 0.1 | 0.5 | 4.0 | 1.3 | 104 |
| Engaged, no puzzles | 1.4 | 4.8 | 8.6 | 9.3 | 69 |
| Casual (target player) | 0.2 | 1.5 | 6.2 | 3.3 | 92.5 |
| Casual, no puzzles | 1.5 | 4.2 | 9.2 | 7.4 | 68.5 |
| Forgetful | 1.0 | 3.0 | 9.5 | 6.0 | 83 |
| Forgetful, no puzzles | 3.5 | 7.0 | 12.5 | 10.8 | 68.5 |

#### Difficulty tiers (Casual schedule)

| Tier | First Renovate (day) | Active minutes over 21 days | Active Coins per minute (vs Relaxed) |
| --- | --- | --- | --- |
| Relaxed | 7.0 | 168 | 1.00× |
| Steady | 6.2 | 252 | 1.25× |
| Tricky | 6.0 | 420 | 1.36× |
| Master | 5.2 | 672 | 1.54× |

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
| Engaged | 0.3 | 0.2% / 0.1% | 0.0% | 3.0 / 6.2 / 9.2 | 61.5 | 2.5 min |
| Casual | 1.0 | 0.3% / 0.2% | 0.1% | 3.3 / 5.8 / 8.7 | 40 | 1.5 min |
| Forgetful | 2.0 | 0.2% / 0.3% | 0.0% | 2.5 / 3.0 / 4.4 | 19 | 1 min |

#### Economy

| Profile | Puzzle share of Coins | Income/s day 7 | Income/s day 14 | Income/s day 21 | Offline window after day 1 (median of min) | Worst | Renovates in 21 days |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Engaged | 38.5% | 8.9K | 31.3K | 84.5K | 8.0 h | 7.5 h | 6 |
| Engaged, no puzzles | 0.0% | 4.8K | 4.6K | 26.6K | 7.6 h | 7.1 h | 4 |
| Casual | 12.8% | 6.6 | 9.4K | 38.3K | 7.9 h | 7.3 h | 4 |
| Casual, no puzzles | 0.0% | 4.9K | 8.6K | 21.7K | 7.9 h | 7.3 h | 3 |
| Forgetful | 1.5% | 4.9K | 8.0K | 11.3K | 7.8 h | 7.1 h | 3 |
| Forgetful, no puzzles | 0.0% | 944.1 | 216.4 | 8.2K | 8.0 h | 7.6 h | 2 |

## Open

- **Gallery admission is ~0.3% of income, not 10–20%.** Paint costs a fixed
  number of jars (region size × 3, `sim/gallery.js JARS_PER_SIZE`), so a piece
  is worth about the same on day 2 and day 20 while income grows by orders of
  magnitude. With the admission rate fixed at 2×10⁻⁵/s the target needs paint
  that scales with production (for example jars per size = minutes of the
  color's output), which is outside this tuning pass. The test asserts only
  0 < share ≤ 20% with a `TODO(balance)`.
- **Master's per-minute edge sits near the cap.** It reads 1.54× over 30 seeds
  and 1.36× on the test's seeds 1–5 (doc model: 1.57×), but per seed it ranges
  1.1× to 2.3× because the 21-day window lands at
  different points of each run's Renovate cycle (Master fits five Renovates,
  Relaxed four). A run where Master reveals only one tint per board was just as
  far ahead, so the edge comes from the 32 production-minutes per puzzle
  compounding through Renovate, not from discovery. The doc's suggested lever
  (Master k 32 → 28) was not touched because k is fixed for this pass.
- **Phase 3 comes early** (Casual day ~1.3 vs 3.9): grading tints plus Great
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
