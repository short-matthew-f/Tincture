# 0.3.1 audit: "does it work?" (for Candace)

Whole-game pass at 390x844 with touch, plus the mixer/vat presentation change.
Each finding is written as soon as it is found; the Status column says what is
fixed. Ranked roughly by how much it would confuse a new player.

Legend: OPEN (found, not yet fixed), FIXED (in the tree), WONTFIX (with reason).

## Findings

| # | Area | Finding | Status |
|---|------|---------|--------|
| F1 | Commissions gate | The workshop tag says "Commissions: 30 colors · 20K coins — 27 more colors", and Orders says "27 more colors, then build the Loading Yard". Commissions really need Phase 3 = the Loading Yard, which itself needs 50 colors and 40K coins. At 30 colors the promise silently changes. | FIXED: `sim.factory.phaseGoal(state, 3)` names the real gate (the Loading Yard at 50 colors and 40K, then Commissions). The workshop tag, the What-this-opens sheet, the Orders lock line and the quest how-to all read it. |
| F2 | Orders, tutorial | The Commissions lock banner sits on the Orders board from minute one of the tour, naming a goal 27-47 colors away. | FIXED: the Orders lock line waits until the tour is done. |
| F3 | Renovate gate | Heritage says "Renovate opens at 30 colors and the Loading Yard"; the Loading Yard itself needs 50 colors, so the 30 is never the real goal (same root as F1). | FIXED: Heritage reads `phaseGoal` too: "Renovate opens with the Loading Yard, which opens at 50 colors: N more colors". |
| F4 | Seals | Seals arrive from grading bonus rolls, duplicate postcards and the album, but only the Quests screen says what they are for. No one-tap explanation where she earns them. | FIXED: tap the Seals chip on Quests, or "What are Seals for?" beside Seals from grading bonuses, spare postcards (map and album), for a short note with "Open the Seal shop". The shop's short-of-Seals answer now says how many more and where to earn them. |
| F5 | Close up shop | The button gives no hint before tapping. Afterwards it reads "Shop closed" although nothing closes (the shop keeps selling), and when every hunter and mixer is already busy the ritual changes nothing without saying so. | FIXED: a line under the button says what it is for, with "What does it do?". The confirm sheet says nothing pauses, and says so plainly when everyone is already busy. Afterwards it reads "All set for tonight. Jars full in about 7 h" (workshop and ledger). |
| F6 | Event banners | Track step 6 "Workshop banner" (cosmetic `<event>-banner`) is only listed as text on Quests; it never appears in the workshop. | FIXED: earned banners hang as bunting over the calendar in the workshop scene, one pennant per event in its color; tapping it lists them. |
| F7 | Woad "Vat" | The third source is named "Woad Vat", so "Woad Vat to level 2" (Almost there, Next) reads like a storage vat upgrade. | FIXED: renamed Woad Field (content name only; the id stays `woad`). |
| F8 | Fleet swap | Vehicle rows say "Swap in" with no word on which cart is replaced (the smallest one at home, which starts again at Level 1), and offer swapping a Handcart for a Handcart, which only answers "You already have that one". | FIXED: with the yard full, each vehicle row says which cart it swaps out and that the new one starts at level 1; a swap that could only fail shows "In your yard", and "All out" while every cart is on the road. |
| F9 | Mixers vs vats | Mixers and vats are two lists; the scene's vats show colors in a different order from the mixers making them. See Part 2. | FIXED: see Part 2 below. |
| F10 | Quests, Orders | Both screens rebuilt their whole body about three times a second (SVG clip ids from a global counter made every draw look new), so a tap landing mid-rebuild did nothing: "buttons that don't work". | FIXED: `kit.stableKey` compares markup with the ids normalized; both screens now stay still until something really changes. |
| F11 | Chapter cards | The Phase 2 card promised "Carts, routes and apprentices are ready" (carts need the Loading Yard, 50 colors and 40K) and "the Gallery door opens soon"; the Phase 3 card said "Harbor Town brings you big projects" although Commissions are still a 20K purchase. | FIXED: both cards now say what is really open and that the rest shows its price in the workshop. |
| F12 | Recipe picker | "Mixer N: what to make" never refreshed while open, so a color found meanwhile was missing (the same dead end as the 0.3.0 vat list). | FIXED: the picker redraws when the mixable colors change. |
| F13 | Gallery | "Paint one" on an empty wall only showed a toast. | FIXED: it scrolls to the canvases as well. |
| F14 | Weekly quest | For a newer workshop no weekly was fully doable, so the fallback still handed out "Ship 6 crates" or "Finish a commission" (the Loading Yard is 50 colors away) and the weekly reward could never be claimed. "Discover 5 new blues" also counted blues only commissions or hunters can find. | FIXED: a step she cannot do yet becomes a stand-in she can (solve boards, fill orders, buy upgrades, name or discover a color) when the week rolls; family counts only include colors she can reach with what is open. |
| F15 | Words | "Vats" and "jars" were both used for the same storage (ledger, settings, toasts, chapter cards, Heritage "Spare Vats"). | FIXED: player-facing copy says jars everywhere ("Your jars are full", "Spare Jars"); ids and save fields are unchanged. |
| F16 | Steward | With the Steward on, coins vanished into upgrades with no word about what it bought. | FIXED: a quiet info note says "The Steward bought Bigger jars to level 4" (one slip, collapses with other news); the Steward's own note explains on/off. |
| F17 | Shelf | The vial-color chooser did not pick up a color found while it was open. | FIXED: it redraws when the catalog grows, keeping its scroll. |
| F18 | Concepts | Reputation stars ("Earn a reputation star") and the Make / Store / Ship meter had no explanation anywhere. | FIXED: tap the stars chip (or "What are stars?") or the meter for a short note. |
| F19 | Settings | Quest kinds read as ids: "Merge bottle", "Solve board", "Tile rounds". | FIXED: plain names ("Merge on the shelf", "Solve grading boards", "Tile Room rounds"). |
| F20 | Orders | "Fleet is busy: +50% for hand delivery" showed to players with no fleet at all (the bonus applies whenever Ship is the slowest step on the meter). | FIXED: "Selling is your slowest step, so orders pay +50% right now" (Orders and the matching jar). |
| F21 | Ledger | The Ledger's own Close up shop button had no explanation either. | FIXED: the same line and "What does it do?" link. |

## Mixer + vat change (Part 2)

Mechanics, balance and save format are unchanged: storage is still one shared
number (glass jars + cellar) and `vat.color` still only picks which stock a
glass shows.

- One station: the Stations tab has "Mixers and their jars" instead of separate
  Mixers and Vats panels. Each row reads "Mixer 1 makes Marigold", then
  "148 of 400 jars" with a bar in that color (its jar's fill, the same as the
  glass in the scene), then level and speed. Past the glass it says "Jar full:
  400 jars, and 120 more in the cellar"; a mixer with no glass yet says its
  jars are kept in the cellar; two mixers on one color say they share a jar.
- Jar i belongs to Mixer i: the workshop keeps vat i showing mixer i's color
  (`syncJars`, display only), so the scene's glasses line up with the mixers.
  Jars with no working mixer stay free to show any stocked color.
- "Bigger jars" is one row (it grows the smallest jar, so they grow together):
  "Your smallest jar holds 400 -> 800 jars" and "Bigger jars mean a longer
  time away: about 6 h 37 m before the workshop is full now". Next, Almost
  there and the Steward say "Bigger jars to level N" (was "Vat N to level N").
- Station notes: tapping any station's words (source, grinder, mixer, Bigger
  jars, cellar, shop, cart, Steward, any apprentice) or a glass or mixer jar in
  the scene opens a short "what this is for" sheet with live facts and the
  relevant buttons (pick or change the color, level up, Rush, keep jars back,
  ship, collect, turn the Steward on or off, hire). Text lives in
  `src/content/explain.js`.

## Checked and working (no change needed)

- Every disabled-looking button on every screen, at mid game (26 colors) and
  late game (55 colors, Phase 3, Steward), was tapped by a script: each one
  answers with a toast, a sheet or a reason. Every enabled `data-action` on
  Workshop (all tabs), Orders, Puzzles, Map, Quests, Catalog, Shelf, Gallery,
  Album, Ledger, Tile Room, Heritage, Commissions and the bench was tapped too:
  all react. (Tapping the page tab or glaze already selected does nothing, by
  design.)
- Next suggests a sensible, reachable step at every stage tried (3 to 50
  colors). Renovate works end to end, and the reopened tags afterwards name the
  right room. Daily quest targets are small (1 to 12). Hunters, shipping,
  packing, purify, grading and the Tile Room behave as their own e2e tests say.

## Not changed, on purpose

- Balance and gates themselves: `PHASE_GATES[3]` still says 30 colors, and the
  Loading Yard still asks 50; only the copy now tells the truth about it.
- Save format: no new saved fields. Weekly steps may carry an optional
  `standIn: true`; old saves keep their current weekly as it is.
- The pigment blurb "Steeped from woad leaves until the vat turns the sky" is
  flavor about dyeing, not storage, so it stays.
- Station rows are role=button areas that also hold their own buttons (the
  grinder upgrade, a claim); each inner button still wins its own tap.

## Tests

- `npm test`: 360 pass (6 new in `test/audit031.test.js`). About 20.7 s on this
  container, where 0.3.0 itself takes 20.6 s, so the new tests add about 0.2 s.
- `npm run e2e`: all seven scripts pass, including the new
  `test/workshop-stations.e2e.mjs` (mixers and their jars, station notes,
  Bigger jars, banners, Close up shop, Seals, no redraw churn on Quests and
  Orders, the Commissions lock, no horizontal scroll, no console errors).
  `test/commissions.e2e.mjs` now opens a spare jar (vat 2) for the jar list,
  since jar 0 belongs to the mixer making that color.
