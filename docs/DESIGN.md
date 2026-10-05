# Tincture — Game Design Document

Oct 1, 2026 · @Matthew Short

## Vision and pillars

Tincture is a cozy phone idle game about growing a run-down pigment workshop into a color empire, filling a giant catalog of every hue along the way. It runs itself while she's away, and always rewards a few minutes of hands-on play when she's back.

**Audience.** A player who loves Egg, Inc., Universal Paperclips and I Love Hue, and enjoys sorting puzzles. She wants many small things to tend, some active play, and a game she can forget for a day without penalty.

**Premise.** She inherits a dusty dye workshop. By mixing, grading and purifying colors, sending hunters into the world and shipping to distant markets, she builds it into a factory, then carries her catalog through new eras of color: natural dyes, synthetics, then light.

### Pillars

1. **Always a next step.** Active play can always produce progress, at every point in the game. No hard walls, no waiting-only gates.
2. **Lots of little things.** Every check-in surfaces several small, optional tasks: collect, assign, ship, solve, open a postcard.
3. **Forget-friendly.** Nothing decays, spoils or punishes absence. Being away only stops growth when storage fills.
4. **Color is the content.** Every system produces, demands or reveals colors. The catalog is the soul of the game.
5. **Calm, not compulsive.** No energy timers, no gacha, no FOMO. Rewards for engagement, never penalties for its absence.

### Tone and setting

Working assumption: cozy historical artisan workshop for Era 1, drifting into whimsy in later eras. Warm wood, glass jars, hand-lettered labels, soft paper textures. Setting is still an open question (see Open questions).

## Core loop

Three loops feed each other: the idle factory makes colors and money, active puzzles make discoveries and multipliers, and the meta layer (catalog, hunters, eras) turns both into long-term goals.

- **Idle loop (minutes to hours).** Sources produce raw materials; grinders make pigment; mixers make discovered colors; vats store them; the shop and fleet sell them. Runs offline up to vat capacity.
- **Active loop (30 seconds to 5 minutes).** Four puzzle activities: Matching (orders), Grading (Hue boards), Purifying (tube sort) and Packing (crate sort). Two calmer zones sit beside them: the Gallery (painting with her own colors) and the Merge Shelf (merging containers). Each pays currency plus something the idle loop cannot make on its own: new colors, purity, or a temporary boost.
- **Meta loop (days to weeks).** Fill catalog pages, level hunters, complete postcard sets, finish commissions, then prestige into the next era.

### The "always progress" contract

Whatever state the factory is in, at least one active activity yields meaningful progress right now:

| Factory state | Active play that still helps |
| --- | --- |
| Storage full | Fill orders and pack shipments to empty vats for cash |
| Fleet bottlenecked | Hand-deliver an order (Matching) for a premium payout |
| Production bottlenecked | Grading boards pay a timed production boost |
| Nothing affordable | Any puzzle pays Coins toward the next upgrade; simulated worst case: an upgrade affordable after every single puzzle |
| Catalog stalled | Grading reveals in-between tints; hunters find wild hues |
| All dailies done | Free-play boards, commissions and event track remain |

The two newer zones add more safety valves: the Merge Shelf almost always has a merge waiting, and an unpainted canvas turns surplus jars into lasting admission.

### Session shapes

| Session | What she does | Target time |
| --- | --- | --- |
| Peek | Collect, read the return summary, reassign a mixer, send a hunter, close | 30 s |
| Tend | The peek plus 1 to 3 puzzles, a daily quest, an upgrade or two, open postcards | 3 to 5 min |
| Settle in | Chase a commission, an event track step or a missing catalog page; prestige planning | 15 to 30 min |

### Check-in surface

Every return opens a tidy **Morning Ledger**: what was produced, what shipped, coins earned, hunters back, postcards waiting, orders posted, vials waiting on the shelf, new canvases, collector offers and quests ready. Each line is a tap target, so the ledger doubles as the to-do list of little things.

## Fun and engagement

The target is "just addictive enough": a strong pull to come back and do one more thing, where every hook rewards her for showing up and none punishes her for leaving. Each hook is paired with the guardrail that keeps it healthy.

### The pull at every time scale

| Time scale | Hook | Where it lives | Guardrail |
| --- | --- | --- | --- |
| Seconds | Every tap pays off: pour, clink, glow, chime | All zones | No fake urgency in animations |
| Minutes | "One more": the next upgrade, merge or catalog cell is always visibly close | Flow meter, shelf, catalog | Natural stopping points (below) |
| Hours | Reasons to peek: hunters home, vats full, shelf filled, new orders | Morning Ledger | Waiting never loses anything |
| Days | Daily quests, weekly visitor taste, route demand drift | Quests, Gallery, routes | No streaks; catch-up bank |
| Weeks | Events, postcard sets, Essence stars, Renovate | Events, album, catalog | Events rerun; nothing expires for good |
| Months | New eras, Spectrum mode, a gallery full of her own art | Progression, Gallery | Open-ended, never a hard end wall |

### Open loops

At any moment she should have three to five things in progress across zones: a hunter out, a commission half done, a canvas half painted, a bottle one merge from an urn, a catalog page two cells from complete. The Morning Ledger shows these as an **Almost there** strip, so returning always starts with something nearly finished.

### Gentle surprises

Surprises are bonuses on top of a predictable base. She never pays to roll and never has to chase them.

| Surprise | Rough frequency | What happens |
| --- | --- | --- |
| Happy accident batch | About every 2 h of production | A mixer glows; tap to claim a rare tint or flawless batch |
| Golden vial | About 1 in 40 spillover vials | A wildcard that merges with any same-size container and doubles its value; the other container's color is kept |
| Visiting collector | About every 2 days | Offers 3× value for a print of a hung painting; she keeps the original |
| Chain merge | Whenever one drop triggers several merges | Each step plays the next note of a rising scale |
| "Anything you love" order | About 1 in 10 orders | The customer pays extra for whatever rare color she picks |
| Companion postcard | About 1 in 15 long trips | A hunter brings back a bonus card with a second hunter's note |

Wild hues keep their pity timer, so luck never runs bad for long.

### Stopping points

A healthy game tells her when she's done. These moments give each session a satisfying close.

- **All caught up.** When every Ledger item is handled, a stamp lands on the page with a soft thunk.
- **Close up shop.** One button sends idle hunters on overnight trips, queues every mixer and shows "Vats fill in 7 h 40 m." It's a ritual ending that sets up tomorrow's rewards.
- **Long timers end sessions naturally:** an overnight expedition, a fresh commission, a canvas left to finish later.

### First ten minutes

The first session has to hook her fast and show the shape of the whole game.

1. **0:00** She mixes her first orange for a customer and names it.
2. **1:00** A Relaxed grading board reveals a tint.
3. **3:00** First upgrades; the flow meter lights up its first bottleneck.
4. **4:00** At 5 colors the Merge Shelf opens, seeded so her first drop triggers a chain merge.
5. **6:00** The order board fills; the Mill Room goal (10 colors) appears.
6. **8:00** Locked but visible: the hunters' map window and the Gallery door, each with its unlock goal.
7. **9:00** Close up shop is introduced, ending the session on a promise.

Target for the first ten minutes: 6 colors, 1 named color, 1 chain merge, about 10 upgrades.

### Banned patterns

Energy meters, login streaks, "you'll lose this" warnings, countdown pressure on rewards, gacha, paid rerolls, nagging notifications, leaderboards and expiring progress. If a future feature needs one of these to work, the feature is wrong.

### What this pass changed

| System | Problem | Change |
| --- | --- | --- |
| Merge Shelf | Merging was just arithmetic | Chain merges play a rising scale; Golden vial wildcard added |
| Gallery | Hung pieces went quiet once painted | Visitor comments name her colors by her names; visiting collector offers |
| Morning Ledger | A plain list | Almost there strip and All caught up stamp |
| Session end | Sessions just stopped | Close up shop ritual |
| Onboarding | Undefined | First-ten-minutes script with a seeded chain merge |
| Orders | All orders were exact targets | "Anything you love" orders let her choose |

## Interaction feel

Every interaction answers within 100 ms, has a small wind-up before its payoff, and lands with sound, motion and touch together. The signature trick: every color has its own musical note, pitched by lightness, so her palette literally sounds like her.

### The psychology we use

| Principle | What it means | Where it shows up |
| --- | --- | --- |
| Instant acknowledgment | Response inside 100 ms reads as "I did that" | Every button presses down; every tile lifts on touch |
| Anticipation, then release | A short wind-up (80 to 150 ms) makes the payoff land harder | Containers lean toward each other before merging; coins pause before flying |
| Escalation | Rising pitch and size signal "keep going, it's getting better" | Chain merges climb a scale; coin patter speeds up |
| Goal gradient | People speed up as a goal gets close | Almost there strip; bars and pages show how close, not how far |
| Endowed progress | A goal that starts partly done feels more achievable | The catalog opens with the three primaries filled; the first quest step completes on arrival |
| Ownership | Things we make or name feel more valuable | Naming colors, signing paintings, her names in orders and visitor comments |
| Open loops | Unfinished things stay pleasantly on the mind | Half-painted canvases, a bottle one merge from an urn |
| Completion | Finished sets give a distinct, satisfying click | Catalog pages, postcard sets, tube-sort tubes corked |
| Gentle surprise | Unexpected bonuses on a predictable base feel delightful | Happy accidents, Golden vials, the visiting collector |
| Peak-end | People remember a session by its best moment and its ending | Solve celebrations, the All caught up stamp, Close up shop |
| Correctness without failure | Show what's right; never shout about what's wrong | Grading tiles settle when correct; wrong tiles stay neutral, never red |

### Interaction spec

| Interaction | Motion | Sound | Haptic | Duration |
| --- | --- | --- | --- | --- |
| Any button | Shadow collapses 2 px on press, springs back | Soft paper tick | Light | 120 ms |
| Collect income | Coins arc to the counter; counter rolls up and slows at the end | Coin patter, rising | Light × 3 | 400 to 700 ms |
| Buy an upgrade | Station squashes to 94%, overshoots to 104%, settles | Wooden thunk; chime on milestone levels | Medium | 250 ms |
| Pour (paint a pane, add a drop) | Color floods outward from the tap point | Glug, lower for bigger regions | Soft | 300 to 450 ms |
| Swap two tiles | Tiles lift (scale 106%, shadow grows), slide, overshoot 3% | Paper slide | Light | 180 ms |
| Tile lands in its right place | Tiny settle and a one-frame shimmer | Glass tink at that tile's own note | None | 120 ms |
| Board solved | Shimmer sweeps corner to corner; seams between tiles close into one smooth gradient; the new tint rises out | Arpeggio of every tile's note, dark to light | Success | 1.2 s |
| Merge | Containers lean in, squash together, pop out one size bigger with a ring burst | Clink, one step higher per tier | Medium; Heavy for a Cask | 280 ms |
| Chain merge | Each merge waits 90 ms, then the next fires | Climbs a major scale, one note per step | Light per step | 90 ms per step |
| Essence earned | A star lifts off the Cask and flies to that color's catalog swatch | Small bell | Success | 900 ms |
| Order submitted | Her swatch slides beside the target; a closeness needle swings and settles | Chord, brighter for better tiers; color-flake confetti on Perfect | Success on Perfect | 700 ms |
| Tube-sort pour | Stream arcs; the layer lands with a slight wobble; a finished tube gets corked | Soft glugs climbing the pentatonic scale as the tube fills, over a quiet stream, with a light room echo, then the color's note, then a cork pop | Light; Medium on cork | 350 ms |
| Packing drop | Jar drops in with a bounce; a full crate's lid closes and gets stamped | Thunk, then stamp | Light | 250 ms |
| New color discovered | Screen dims 20%; swatch slides into its page; name revealed letter by letter, then the naming prompt | The four-note Tincture motif | Success | 1.5 s, skippable |
| Postcard opened | Card flips over; stamp lands | Paper flip, stamp | Light | 600 ms |
| All caught up | Ink stamp thunks onto the Ledger, ink spreads slightly | Thunk | Medium | 400 ms |
| Hunter returns | Tiny knock on the map window; backpack drops | Knock | None | 500 ms |
| Close up shop | Lights dim, shutters lower, vats glow softly | Evening bell, quiet ambience | Soft | 1.5 s |

### Sound

- **Every color has a note.** Lightness maps to pitch on a pentatonic scale, so any sounds that overlap still harmonize. A solved board plays a gradient as a melody; a painted window has its own chord.
- **Pentatonic everywhere.** Chains, coins and celebrations all sit on the same scale, so the game never makes a sour sound.
- **Mix:** UI ticks quiet, payoffs louder, ambience lowest. Celebrations briefly duck other sounds. The game follows the phone's silent switch.

### Haptics

Light, medium, heavy and success patterns only, never buzzing. At most one haptic per 80 ms, so chains feel like a ripple rather than a rattle. One toggle turns them off.

### Motion rules

- Arrivals ease out; moves ease in and out; overshoot never exceeds 5%.
- Nothing longer than 1.5 s, and any celebration can be skipped with a tap.
- Reduced motion swaps every movement for a short fade, keeping sounds and haptics.

### Small tricks

- **Merge hints:** containers that have a match on the shelf breathe softly (2% scale pulse), so she never has to hunt.
- **Positive framing:** "2 more colors" rather than "8 of 10"; "one board away" rather than "incomplete."
- **Rolling numbers** tick up and slow just before they stop, a tiny moment of anticipation.
- **Silhouettes of the missing:** empty catalog cells show a faint shimmer of their hue family, inviting curiosity without spoiling it.
- **Effort stamps:** Steady, Tricky and Master solves get their own little stamp on the board, celebrating the choice to stretch.
- **Her words come back:** colors she named appear in orders, visitor comments and postcards.
- **End on a high:** sessions close on the All caught up stamp or Close up shop, never on a list of chores.

### Guardrails

One test applies to every trick: if she knew exactly how it worked, would she feel tricked? If yes, cut it. These techniques exist to make each moment feel good, never to keep her playing longer than she wants. No near-miss gambling visuals, no fake scarcity, no unskippable celebrations, and the Banned patterns list above still applies.

### Feel checklist

- [ ] Every tap shows a visible response within 100 ms.
- [ ] No celebration over 1.5 s, and every one is skippable.
- [ ] Each container tier has its own merge pitch.
- [ ] Five overlapping sounds never clip or clash.
- [ ] Every animation has a reduced-motion version.
- [ ] Wrong grading tiles never turn red or shake.

## The factory

The factory is a five-step chain (Sources, Grinders, Mixers, Vats, Sales), shown as a cozy illustrated workshop with fixed station slots and list-style upgrade panels. The weakest step is always visible, so there is always an obvious thing to buy.

### Production chain

1. **Sources** produce raw material per second. Era 1 starts with three: Madder Patch (red), Ochre Pit (yellow), Woad Vat (blue). Hunters unlock more (Saffron Field, Indigo Terrace, Murex Cove, Lapis Seam, and so on).
2. **Grinders** turn raw material into pigment at a throughput cap. Mortar, then Millstone, then Roller Mill.
3. **Mixers** combine pigments into one assigned recipe each. A recipe is available only once its color is in the catalog. Choosing what each mixer makes is the main idle decision.
4. **Vats** store finished color. Display vats hold active colors; the shared cellar holds the rest (see Storage and shipping).
5. **Sales** happen through the standing shop (slow, automatic) and the fleet (fast, by route).

### Stations

| Station | Starts with | Era 1 max | Upgrades | Bottleneck it creates |
| --- | --- | --- | --- | --- |
| Source | 3 | 8 | Output per second, milestone doublings | Raw supply |
| Grinder | 1 Mortar | 3 Roller Mills | Throughput, purity +% | Pigment supply |
| Mixer | 1 slot | 6 slots | Speed, batch size, dual-recipe (research) | Color variety |
| Display vat | 3 | 12 | Capacity | Offline time |
| Shop counter | 1 | 1 | Sell rate, price bonus | Passive income |
| Fleet vehicle | 0 (unlocks Phase 2) | 6 | Capacity, trip time | Bulk income |

### Upgrade curves

Every levelled station uses the classic incremental curve: cost grows geometrically, output grows linearly with multiplier milestones.

```latex
\text{cost}(L) = c_0 \cdot 1.15^{L} \qquad \text{output}(L) = b \cdot L \cdot 2^{m(L)}
```

m(L) is the number of milestones passed (levels 10, 25, 50, 100, 150, 200). Vats use a gentler 1.10 cost growth so storage keeps pace with production (see Balance). Milestones are the "little celebration" beats: a jar glows, the station art changes, a shelf of the catalog lights up.

### Workshop rooms

The workshop grows room by room, so progress is visible: Bench (start), Mill Room, Mixing Hall, Cellar, Loading Yard, Atelier (grading table, Phase 3). Each room adds station slots and changes the scene. Rooms cost Coins plus a catalog requirement ("discover 12 colors"), which pulls active play forward.

### Apprentices

Apprentices each automate one manual chore. They are the Paperclips-style moment where hand work becomes a machine.

| Apprentice | Automates | Unlock |
| --- | --- | --- |
| Errand Runner | Auto-collect shop income | Phase 1 |
| Order Clerk | Auto-fill simple orders at 70% payout | Phase 2 |
| Dispatcher | Auto-ship on chosen routes | Phase 2 |
| Packer | Auto-pack crates (no packing bonus) | Phase 2 |
| Steward | Auto-buy cheapest bottleneck upgrade (toggle) | Phase 3 |

Automation always pays less than doing it by hand, so active play stays worth it.

### Light active hooks in the factory

- **Rush:** tap a mixer to fill its batch instantly, once per mixer per 10 minutes.
- **Batch events:** occasionally a mixer turns out a "happy accident" batch (rare tint or high purity). Tap to claim within the session.
- **Reassign:** event weeks and commissions shift demand, so swapping recipes is a small, satisfying decision.

## Storage and shipping

Production, storage and shipping are three capacities she balances. The flow meter always highlights the weakest one, so the next purchase is never a mystery.

### Storage: hybrid vats and cellar

- **Display vats** (3 at start, 12 max in Era 1) hold her active colors. They are the visual centerpiece: tall glass jars that fill with color in the workshop scene. Each upgrades its capacity.
- **Shared cellar** pools everything else. One capacity number, upgraded as a room.
- **When full, production pauses.** Nothing spills, spoils or decays.
- **Vat capacity is offline time.** The UI states it plainly: "Your vats fill in 6 h 20 m." Upgrading vats is upgrading how long she can forget the game.
- **Purity is tracked per batch.** High-purity stock is reserved for orders and routes that pay for quality.

### Shipping: fleet and routes

Shipping turns stock into Coins faster than the shop. It unlocks at the start of Phase 2.

| Era | Vehicles | Feel |
| --- | --- | --- |
| 1 Natural dyes | Handcart, Wagon, River Barge | Slow, charming, small loads |
| 2 Synthetics | Steam Train, Delivery Truck | Bigger loads, more routes |
| 3 Light | Airship, Pneumatic Tube, Beam Relay | Near-instant, huge volume |

Each vehicle upgrades capacity and trip time. Before the Dispatcher apprentice, she sends each trip by hand, an early active task that later becomes automated.

**Routes.** Each destination wants a palette and pays a premium for it. Era 1 examples: Harbor Town (blues, teals), Festival City (brights), Abbey (golds, deep reds), Weavers' Row (any, bulk, low price). Routes come from two places: a fixed set that unlocks with progress, plus a few **special markets discovered by hunters** (decision: both, so expeditions feed the economy as well as the catalog).

**Demand drift.** Each route's favorite color shifts every few days, shown as a small banner. Matching shipments to demand is optional optimization, never required.

### Packing (sorting tie-in)

Before a big shipment, she can pack crates by hand with a short sort puzzle (see Active play). A well-packed crate ships with a +25% bonus. Auto-pack (Packer apprentice) ships at base value.

### The flow meter

A single horizontal bar in the HUD with three segments: Make, Store, Ship. The narrowest segment glows and its upgrade button sits right under it.

- Production outruns shipping: storage fills, so the meter points at the fleet.
- Shipping outruns production: vehicles leave half empty, so it points at sources or mixers.
- Storage too small: offline time is short, so it points at vats.

### Cut from shipping

No breakdowns, route hazards, fuel or delivery failures. Shipping is a satisfying conveyor, not logistics homework.

## Active play

Four short puzzle activities, each 30 seconds to 3 minutes, each feeding a different part of the factory. Rewards scale with her current income so active play is always worth doing, early or late.

| Activity | Mechanic | Feeds | Typical length |
| --- | --- | --- | --- |
| Matching | Mix drops to hit a customer's swatch | Coins, order reputation | 30 to 60 s |
| Grading | Hue-style gradient board | New tints, production boost | 1 to 3 min |
| Purifying | Tube-sort muddy batches | Purity, sale value | 1 to 2 min |
| Packing | Sort colors into route crates | Shipping bonus | 30 to 90 s |

### Matching (orders)

A customer card shows a target swatch. She adds drops from her available pigments plus white and black, watching a live blend. Closeness is scored by perceived color distance (ΔE in OKLab).

| Result | ΔE | Payout |
| --- | --- | --- |
| Perfect | under 2 | 150% + reputation star |
| Great | 2 to 5 | 120% |
| Good | 5 to 10 | 100% |
| Close enough | 10 to 15 | 70% |

There is no fail: anything submitted pays at least 70%. An undo button and a "reset jar" keep it relaxed. Orders post to a board (3 to 6 open at once), refresh over time and wait indefinitely.

**Mixing model.** Drops blend like paint, not light: the mix is a weighted geometric mean of each pigment's linear RGB, so blue and yellow make green and black darkens strongly. Closeness is still scored in OKLab. Every order's target is generated from a real recipe of her pigments, so a Perfect match is always reachable. Era 3 switches to additive mixing (see Progression). The [style sample](https://claude.ai/artifact/Gdd7TnPgDnsCWhge8aT5CX) has a playable version.

### Grading (Hue boards)

Tiles from a gradient are shuffled; she swaps them back into order. Anchored tiles (marked with a dot) cannot move. Solving reveals one or two in-between tints for the catalog and grants a production boost.

**Difficulty tiers (player-chosen, with reward bonus):**

| Tier | Grid | Anchors | Neighbor ΔE | Dimensions | Reward |
| --- | --- | --- | --- | --- | --- |
| Relaxed | 4×5 | Every other edge tile | 12 | Hue | 1× |
| Steady | 6×8 | Edges sparse | 8 | Hue + lightness | 1.5× |
| Tricky | 8×10 | Corners + 4 | 5 | Hue + lightness | 2.5× |
| Master | 9×12 or odd shape | Corners only | 3 | Hue, lightness, chroma | 4× + bonus roll |

- **No failure state.** Move counts are for bragging rights only.
- **Free switching.** She can drop a tier mid-board; reward recalculates; progress is kept.
- **Remembers her choice** per board type, with a gentle "Try Tricky?" nudge after a few fast solves.
- **Commission boards** may set a minimum tier, never above Steady, always labeled.
- **Bonus roll** (Master only): 30% wild-hue fragment, 30% postcard, 40% event cosmetic or Seals. Harder boards improve odds, never gate content.

**Perceptual fairness.** Gradients are generated in OKLCH and tiers are defined by perceived distance between neighbors, not RGB steps. A Steady blue board feels as hard as a Steady yellow board. Generation also clamps to the sRGB gamut and rejects boards whose minimum neighbor ΔE drops below the tier floor.

**Palette and theme are separate axes.** Palette comes from her catalog, a commission or an event. Theme changes frame, tile shape, background and sound only. Event boards may use themed silhouettes (a fish, a leaf, a window), which counts as an odd shape for difficulty.

### Purifying (tube sort)

Some batches come out muddy (chance rises with mixer speed upgrades, falls with grinder quality). A muddy batch becomes a tube-sort puzzle: colored layers stacked in tubes, pour top layers onto matching colors until each tube is one color.

- Size scales with batch value: 4 colors / 6 tubes up to 9 colors / 11 tubes.
- Solving sets the batch to high purity (sells for 1.5×–2×). Ignoring it is fine: muddy batches still sell at 0.8×.
- Undo is unlimited; an extra empty tube can be added for free on Relaxed.

### Packing (crate sort)

Before a shipment, jars arrive on a conveyor in mixed order. She drops each into the crate for its route (route crates show their palette). A clean crate ships at +25%. Missorts just ship at base value. Auto-pack exists from Phase 2.

### Reward scaling: why active play never goes stale

Active rewards are paid in "minutes of production," with a floor tied to her cheapest upgrade. This is the core rule behind the always-progress pillar.

```latex
\text{reward} = \max\left(k_{tier} \cdot r_{idle} \cdot 60,\; f \cdot m_{tier} \cdot c_{\min}\right)
```

r\_idle is current Coins per second, k\_tier is minutes of production (Relaxed 8, Steady 12, Tricky 20, Master 32), m\_tier is the tier multiplier (1, 1.5, 2.5, 4), c\_min is the cost of the cheapest available upgrade and f is 0.25. Early game the floor dominates, so a few puzzles always buy an upgrade; late game the production term dominates, so puzzles stay meaningful as income grows.

## Hue Hunters and postcards

A small team of named hunters goes on timed expeditions to illustrated regions and brings back raw materials, wild hues and postcards. It is the set-and-forget heart of discovery, and it unlocks at the end of Phase 1 as the first sign the business is outgrowing her bench.

### The team

- Roster of 3 at unlock, growing to 6. Fixed slots, hired with Coins plus a catalog milestone. No gacha.
- Each hunter has a name, a portrait, a voice (for postcards) and **one trait**:

| Trait | Bonus |
| --- | --- |
| Botanist | +50% plant-based haul; better odds in Meadow and Jungle |
| Miner | +50% mineral haul; better odds in Quarry and Volcano |
| Diver | +50% sea haul; better odds at Coast and Reef |
| Lucky | +25% wild-hue and postcard odds anywhere |
| Trader | Discovers special markets (shipping routes) more often |
| Scholar | Extra catalog notes; +1 tint revealed on hauls |

- Hunters level by completing trips (levels 1 to 20). Each level adds +5% haul; levels 5, 10 and 15 add a small perk (shorter trips, an extra postcard roll, a second trait at 15).

### Regions

A static illustrated map, revealed region by region. Each region has a findable palette plus a few hidden hues.

| Region | Unlock | Signature colors |
| --- | --- | --- |
| Meadow | Hunters unlock | Greens, soft yellows, madder pinks |
| Quarry | 15 colors | Ochres, umbers, slate |
| Coast | 25 colors | Teals, sea blues, murex purples |
| Jungle | 40 colors | Vivid greens, cochineal reds |
| Volcano | 60 colors | Blacks, sulfur yellows, iron reds |
| Glacier | Era 2 | Ice blues, whites, pale violets |
| Dreamshore | Era 3 | Impossible, glowing hues |
| Event region | Weekly | Event palette |

### Expeditions

She picks a hunter, a region and a duration. Longer trips pay better per trip, slightly worse per hour, so short trips reward check-ins and long trips reward forgetting.

| Duration | Haul | Wild-hue chance | Postcard chance |
| --- | --- | --- | --- |
| 30 min | 1× | 3% | 10% |
| 4 h | 6× | 12% | 35% |
| 12 h (overnight) | 15× | 25% | 60% |

**Returns** bring raw material (feeds sources directly), sometimes a **wild hue** (a color that cannot be mixed, only found) and sometimes a postcard. Wild hues fill special catalog pages and can unlock a new source station. Raw finds may arrive unsorted, which offers an optional purify puzzle for a purity bonus.

**Scouting choice (optional, light).** On 4 h and 12 h trips, a hunter may radio in once with a choice ("follow the river" or "climb the ridge"). Ignoring it picks one at random. It is a tiny decision she can make or skip.

**Pity timer.** Every hunter's wild-hue chance rises 2% per trip without one, resetting on a find. No streak of bad luck lasts long.

### Postcards

A hunter coming home may bring a postcard: a small illustration of the region, one or two lines in the hunter's voice, and a stamp.

- Postcards collect in an **album**, with one set per region (8 cards) plus event sets.
- A completed set grants a small permanent bonus (+5% haul in that region) and a workshop wall display.
- Rare (gold-stamped) postcards come from long trips and event regions.
- Duplicates convert to Seals, so no drop is wasted.
- Postcards are pure charm and low cost: one illustration and two lines of text each. Target 40 at launch (5 regions × 8), growing to 80 with event and Era 2 sets.

## Discovery and the catalog

The catalog is a swatch book of about 240 colors across three eras (plus event pages), and every system either fills it or draws from it. It never resets.

### How colors are found

| Method | What it finds | Active or idle |
| --- | --- | --- |
| Mixing bench | Wheel colors and earth tones from combining pigments freely | Active |
| Grading boards | In-between tints and shades | Active |
| Hue Hunters | Wild hues (cannot be mixed) | Idle |
| Commissions | A signature color on completion | Mixed |
| Events | Limited event pages (they rerun) | Mixed |
| Happy accidents | Rare tints from mixer batch events | Idle, tap to claim |

**Mixing bench.** A free experiment table: drop any pigments together and see what comes out. If the result lands within ΔE 4 of an undiscovered catalog cell, it is discovered. Nearby undiscovered cells shimmer faintly on the page as a hint, so experimenting never feels blind.

### Catalog structure

| Era | Pages | Colors | Notes |
| --- | --- | --- | --- |
| 1 Natural dyes | Wheel, Tints, Shades, Earths, Wild | 100 | 16 wild |
| 2 Synthetics | Brights, Pastels, Neons, Wild | 80 | Mixing rules shift toward vivid chroma |
| 3 Light | Glow, Spectral, Impossible, Wild | 60 | Additive mixing (mixes toward white) |
| Events | One page per event theme | 12 each | Rerun in rotation |

### Discovery moment

Each new color gets a small ceremony: the swatch slides into its page, she can **name it** (or accept a suggested name), and its recipe becomes available to mixers. Named colors show her names everywhere (orders, vats, routes). This is the single most personal touch in the game.

### Catalog milestones

Every 10 colors discovered grants +2% to all Coin income (permanent, survives prestige) and some milestones also unlock a room, region or hunter slot. Milestones are what pull active play forward when idle growth plateaus.

### Catalog as a goal board

- Missing cells show their page position and a hint of how they are found ("found by grading," "a hunter's find on the Coast").
- A page completion grants a cosmetic (a page border, a workshop banner in that family).
- She can pin up to 3 missing colors as goals; pinned colors appear in the Morning Ledger with a suggested next step.

## The Gallery

The Gallery is where she uses her colors instead of selling them: she paints canvases region by region with any color she owns, hangs them on gallery walls, and visitors pay admission. It is the calmest activity in the game, with no wrong answers, and it gives the catalog a purpose beyond income.

### Painting

- **Canvases** are line-art designs split into regions: stained-glass windows, tile mosaics, painted plates, quilts, tapestries, botanical prints. Each has 12 to 60 regions.
- She taps a region, picks a color from her catalog, and it fills with a soft pour animation. Undo is unlimited; regions can be repainted until she signs the piece.
- **Any color can go anywhere.** There is no target image and no score for "correctness." A suggested palette is offered for anyone who wants a starting point.
- **Paint costs jars.** Each region uses a few jars of its color from her vats (larger regions use more). This makes the Gallery a color sink that gives the factory a reason to produce rare colors in volume.
- **Signing** finishes the piece. She can title it, and it can be exported as an image to share.

### Piece value

Value is computed from what she used, never from how "right" it looks.

| Factor | Effect |
| --- | --- |
| Rarity of colors used | Wild hues and tints worth more than primaries |
| Purity of the paint | Pure and flawless batches add up to +50% |
| Variety | +2% per distinct color, capped at +40% |
| Visitor taste (weekly) | A rotating "visitors love greens this week" bonus of +25%, optional |

### The gallery walls

- Wall slots start at 4 and grow to 24 across rooms (Gallery Wing, Long Hall, Rotunda).
- Each hung piece earns **admission** (Coins per second, idle) in proportion to its value. Admission per second is 2×10^-5 of the piece's value, so a painting repays its paint in about 11 hours and earns forever after. Simulated share: 12% to 13% of income by day 14 (target 10% to 20%).
- Visitors leave short **comments** on pieces ("The blues remind me of the harbor at dawn"), a postcard-like touch of charm. Comments use the names she gave her colors. A visiting collector occasionally offers 3× value for a print; she keeps the original.
- Unhung pieces sit in an archive and can be rotated in any time. She never loses a painting.

### Where canvases come from

| Source | Canvases |
| --- | --- |
| Gallery unlock | 6 starter designs |
| Catalog milestones | A new canvas every 20 colors |
| Postcard sets | Each completed region set unlocks a canvas of that place |
| Commissions | Specific designs that ask for a color family ("a window in jewel tones") |
| Events | 2 themed canvases per event (a sea-glass window in Deep Sea week) |
| Heritage tree | Large prestige canvases |

### Unlock and prestige

The Gallery unlocks in Phase 2 at 20 colors, with the Gallery Wing room. Paintings, wall slots and canvases **survive Renovate and Era Advance**: they are her art and never reset. Admission scales with the Heritage multiplier like all income.

## The Merge Shelf

The Merge Shelf is a fiddly, satisfying grid where matching containers merge into bigger, more valuable ones. **Merging never changes a color**: two Sage vials make a Sage jar, never a new color. Mixing stays the only way colors combine, which keeps the two systems from competing.

### How it works

- A shelf grid of 5 × 7 slots (expands to 6 × 9 with upgrades).
- Two containers of the **same color and same size** merge into the next size up.
- Merges are drag-and-drop, with a little clink, a glow and a bigger jar. A drop that triggers several merges in a row plays a rising musical scale.

| Tier | Container | Value vs one vial |
| --- | --- | --- |
| 1 | Vial | 1× |
| 2 | Jar | 2.5× |
| 3 | Bottle | 6× |
| 4 | Urn | 15× |
| 5 | Cask | 40× + Essence |

Each tier is worth more than the two containers that made it, so merging up always pays.

### Where vials come from (no energy system)

Vials arrive from things she already does, never from a refilling energy meter:

- **Production spillover:** one vial per 10 minutes of production, in one of her active colors, holding about 15 seconds of that color's output so vials keep pace as the factory grows. About 1 in 40 is a Golden vial (see Fun and engagement). It accumulates while she's away until the shelf is full, which makes the shelf another forget-friendly cap.
- **Hunter hauls** sometimes include vials of regional colors.
- **Puzzle rewards:** Perfect matches and Master boards drop a bonus vial.
- **Daily quests** can reward a jar or bottle.

### What merged containers are for

- **Sell** at a premium from the shelf (one tap).
- **Orders and commissions** sometimes ask for a specific container ("an Urn of Lapis Blue"), which gives a reason to build toward something.
- **Essence:** merging a Cask produces one Essence of that color. Essence permanently gives that color +5% production and +5% purity, stacking to 10 times. Each swatch in the catalog shows its Essence stars, which turns the shelf into a long-term collection goal.

### Sorting touch

Shelf rows can be labeled with a color family. A row holding only that family gets a **tidy shelf** bonus (+10% value on everything in it). It's optional, but it rewards the sorting instinct she already enjoys.

### Unlock and prestige

The Merge Shelf unlocks early, in Phase 1 at 5 colors, as a tactile hook in the first session. Shelf contents reset on Renovate (they are stock, like vats); Essence stars never reset.

### Guardrails

- No energy, no generators to tap, no gems, no paid shelf space.
- No color-changing merges.
- A full shelf just stops accepting spillover; nothing is lost from the factory.

## Progression, eras and prestige

Each era plays out in three phases (Workshop, Factory, Commissions), and two layers of prestige keep growth fresh: Renovate (soft reset within an era, about weekly) and Era Advance (a new color world, about monthly). The catalog, hunters and postcards always carry over.

### Phases within an era

| Phase | What changes | New systems | Gate to next phase | Era 1 target |
| --- | --- | --- | --- | --- |
| 1 Workshop | Everything by hand; a few colors; local orders | Matching, Grading, Mixing bench, Merge Shelf | 10 colors + Mill Room | First 1 to 2 sessions |
| 2 Factory | Automation and shipping arrive | Fleet, routes, Purifying, Packing, apprentices, Hue Hunters, Gallery | 30 colors + Loading Yard | Days 1 to 3 |
| 3 Commissions | Big multi-color projects; Renovate unlocks | Commissions, Atelier, Steward, event track | Era capstone commission | Days 3 to 10+ |

Phase changes are Paperclips moments: a short illustrated beat, a new room opens, the HUD gains a panel.

### Commissions

Commissions are multi-step projects that ask for specific colors in quantity, sometimes at minimum purity or including a wild hue. Examples: "Harbor Lighthouse mural" (5 blues, 2 whites, 1 wild teal), "Cathedral window" (8 jewel tones, high purity), "Festival banners" (any 10 brights, bulk). Rewards: a big Coin payout, a signature catalog color, a workshop trophy. Two to three are open at once and they never expire.

### Renovate (soft prestige)

Available from Phase 3. She renovates the workshop: stations, Coins and rooms reset; catalog, hunters, postcards, apprentices and Heritage stay.

```latex
\text{Heritage earned} = \left\lfloor \sqrt{E_{run} / 10^{7}} \right\rfloor \qquad \text{income multiplier} = 1 + 0.05 \cdot H_{total}
```

E\_run is Coins earned this run. Heritage can also be spent in a small **Heritage tree** (faster early phases, starting vats, auto-unlocked apprentices) so each run starts smoother. The game shows "Renovate now: +14 Heritage (+70% income)" and suggests renovating when the projected gain exceeds 50% of current Heritage.

### Era Advance (major prestige)

Completing the era capstone commission (needs about 80% of that era's catalog) opens the next era: a new workshop, new sources, new vehicles, new regions, and a new mixing rule.

| Era | Mixing rule | Mood |
| --- | --- | --- |
| 1 Natural dyes | Subtractive, muted (mixes toward brown) | Cozy artisan workshop |
| 2 Synthetics | Subtractive, vivid (chroma holds up) | Bustling industrial studio |
| 3 Light | Additive (mixes toward white) | Glowing, whimsical lab |

Previous eras become **Legacy Stock**: a passive trickle of income from old colors plus their full catalog pages. Era 3 ends in an open-ended Spectrum mode (endless commissions, Master boards, cosmetic prestige) so the game never runs out of little things.

### Target pacing

| Milestone | Target (a player doing 3 to 5 check-ins a day) | Era 1 simulation, Casual (median of 30 seeds, days since install) |
| --- | --- | --- |
| Third mixer | First session, right after the tutorial | Minute 1.5 of session one, every seed |
| Merge Shelf (8 colors + 400 Coins) | Session two | Session two, every seed |
| Phase 2 | End of day 1 | Day 0.5 (her last check-in of day 1) |
| Phase 3 | Day 3 to 4 | Day 3.1 |
| First Renovate | Day 6 to 8 | Day 7.2 |
| Era 2 | Week 4 to 6 | not simulated |
| Era 3 | Week 10 to 14 | not simulated |
| Spectrum mode | Month 4+ | not simulated |

Measured by `node tools/balance/run.js --seeds 30` and `--minutes 10` (the real engine; tuning log and the other profiles in `tools/balance/TUNING.md`).

## Quests and weekly events

Daily quests, a weekly quest and a rotating weekly event give every check-in a short list of little goals. All of them point at systems she already enjoys, and none of them punish missing a day.

### Daily quests

- Three per day, each 1 to 2 minutes, all completable in one Tend session.
- Drawn from a pool weighted toward what she has unlocked: "Fill 2 orders," "Solve a grading board (any tier)," "Send a hunter to the Coast," "Ship 3 crates," "Purify a batch," "Name a new color," "Merge a Bottle," "Paint 10 regions."
- **One free reroll per day.** If she hates a quest type, she can disable it in settings.
- Rewards: Seals plus a 10-minute production boost.
- **No streaks.** Unfinished dailies expire. A catch-up bank holds up to 2 missed days of daily rewards, claimable by finishing any daily.

### Weekly quest

- One goal with 3 to 5 steps, completable in about 3 to 4 check-ins.
- Examples: "Complete the Ocean commission," "Discover 5 new blues," "Finish a postcard set."
- Reward: a guaranteed rare (wild hue, gold postcard or hunter level) plus Seals.

### Weekly events

Each week runs one themed event, starting Monday and lasting 7 days.

| Event | Palette | Event region | Special twist |
| --- | --- | --- | --- |
| Autumn Harvest | Rusts, golds, ambers | Orchard | Leaf-shaped grading boards |
| Deep Sea | Teals, inks, pearl whites | Reef | Murex cove source unlocks for the week |
| Bloom Week | Pinks, lilacs, fresh greens | Garden | Bouquet orders (multi-color matching) |
| Neon Night | Electric brights | Night Market | Glowing tiles; Era 2 colors previewed |
| Winter Frost | Ice blues, silvers | Glacier Pass | Snowflake boards; long trips +25% |
| Festival of Lanterns | Warm oranges, reds | Lantern Bridge | Packing doubles as lantern stringing |
| Golden Hour | Peaches, honey, dusk violets | Hilltop | Gradient sunset boards |
| Ink and Paper | Blacks, sepias, indigos | Scriptorium | Monochrome Master boards |

Each event has:

- An **event region** on the hunter map with its own postcard set (8 cards).
- **Event orders and boards** using the palette, with themed frames, tiles and music.
- An **event track** of 10 steps fed by event points from any themed activity. Steps 1 to 6 are reachable with about 20 minutes of play across the week; steps 7 to 10 reward enthusiasts.
- A limited catalog page (12 colors) and a workshop cosmetic, plus 2 event canvases for the Gallery and event-colored vials on the Merge Shelf.

**Rerun rule.** Events rotate on an 8-week cycle and progress is saved, so a missed week comes back. This is the biggest anti-FOMO decision in the design.

### Notifications

Only two, both toggleable: "Your hunters are back" and "Your vats are full." Quests and events never send notifications.

## Economy

Three currencies, no premium currency and no ads: Coins run the factory, Seals reward engagement, Heritage carries power across resets.

| Currency | Earned from | Spent on | Resets on Renovate |
| --- | --- | --- | --- |
| Coins | Shop, shipping, orders, puzzle rewards, commissions, Gallery admission, shelf sales | Station upgrades, rooms, hunter hires, vehicles | Yes |
| Seals | Daily and weekly quests, event track, duplicate postcards, Master bonus rolls | Boosts, cosmetics, extra hunter trip slot (temporary), quest rerolls | No |
| Heritage | Renovate | Passive income multiplier, Heritage tree | No |

### Color value

Each color has a base price set by tier and multiplied by purity and route demand.

| Color tier | Example | Base price (Coins per jar, Era 1) |
| --- | --- | --- |
| Primary | Madder Red | 1 |
| Secondary | Orange, Green, Violet | 3 |
| Tertiary and earth | Russet, Olive, Umber | 8 |
| Tint or shade | Rose, Sage, Navy | 15 |
| Wild hue | Murex Purple, Lapis Blue | 60 |

Purity multiplies price (muddy 0.8×, standard 1×, pure 1.5×, flawless 2×). Route demand adds +20% to +60%. Era 2 and 3 prices scale by ×1,000 and ×1,000,000, keeping numbers satisfyingly big without feeling meaningless.

### Faucets and sinks

- **Coin faucets** scale with production; **Coin sinks** scale geometrically (1.15× per level), so growth naturally slows until a milestone, a new color or a Renovate kicks it up again.
- **Seals** are deliberately modest: about 60 per day from dailies, 150 per week from the weekly quest and up to 400 from an event track. A typical boost costs 40 and a cosmetic 200 to 600.
- **Boosts** are temporary (10 to 60 minutes) and stack additively, capped at +200%, so nothing breaks the curve.

**Gallery paint** is the main color sink: it uses jars that would otherwise sell, in exchange for lasting admission. **Essence** is not a currency: each Cask merged adds one permanent star (+5% production and purity) to that color, up to 10.

### Number formatting

Numbers use short names (1.2K, 3.4M, 5.6B) through Era 1, then named magnitudes (Qa, Qi) only in Era 3. A settings toggle switches to scientific notation.

## Balance model and testing

A 21-day simulation of Era 1 shows the design keeps both core promises: in active play an upgrade is always affordable within one puzzle (worst case 2.5 minutes across 90 simulated players), and a player who only peeks still progresses. Puzzles roughly double a Casual player's pace.

### The model

A Python simulation of the factory economy, run with 30 random seeds per player profile.

- **Production** = the slowest of sources, grinders and mixers; **income** = min(production, shop + fleet) × average color price.
- **Offline window** = vat capacity ÷ production. Away time beyond it earns nothing.
- **Price** rises with catalog size (more valuable colors) and catalog milestones; Heritage multiplies it.
- **Puzzles** pay the reward formula from Active play and may discover a color (chance falls as the catalog fills). Hunters and happy accidents discover colors while away.
- **Buying strategy** is greedy: keep the offline window at 8 hours, then buy the bottleneck's cheapest upgrade, saving for the next room once its color gate is met.

| Profile | Check-ins per day | Puzzles per check-in | Tier |
| --- | --- | --- | --- |
| Forgetful | 2 (8 am, 8 pm) | 1 in the morning | Relaxed |
| Casual (target player) | 4 | 2 | Steady |
| Engaged | 6 | 4 | Tricky |

Each profile was also run with zero puzzles to measure what active play is worth.

&#91;embedded content: Tincture Era 1 balance simulation (Python), 21 days, 30 seeds per profile, run 2026-10-01\]

### Milestone results

Median day each milestone is reached (30 seeds). "—" means most runs never got there in 21 days.

| Profile | Phase 2 | Phase 3 | Renovate (10 Heritage) | 50 colors | Colors by day 21 |
| --- | --- | --- | --- | --- | --- |
| Engaged | 0.4 | 1.4 | 3.5 | 2.8 | 100 |
| Engaged, no puzzles | 1.5 | 16.8 | 16.8 | — | 35 |
| Casual | 0.9 | 3.9 | 5.7 | 7.6 | 94 |
| Casual, no puzzles | 2.1 | 11.3 | 11.3 | 18.9 | 54 |
| Forgetful | 2.3 | 10.3 | 11.6 | 15.8 | 69 |
| Forgetful, no puzzles | 2.3 | 10.8 | 12.1 | 16.3 | 68 |

**Reading it.** Puzzles pay only 7% of a Casual player's Coins directly (26% for Engaged), but they drive discovery, which raises color prices. That indirect effect is why Casual reaches Renovate 5.6 days sooner with puzzles. Engaged income plateaus near 1.9B a day once the Era 1 catalog is full, which is the intended push toward Renovate.

### Difficulty tiers

Casual sessions replayed at each tier, 30 seeds each.

| Tier | First Renovate (day) | Active minutes over 21 days | Active Coins per minute (vs Relaxed) |
| --- | --- | --- | --- |
| Relaxed | 6.4 | 168 | 1.00× |
| Steady | 5.7 | 252 | 1.13× |
| Tricky | 5.3 | 420 | 1.26× |
| Master | 4.7 | 588 | 1.57× |

Relaxed is a fair choice: it reaches Renovate only 1.7 days after Master while spending less than a third of the time. Master's edge per minute comes from faster discovery, not the multiplier itself (base rewards are close to flat per minute by design).

### Always-progress check

The pillar "active play always produces progress" is measured as the longest stretch of active play with nothing affordable, worst case across all 30 seeds and all 21 days.

| Profile | Worst gap | One puzzle takes | Target |
| --- | --- | --- | --- |
| Forgetful | 1.0 min | 1.0 min (Relaxed) | ≤ 5 min: pass |
| Casual | 1.5 min | 1.5 min (Steady) | ≤ 5 min: pass |
| Engaged | 2.5 min | 2.5 min (Tricky) | ≤ 5 min: pass |

In every run, every single puzzle left her able to buy something. The reward floor (25% of the cheapest upgrade × tier multiplier) is what guarantees it.

### Gallery and Merge Shelf in the simulation

With both zones added and tuned, Gallery admission lands at 12% to 13% of daily income by day 14 for every profile (inside the 10% to 20% target), and the always-progress check still passes unchanged.

How they were modeled: spillover vials every 10 minutes of production (shelf cap 35, each vial worth 15 seconds of output, about 2× after typical merging); 16 vials of one color make a Cask and one Essence. She paints a piece at half of her check-ins once the Gallery opens; each piece uses 20 minutes of production in paint and hangs worth 1.3× that cost.

| Profile | Gallery opens (day) | Admission share, day 14 / day 21 | Shelf share, day 14 | Avg Essence stars, day 7 / 14 / 21 | Pieces painted by day 21 | Worst progress gap |
| --- | --- | --- | --- | --- | --- | --- |
| Engaged | 0.9 | 11.6% / 14.7% | 2.2% | 4.0 / 5.3 / 5.9 | 17 | 2.5 min |
| Casual | 2.5 | 12.8% / 15.2% | 2.8% | 3.6 / 4.8 / 5.3 | 16 | 1.5 min |
| Forgetful | 6.8 | 11.4% / 16.5% | 2.8% | 2.1 / 2.9 / 3.3 | 13 | 1.0 min |

**Reading it.** The shelf is small as direct income by design; its real payoff is Essence, worth about +24% production for a Casual player by day 14. The Gallery gives forgetful players the biggest relative boost, because hung paintings earn while she's away.

**Tuning from this run:**

| # | Problem found | Change made | Result |
| --- | --- | --- | --- |
| 5 | Admission reached only 7% to 8% of income at day 14 | Admission rate 1.15×10^-5 → 2.0×10^-5 of piece value per second (a painting repays its paint in about 11 hours) | 12% to 13% at day 14 |
| 6 | Zones sped up Renovate to day 5.3 for Casual | Heritage divisor 8×10^6 → 10^7 | Casual Renovate back to day 5.7 |

The model still treats the shelf as sold every check-in and does not model Golden vials, collectors or Gallery visitor taste.

### Tuning changes the simulation forced

| # | Problem found | Change made | Result |
| --- | --- | --- | --- |
| 1 | Vats cost-grew at 1.15× and starved every other upgrade; income stalled with stations stuck at level 50 | Vat cost growth 1.15 → 1.10 | 8 h offline window held through day 21 without stalling stations |
| 2 | Puzzles paid only 4% of Casual income directly; felt optional | Reward minutes doubled: 4/6/10/16 → 8/12/20/32 | Direct share 7% Casual, 26% Engaged; total income ×2.5 vs no puzzles |
| 3 | No-puzzle players stuck in Phase 1 until day 19+ because colors only came from puzzles | Phase 1 happy accidents (about 1 color per 3 h of production); Mill Room gate 12 → 10 colors | No-puzzle Phase 2 on day 2.1 |
| 4 | Renovate reachable by day 3.4 for Casual, too early | Heritage divisor 10^6 → 8×10^6 | Casual Renovate day 5.7 |

**Still open:** the pacing target says first Renovate on day 6 to 8; day 5.7 is slightly early. Moving to 10^7 (change 6 below) holds Casual at day 5.7 once the new zones are counted. Master's 1.57× per-minute edge is acceptable for now; if playtests show Relaxed feeling second-class, lower Master to 28 minutes.

**Model limits.** The simulation covers Era 1 economy only. It does not model boosts, commissions, events, Seals, shipping routes or purity (the Gallery and Merge Shelf are modeled in simplified form), and it uses a greedy buyer rather than a person. Treat its numbers as relative, not absolute.

### Automated balance tests

The simulation becomes a regression suite: every tuning change reruns it, and each test asserts a player-facing behavior.

- [ ] Active play: in every profile, seed and day, an upgrade is affordable within 5 minutes of continuous puzzles.
- [ ] A no-puzzle player reaches Phase 2 within 3 days.
- [ ] The Casual profile first reaches Renovate between day 5 and day 8.
- [ ] Relaxed reaches Renovate within 2 days of Master on Casual sessions.
- [ ] No tier earns more than 1.6× Relaxed's Coins per active minute.
- [ ] After day 1, the offline window never falls below 4 hours for any profile.
- [ ] Generated grading boards never have a neighbor ΔE below the tier floor.
- [ ] Any matching submission pays at least 70%.
- [ ] Event track steps 1 to 6 are reachable with 20 minutes of themed play.

Added with the Gallery and Merge Shelf:

- [ ] Gallery admission settles between 10% and 20% of total income for the Casual profile by day 14.
- [ ] Merging two containers always yields more value than selling them separately, at every tier.
- [ ] A full Merge Shelf never pauses or reduces factory production.
- [ ] Paintings, canvases and Essence stars survive Renovate and Era Advance.

### Playtest plan

1. **Paper and spreadsheet pass** on Era 1 numbers (done: this simulation).
2. **Prototype the four puzzles** standalone and play each for a week; tune tier sizes and ΔE floors by feel.
3. **Two-week diary test** with the target player: a quick note after each session on what she did, what she wanted and anything that felt like a chore.
4. **Lightweight local telemetry** (stays on the phone): session length, puzzles per session, tier choices, time between check-ins, purchases per session and screens where she quit.

## UX, notifications and accessibility

The game is built for one-handed portrait play in 30-second bursts: every common action is one or two taps from the home screen, and nothing important hides behind menus.

### Screens

| Screen | Purpose | Reached by |
| --- | --- | --- |
| Workshop (home) | Illustrated factory, flow meter, collect, rush, batch events | App open |
| Morning Ledger | Return summary and to-do list of little things | Auto on return; HUD button |
| Order board | Matching orders and commissions | Tap the counter |
| Puzzle table | Grading, Purifying, Packing boards | Tap the Atelier or a ledger line |
| Map | Hunters, regions, expeditions | Tap the window |
| Catalog | Swatch book, pinned goals, naming | Tap the shelf |
| Album | Postcards | Tap the corkboard |
| Quests and events | Dailies, weekly, event track | Tap the calendar |

The bottom bar holds five tabs: Workshop, Orders, Puzzles, Map, Catalog. Album, quests, the Merge Shelf (a shelf on the workshop wall) and the Gallery (a door to the Gallery Wing) live in the Workshop scene as tappable objects, which keeps the bar short.

### Feel

- Every collect, pour and swap has a soft sound and a gentle haptic. Jars fill with visible color.
- Discoveries get the biggest moment: swatch slide, chime, naming prompt.
- Numbers tick up smoothly; milestone levels make stations visibly change.
- Calm palette for the UI itself (warm paper, wood, ink), so the colors she makes are the brightest thing on screen.

### Notifications

Only "Your hunters are back" and "Your vats are full," both off by default and toggleable. No quest, event or "we miss you" notifications.

### Accessibility

- **Colorblind mode:** small symbols or numbers on grading tiles show their order; tube-sort layers and crate jars get patterns.
- **Required boards** (commissions, quest-required) never rely on red-versus-green distinctions alone.
- **Text size** follows the phone's setting; all controls are at least 44 pt.
- **Reduced motion** toggle disables screen shake and particle bursts.
- **No timers in puzzles**, so no one is rushed.

### Platform

Portrait, offline-first, works fully without a network connection. Save is local with optional cloud backup. As a personal project, a PWA is the fastest path; a native wrapper can come later if the haptics or notifications need it.

## Art direction

The look is papercut flat vector: cut shapes with a crisp offset shadow, a cool plaster wall, warm walnut wood, and her colors as the brightest thing on screen. The [style sample](https://claude.ai/artifact/Gdd7TnPgDnsCWhge8aT5CX) is the reference.

### Tokens

| Role | Value | Use |
| --- | --- | --- |
| Plaster | #E3E6E0 | Screen ground and workshop wall |
| Card paper | #F7F4EC | Cards, labels, postcards, empty canvas panes |
| Walnut | #7B5236 | Shelves, frames, lids, furniture |
| Ink | #2A2622 | Text, leading lines, primary buttons |
| Cut shadow | Ink at 22% to 28%, 2 to 4 px straight down | Every raised shape; no blur beyond 0.5 px |
| Display type | Young Serif | Names: colors, rooms, canvases, postcards |
| UI type | Figtree 400 to 700 | Everything tapped or read |

The UI never uses a saturated accent of its own. Saturated color belongs to pigments only, so a discovered color always reads as the most vivid thing on the screen.

### Production rules

- **Draw neutral, tint in code.** Containers, vats, canvas panes, tiles and swatches are drawn once and filled at runtime.
- **Vector first.** All assets are SVG or vector exports, so they scale to any phone and tint cleanly.
- **Leading lines** (stained glass, canvas outlines) are ink at 3 to 4 px with rounded joins.
- **Highlights** are a single soft white strip at 45% to 50% opacity on glass.
- **Locked things stay visible:** locked rooms, doors and regions show in full with a paper tag naming the unlock goal.

### Who makes what

| Asset | Count at launch | Made by |
| --- | --- | --- |
| Containers, vats, icons, UI | About 50 | In-house SVG |
| Geometric canvases (mosaic, window, quilt) | 6 starter + 5 per era | In-house SVG |
| Workshop scene and stations | 1 scene, 6 room states, 18 station looks | In-house first pass, artist polish |
| Hunter portraits | 6 | Commissioned artist |
| Region illustrations and postcards | 5 regions, 40 postcards | Commissioned artist (first 10 set the style) |

Postcards drop from 80 to 40 at launch (5 regions × 8); event and Era 2 sets bring the total to 80 later.

## Prototypes

Nine papercut artboards in the [style sample](https://claude.ai/artifact/Gdd7TnPgDnsCWhge8aT5CX) cover all six core activities plus the home screen, the Ledger and the style tile; seven are playable with sound. The spec in this doc wins wherever a prototype differs.

| Prototype | Playable | What it shows | Status |
| --- | --- | --- | --- |
| Workshop home | No | Scene, flow meter, Almost there card, tab bar | Approved look |
| Style tile | No | Era 1 pigments, materials, five tinted containers, type | Approved look |
| Gallery: Harbor Window | Yes | 16-pane stained glass; pick a color, tap a pane | Approved |
| Merge Shelf | Yes | Same-size, same-color merges; Golden vial; Cask grants Essence | Approved |
| Grading board (Relaxed) | Yes | OKLab gradient, fixed tiles, color-to-note sound | Sound approved |
| Matching an order | Yes | Paint-style mixing, live closeness, tiered chords | Approved |
| Morning Ledger | Yes | Item sounds, All caught up stamp, Close up shop | Approved |
| Purifying | Yes | Tube sort, pentatonic glug pour, cork pop, extra tube | Pour reworked once, then approved |
| Packing | Yes | Route crates, neutral missorts, clean-crate bonus | Approved |

### Differences between prototypes and spec

| Item | Spec says | Prototype does | Resolution |
| --- | --- | --- | --- |
| Relaxed grading board | 4×5, every other edge tile fixed | 5×6, corners plus two fixed | Keep the spec; the prototype was enlarged to make the sound easier to hear |
| Merge Shelf grid | 5×7, expanding to 6×9 | 5×6 | Keep the spec; 5×6 fit the mockup screen |
| Shelf restock button | Not in spec | Refills the shelf for testing | Prototype only |

### Ideas the prototypes added

- **Hear the board** (proposed): a button on grading boards that plays the tiles in reading order. A scrambled board sounds jumbled; a solved one sounds like a scale. It doubles as an audio hint and as an accessibility aid.
- **Pour pitch ladder:** the reworked pour is the reference for recorded samples, which should be pitch-shifted along the same pentatonic ladder.

## Scope, cuts and decision log

The first playable build is Era 1 only, with all four puzzles, three hunters and one event; everything else layers on once that loop feels good in her hands.

### Build order

1. **Core puzzles standalone:** Grading (with OKLCH generator and tiers), Matching, Purifying. These must be fun alone.
2. **Factory Phase 1:** sources, grinder, mixers, vats, shop, Mixing bench, catalog with naming, Merge Shelf.
3. **Phase 2:** fleet, routes, Packing, apprentices, Hue Hunters (3), postcards (Meadow and Quarry sets), Gallery with 6 starter canvases.
4. **Quests:** dailies and weekly.
5. **Phase 3:** commissions, Renovate, Heritage tree.
6. **First event** (Autumn Harvest), then the 8-week rotation.
7. **Eras 2 and 3,** Legacy Stock, Spectrum mode.

### Cut list

| Cut | Why |
| --- | --- |
| Free-form factory grid (Factorio-lite) | Becomes a second game; fights put-it-down feel |
| Multiple workshops | One growing workshop is enough |
| Full customer story | Flavor text only |
| Hunter combat, gear, multi-stat builds | One trait per hunter keeps it light |
| Gacha or random hunter hires | Fixed roster, earned slots |
| Vehicle breakdowns, route hazards, fuel | Shipping is a conveyor, not homework |
| Spoilage or decay | Absence must never punish |
| Login streaks | Replaced by a catch-up bank |
| Puzzle timers or fail states | Calm, not compulsive |
| Premium currency and ads | Personal game; no pressure systems |
| Explorable map | Static illustrated map |

### Decision log

| Decision | Chosen | Rejected | Reason |
| --- | --- | --- | --- |
| Genre | Color-mixing incremental (pigment factory) | Idle factory + sort, cozy shop, garden idle, pure Paperclips | Most original; matches her Hue love most closely |
| Discovery team | Hue Hunters with timed expeditions | No team; full management sim | Adds idle-side discovery without a second game |
| Hunter extras | Postcards; optional scouting choice | Region-event-only extras | Charm at low cost |
| Retention | Daily and weekly quests, weekly events | Streaks, limited-time exclusives | Engagement rewards without FOMO |
| Event availability | 8-week rerun rotation, progress saved | One-time events | Missing a week must not lose content |
| Puzzle structure | Difficulty, palette and theme as separate axes | Theme-driven difficulty | Each can vary independently |
| Difficulty | Player-chosen tiers with reward bonus | Progression-driven difficulty | Fits a relaxed game; Relaxed stays viable |
| Difficulty fairness | Tiers defined by perceived color distance (OKLab) | Raw RGB steps | Blues and greens otherwise feel much harder |
| Factory layout | Illustrated workshop, fixed slots, list panels | List-only; free-form grid | Charm without fiddliness |
| Storage | Display vats + shared cellar | One vat per color; single warehouse | Visual centerpiece that scales to 240 colors |
| Offline cap | Vat capacity sets the offline window | Unlimited offline | Makes vats meaningful; keeps check-ins rewarding |
| Routes | Fixed set + hunter-discovered special markets | Fixed only | Expeditions feed the economy too |
| Reward scaling | Minutes of production with an upgrade-cost floor | Flat rewards | Guarantees active progress early and late |
| Reward minutes | 8/12/20/32 | 4/6/10/16 | Simulation: puzzles were too weak (see Balance) |
| Vat cost growth | 1.10 | 1.15 | Simulation: vats starved other upgrades |
| Phase 1 idle discovery | Happy accidents about every 3 h | Discovery only from puzzles | Simulation: idle-only players stalled for 19 days |
| Mill Room gate | 10 colors | 12 colors | Simulation: smoother Phase 2 for light players |
| Heritage divisor | 10^7 | 10^6 | Simulation: Renovate came too early (tried 8×10^6 first; the new zones sped Renovate up again) |

**Fourth zone (added 2026-10-01).** Two zones were added together; the other candidates are recorded as rejected.

| Decision | Chosen | Rejected | Reason |
| --- | --- | --- | --- |
| Fourth zone | Gallery and Merge Shelf, both | Dye Garden; Dye House; a second vial-sort zone | Gallery fills the real gap (using colors); Garden overlaps hunters; Dye House overlaps Matching and Commissions; vial sorting already exists as Purifying |
| Merge rule | Merges change size only, never color | Color-changing merges | Keeps mixing as the only way colors combine |
| Merge supply | Production spillover, hauls, puzzle drops | Energy meter or tap generators | Energy timers are cut game-wide |
| Gallery scoring | Value from rarity, purity and variety | Matching a target image | Painting must have no wrong answers |
| Gallery persistence | Paintings survive all resets | Reset with the workshop | Her art should never be lost |

**Art direction (added 2026-10-01).**

| Decision | Chosen | Rejected | Reason |
| --- | --- | --- | --- |
| Visual style | Papercut flat vector | Watercolor storybook; linocut and stained glass | Cheap to produce, tints cleanly, consistent across contributors |
| Ground color | Cool plaster wall | Cream paper | Keeps the UI quiet so pigments are the most vivid thing on screen |
| Type | Young Serif names, Figtree UI | One family only | Names feel hand-labeled; UI stays clean |
| Launch postcards | 40 | 80 | Biggest art cost; more arrive with events and Era 2 |

**Interaction feel (added 2026-10-01).**

| Decision | Chosen | Rejected | Reason |
| --- | --- | --- | --- |
| Color sound | Each color has a note, pitched by lightness | One generic sound per action | Her palette becomes music; solves play as melodies |
| Scale | Pentatonic for all game sounds | Free pitches | Overlapping sounds always harmonize |
| Wrong answers | Neutral; only correct placements get feedback | Red flashes or shakes | Correctness without failure keeps puzzles calm |
| Celebrations | 1.5 s max, always skippable | Long unskippable sequences | Delight without friction on repeat |
| Persuasion test | "Would she feel tricked if she knew?" | No explicit test | Keeps every trick on the right side of the line |

**Prototype results (2026-10-01).**

| Decision | Chosen | Rejected | Reason |
| --- | --- | --- | --- |
| Color-to-note sound | Keep, as specified | Cut | Played in the Grading, Matching and Ledger prototypes; all sounds approved |
| Paint mixing | Weighted geometric mean in linear RGB; closeness in OKLab | Averaging in OKLab | OKLab averaging turns blue plus yellow grey; paint-style mixing gives the expected green |
| Order targets | Generated from a real pigment recipe | Arbitrary target colors | Guarantees Perfect is always reachable |

## Open questions

- [ ] **Setting and tone:** cozy historical artisan, whimsical alchemy, or modern design studio?
- [ ] **Hunters:** named people with personality, or abstract crews, caravans or little creatures?
- [ ] **Title:** keep "Tincture" or pick another?
- [ ] **Heritage divisor:** now 10^7, Casual first Renovate is day 5.7; accept it, or widen the target to day 5 to 8?
- [ ] **Master tier:** keep 32 minutes, or lower to 28 if Relaxed feels second-class in playtests?
- [ ] **Era 2 and 3 balance:** extend the simulation once Era 1 feels right in prototype.
- [ ] **Art direction:** style is set (papercut, see Art direction); who is the commissioned artist for postcards and portraits?
- [ ] **Platform:** PWA first, or straight to a native app for haptics and notifications?

## Implementation deviations

Where the Era 1 build knowingly differs from this spec, and why. Each is a tuning choice that keeps the spec's intent; revisit after playtests.

| Area | Spec says | Build does | Why |
| --- | --- | --- | --- |
| Grading floors | Neighbor ΔE 12 / 8 / 5 / 3 (Relaxed / Steady / Tricky / Master) | Boards are validated against half those values, never below 2: 6 / 4 / 2.5 / 2 (`floorFor` in `src/puzzles/grading.js`); `TIERS` still carries the spec numbers | The spec values are not reachable as the *minimum* neighbor step inside sRGB at these grid sizes (an optimizer tops out near 11.5 / 6.5 / 4.8 / 3.9 before following her palette). Halving keeps the tier ordering and passes on well over 90% of boards |
| Catalog spacing | Catalog colors are clearly distinct (planned ΔE 6 between any two Era 1 colors) | Era 1 colors are at least ΔE 5 apart (closest pair ΔE 5.09); event pages keep ΔE 6 (`ERA1_MIN_DELTA_E`, `tools/gen-catalog.js`) | The 84 mixable cells do not fit at ΔE 6 inside the paint-mixing gamut (the ceiling there is about 60 to 70 colors). ΔE 5 is still above the discovery radius (ΔE 4), so a mix never matches two cells |
| Master bonus roll | 30% wild-hue fragment, 30% postcard, 40% event cosmetic or Seals | 30% fragment (paid as 30 Seals), 30% postcard from an unlocked region (else Seals), 40% 20 Seals | Fragments and event cosmetics have no inventory yet; Seals keep the value without a new system |
| Heritage canvases | Unlock with Heritage | The first Renovate grants the Grand Rotunda Window, the third the Heritage Tapestry (granted on the next tick after the Renovate) | No Heritage tree node exists for canvases; tying them to Renovate count keeps them a reward for the loop |
| Gallery paint cost | Each piece uses 20 minutes of production and hangs at 1.3× its cost | A whole canvas costs 2.5 minutes of her current mixer output (`PAINT_SECONDS = 150` in `src/sim/gallery.js`), split across regions by size and locked when the piece is started | The engine opens up to 24 walls and the painter uses valuable tints, so 20 minutes gave Gallery admission a 48% share of Casual income by day 14. At 2.5 minutes the share is about 15% (target 10 to 20%) |
| First-session pace | Puzzle rewards follow the reward-scaling formula; about 10 upgrades in the first ten minutes | A new workshop starts with 25 Coins in the till, the tour's first order and first grading board each add a tutorial reward of one cheapest upgrade (`economy.tutorialReward`), and the three starter sources cost 6 (was 10) | Before any mixer runs r_idle is 0, so the first order and board paid only the 0.25 × c_min floor (about 7 Coins against a 12-Coin upgrade) and the shop's reserve keeps it from selling for ~10 minutes. The first-ten-minutes walk now buys 8 upgrades in 5.5 minutes (tools/balance/TUNING.md change 7) |
