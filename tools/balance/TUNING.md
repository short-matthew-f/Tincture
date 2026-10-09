# Era 1 balance tuning (real engine)

`tools/balance/sim-player.js` replaces the spreadsheet model in docs/DESIGN.md
"Balance model and testing" with scripted players that drive the actual sim
(`src/sim`). `node tools/balance/run.js --seeds 30` prints the doc's tables;
`node tools/balance/run.js --minutes 10` plays the first two check-ins minute
by minute (purchases, Coins, colors, when the Merge Shelf is reachable);
`test/balance.test.js` runs 5 seeds per profile and asserts the "Automated
balance tests" list, plus the v0.2 pacing (Phase 2 and 3 days) and the first
session (30 seeds of the minute-by-minute mode).

Fixed by the design doc and left untouched: cost growth 1.15 (vats 1.10),
milestone doublings at 10/25/50/100/150/200, puzzle reward
max(k·r·60, 0.25·m·c_min) with k 8/12/20/32, Heritage floor(sqrt(E/1e7)),
admission 2×10⁻⁵ of piece value per second (the piece value formula too; only
the paint price was changed, change 6), Essence +5% per star, the Phase gates'
own color counts in `factory.PHASE_GATES` (10 colors + Mill Room, 30 colors +
Loading Yard; since change 8 the rooms' gates, 15 and 50 colors, bind first),
base costs of every station and room (except the three starter sources, change
7, and the Mill Room, change 8).

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
cellar level; (2) save for the next room or coin-bought unlock once its color
gate is met (or the half-price re-buy after Renovate), then for the Dispatcher
once the fleet exists; (3) hire a hunter she can afford; (4) the workshop's
single Next button (`sim.next`), followed faithfully since change 9: the cheaper
of a room or another mixer (`factory.buyMixer`), the flow meter's suggestion
(plus a Millstone/Roller Mill swap when grinders are the limit), and in Phase 1
the cheapest Level up while the bottleneck is far.

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
| 8 | v0.2 pacing (docs/PLAN-v0.2.md Theme A.5; DESIGN.md "Target pacing": Phase 2 at the end of day 1, Phase 3 around day 3 to 4). With the v0.2 gates in place Casual reached Phase 2 on day 0.33 (her third check-in) and Phase 3 on day 2.0: grading tints, Great orders and happy accidents find 4 to 7 colors a check-in, so the 10-color Mill Room and the 35-color Loading Yard came early, and Coins never bind (she holds millions by day 1.5, so no sane room price slows her) | Mill Room 500 Coins / 10 colors → **1,500 / 15** (`content/rooms.js`; the first room now costs more than the 400-Coin shelf); Loading Yard reveal 35 → **50 colors** (`content/rooms.js` and the `shipping` unlock in `sim/unlocks.js`, which must agree), cost unchanged at 40,000. 13 colors gave Phase 2 at 0.33 still, 45 colors Phase 3 at 2.75 | Casual Phase 2 **0.5** (her 20:00 check-in on day 1), Phase 3 **3.1**, first Renovate 7.2 (30 seeds). Casual without puzzles: Phase 2 on day 2.1 (test ≤ 3; worst of the test seeds 2.33). Long Hall (40) and Atelier (45) need Phase 3, so they now open with the Yard at 50 |
| 9 | Next's "cheapest affordable upgrade" fallback (rule 6). The scripted player skipped it (it saved for the bottleneck instead) because taking it spread Coins over stations that were not the limit. Played minute by minute (change 10), the fallback also ate every Coin in the first session on the 6.9-Coin starter sources, so the 60-Coin third mixer was never bought on half the seeds | `sim/next.js` `CHEAPEST_FALLBACK = {maxPhase: 1, savingRatio: 2}`: rule 6 applies only in Phase 1, and only while the flow meter's pick costs more than 2× her Coins; past halfway Next shows Almost there / Collect until the pick (or the mixer, rule 4) is affordable; from Phase 2 it always saves. The player now follows `next()` faithfully (her skip is gone) | First session: the third mixer on every seed (at 1.5 minutes, right after the tutorial board), median 8 purchases. Over 21 days, Phase 1 alone with the fallback vs. the fallback in every phase is within seed noise for Casual (10 seeds: income day 7 2.9K vs 2.9K, Renovate 7.0 vs 7.0), because her saving goals (step 2) already come first; the phase limit keeps Next from offering stations that are not the limit once she is past the tutorial |
| 10 | The third mixer (docs/PLAN-v0.2.md Theme A.1): the first-session "new possibility" | `factory.buyMixer(state, now)`: a mixer without a room, `content/stations.js` `MIXER_PURCHASE = {baseCost: 60, costGrowth: 6}` (60, 360, 2,160, 12,960) until `MAX_SLOTS.mixers` (6). Bought mixers are counted in `stations.mixersBought` (reset with the stations on Renovate) and `syncSlots` adds the rooms' mixer slots on top, so the Mill Room still adds one (3 → 4). `next()` ranks it with rooms (the cheaper first, after unlocks) | `run.js --minutes 10`, 30 seeds: session one buys a median **8** things (4 to 18; the spread is which colors her mixers make: a tint sells at 15× a primary), always including the third mixer; 5 or 6 colors at the end; the Merge Shelf (8 colors + 400) is reachable in **session two** on every seed and never in session one. In the 21-day runs Coins are plentiful by her second check-in, so she typically buys mixers 4 and 5 there and reaches the 6-mixer cap by her third (seed 1: 5 mixers at 12:00, 6 at 16:00, before the Mill Room; see Open) |
| 11 | Gallery admission share "by day 14" read 23.6% on the test's seeds after the v0.2 gates (bound loosened to 25%, `TODO(balance-step2)`): one calendar day can sit in a Renovate dip (the Gallery closes on Renovate until the batch re-buy), which swings that day's share by up to ±6 points per seed | Measured as each run's median over days 13–15 (`report.admissionByDay14`), then the median over seeds; bound back to 10–20%. No gallery constant changed | Casual 17.3% over days 13–15 (day 14 alone 17.5%; 30 seeds); the test's seeds 1–5 read 17.2%. Engaged 11.5%, Forgetful 10.4% |
| 12 | v0.2.2 shelf (playtest: "filling too slowly"): one vial per 10 minutes left the board empty between visits | `SPILLOVER_MS` 10 → 3 min, `SPILLOVER_SECONDS` 15 → 5, so a vial is worth a third and shelf Coins per hour stay the same; the pre-purchase pile keeps 10 minutes (`WAITING_MS`) | Balance suite unchanged by the rate itself |
| 13 | "No tier earns more than 1.6× Relaxed" read the median of 5 per-seed rates, which swung by about ±0.15 on unrelated changes (bonus vials re-colored to shelf chips: tricky 1.51 → 1.66) | The test pools Coins and active minutes over the seeds | 5 seeds pooled: tricky 1.58, master 1.55; 15 seeds: 1.39 and 1.35 pooled (1.29 and 1.33 median) |

Unchanged on purpose: `STORE_TARGET_MS` (the player keeps 8 hours regardless;
the flow meter's phase targets only steer the suggestion), puzzle reward
constants, muddy chance, spillover numbers and the admission rate.

## Pacing

Median day (since install) over 30 seeds, 21 days. "—" means most runs never
got there. The doc's targets are in brackets (DESIGN.md "Target pacing" for
Casual; the old Python model's medians for the rest).

| Profile | Phase 2 | Phase 3 | First Renovate | 50 colors | Colors by day 21 |
| --- | --- | --- | --- | --- | --- |
| Engaged | 0.1 [0.4] | 1.3 [1.4] | 4.1 [3.5] | 1.3 [2.8] | 106 [100] |
| Engaged, no puzzles | 2.1 [1.5] | 8.1 [16.8] | 9.5 [16.8] | 8.1 [—] | 70.5 [35] |
| Casual | 0.5 [end of day 1; test 0.4–1.2] | 3.1 [3 to 4; test 2.5–4.5] | 7.2 [6 to 8; test 5–8] | 3.1 [7.6] | 96 [94] |
| Casual, no puzzles | 2.1 [2.1; test ≤ 3] | 6.2 [11.3] | 9.5 [11.3] | 6.2 [18.9] | 70 [54] |
| Forgetful | 1.5 [2.3] | 5.0 [10.3] | 10.0 [11.6] | 5.0 [15.8] | 83.5 [69] |
| Forgetful, no puzzles | 2.5 [2.3] | 7.5 [10.8] | 11.3 [12.1] | 7.5 [16.3] | 72 [68] |

Rerun after changes 8 to 11 (v0.2 gates, the third mixer, Next followed
faithfully) on top of the v0.2 sim (6×6 shelf with lines, muddy batches on a
production clock). Before them (same engine, 30 seeds): Casual Phase 2 0.2,
Phase 3 2.0, Renovate 6.3. Phase 3 now waits for the 50-color Loading Yard, so
Phase 3 and "50 colors" coincide for every profile, and Casual fits 4 Renovates
in 21 days instead of 5 (income on day 21 is 25K/s instead of 61K/s).

First session (`node tools/balance/run.js --minutes 10 --seeds 30`, Casual,
script: tutorial order at 0:00, tutorial Relaxed board at 1:30, an order at
6:00, Next tapped whenever it buys something): median **8 purchases** (4 to
18), the third mixer on every seed at 1.5 minutes, 5 or 6 colors at the end; the
Merge Shelf is reachable (8 colors + 400 Coins) in **session two** on every
seed, never in session one. Session two (4 hours later, 2 boards and 2 orders)
opens with 900 to 11,000 Coins from the shop and buys 20 to 116 things.

Colors include the running weekly event's page (it counts toward the catalog
and the phase gates), which is how Engaged passes 100.

### Full tables (`node tools/balance/run.js --seeds 30`)

Tincture Era 1 balance simulation (real engine), 21 days, 30 seeds per profile. Medians; "—" means most runs never got there.

#### Milestone results

| Profile | Phase 2 | Phase 3 | Renovate (10 Heritage) | 50 colors | Colors by day 21 |
| --- | --- | --- | --- | --- | --- |
| Engaged | 0.1 | 1.3 | 4.1 | 1.3 | 106 |
| Engaged, no puzzles | 2.1 | 8.1 | 9.5 | 8.1 | 70.5 |
| Casual (target player) | 0.5 | 3.1 | 7.2 | 3.1 | 96 |
| Casual, no puzzles | 2.1 | 6.2 | 9.5 | 6.2 | 70 |
| Forgetful | 1.5 | 5.0 | 10.0 | 5.0 | 83.5 |
| Forgetful, no puzzles | 2.5 | 7.5 | 11.3 | 7.5 | 72 |

#### Difficulty tiers (Casual schedule)

| Tier | First Renovate (day) | Active minutes over 21 days | Active Coins per minute (vs Relaxed) |
| --- | --- | --- | --- |
| Relaxed | 7.2 | 168 | 1.00× |
| Steady | 7.2 | 252 | 1.03× |
| Tricky | 6.2 | 420 | 1.27× |
| Master | 6.0 | 672 | 1.29× |

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

| Profile | Gallery opens (day) | Admission share, days 13–15 (day 14 alone) / day 21 | Shelf share, day 14 | Avg Essence stars, day 7 / 14 / 21 | Pieces painted by day 21 | Worst progress gap |
| --- | --- | --- | --- | --- | --- | --- |
| Engaged | 0.4 | 11.5% (12.2%) / 12.9% | 0.1% | 8.2 / 10.0 / 10.0 | 62 | 2.5 min |
| Casual | 1.2 | 17.3% (17.5%) / 20.9% | 0.0% | 6.8 / 10.0 / 10.0 | 39 | 1.5 min |
| Forgetful | 2.5 | 10.4% (10.4%) / 18.0% | 0.0% | 4.7 / 8.0 / 10.0 | 19 | 1 min |

#### Economy

| Profile | Puzzle share of Coins | Income/s day 7 | Income/s day 14 | Income/s day 21 | Offline window after day 1 (median of min) | Worst | Renovates in 21 days |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Engaged | 34.7% | 8.2K | 28.5K | 55.8K | 7.9 h | 6.1 h | 6 |
| Engaged, no puzzles | 0.0% | 2.1K | 7.8K | 14.7K | 6.1 h | 6.1 h | 3 |
| Casual | 11.5% | 5.2K | 10.4K | 25.4K | 7.4 h | 6.1 h | 4 |
| Casual, no puzzles | 0.0% | 3.9K | 7.1K | 12.9K | 6.1 h | 6.0 h | 3 |
| Forgetful | 1.3% | 4.4K | 6.9K | 10.9K | 6.6 h | 6.0 h | 3 |
| Forgetful, no puzzles | 0.0% | 1.0K | 6.0K | 9.9K | 6.1 h | 6.1 h | 2 |

## Open

- **First-session spread.** The median first session buys 8 things (change
  10) but the range is 4 to 18: a seed whose third mixer makes a tint (15× a
  primary's price) earns ~1 Coin/s and each board pays 8 × 60 × r ≈ 470, while
  a seed making primaries and secondaries earns ~0.1 Coin/s against a shop that
  sells nothing for its first ~10 minutes (change 4's reserve). Most of the
  extra purchases on rich seeds are 7-to-30-Coin starter sources that are not
  the limit (rule 6). If playtests want a tighter first session, the levers are
  starter source cost (6, change 7) and `TUTORIAL_REWARD_MULT`.
- **Bought mixers fill the cap before the rooms do.** Coins are plentiful from
  her second check-in (up to 11,000 after four hours away), so the scripted
  player buys mixers 4 and 5 (360, 2,160) there and the sixth (12,960) at her
  third check-in, before the Mill Room. The Mill Room, Mixing Hall, Loading Yard
  and Atelier then add no mixer (`MAX_SLOTS.mixers` 6), only their other slots.
  Pacing meets every target with it; a steeper `MIXER_PURCHASE.costGrowth`
  (×20 puts the fifth at 24,000) or a cap of two bought mixers would keep the
  rooms' mixers meaningful if the room cards read wrong in play.

- **Gallery paint is 2.5 minutes of production, not the doc's 20.** The doc's
  model hung about 4 pieces worth 1.3× their paint; the engine opens up to 24
  walls by day 14 (walls come back to 4 after each Renovate) and the greedy
  painter's pieces are worth ~2.2× their paint, so 20 minutes would put
  admission near 50% of income. Updating docs/DESIGN.md "Gallery and Merge
  Shelf in the simulation" to 2.5 minutes (or lowering `VALUE_MULT` and raising
  `PAINT_SECONDS` together, which keeps the share but stretches the repay time
  past 11 hours) is a doc decision. Day-14 share per seed ranges 13% to 22%
  (seeds 1–10): it swings with where the day falls in the Renovate cycle, which
  is why the test reads the median of days 13–15 (change 11; 13% to 21% on the
  same seeds).
- **Master's per-minute edge.** 1.29× Relaxed over 30 seeds after changes 8
  to 11 (1.45× after change 7; doc model 1.57×; cap 1.6). Per seed it ranges
  widely because the 21-day window lands at different points of each run's
  Renovate cycle; the edge comes from the 32 production-minutes per puzzle
  compounding through Renovate, not from discovery. k is fixed for this pass.
- **Coins never gate a room after day 1.** She holds millions by day 1.5 and
  every room and unlock price is in the thousands, so colors are the only gate
  that paces Phases 2 and 3 (change 8). A room price that binds would have to
  scale with income (like paint, change 6); not done.
- **Not modeled:** commissions (their 11 signature colors are never found, so
  the catalog tops out near 89 plus event colors), quests and Seals, boosts,
  collectors, vehicle upgrades to Wagon/Barge (fleet slots fill with handcarts
  and the Dispatcher keeps them busy, so they are never idle to replace), packing
  bonus, the Order Clerk, Packer and Steward.
- **Speed.** A 21-day run takes about 0.3 s (Forgetful) to 1.5 s (Engaged); the
  30-seed tables take ~77 s on 4 cores and the balance test ~17 s. Most of it
  is the engine: with the Dispatcher, `tickFactory` sub-steps up to 48 times per
  catch-up and each step re-runs `autoDispatch` → `bestPicks`, which recomputes
  hue family and route demand for every stocked color per vehicle; the rest is
  one `flowMeter` read per purchase (thousands per run, more with each
  Renovate rebuild). The test spreads its 45 runs over worker threads
  (`tools/balance/parallel.js`); the first-session check (30 seeds of
  `firstSessions`) adds under a second.
