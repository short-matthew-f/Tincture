# Integration notes (collected from worker reports)

Status after the integration pass. `test/first-ten-minutes.e2e.mjs` walks the
real app through DESIGN.md "First ten minutes" (`npm run e2e`).

## Done

- Router: `FULLSCREEN_IDS` (matching, bench, commissions, grading, purify, packing, paint, naming, phase-beat) always hide #tabbar, besides the module flag and `params.fullscreen`.
- No double ceremonies: `commissionDone` is skipped by the app while the Commissions screen is open (it runs "Commission complete!" itself); `allCaughtUp` is skipped while the Ledger is open (it lands its own stamp); the shelf does chain/essence visuals only and the app plays `audio.chain` per step and the Essence bell. comingSoon → modal; discover → naming (screens never navigate there).
- Markets: `state.discoveredMarkets` is canonical; `shipping.discoveredMarkets()` also reads the hunters' `routesDiscovered` mirror and `mergeDefaults` folds it in on load, so `availableRoutes` sees every hunter-found market.
- Source unlock level: `factory.unlockSource` now creates level 1, like `hunters.resolveReturns`.
- Deep Sea twist `sourceUnlock`: `sim/events.js currentEvent` lends the source (`{level:1, eventLoan:'deep-sea'}`) for the event week and removes it at the next week change unless a hunter opened it for good (hunters.js drops the mark; Renovate keeps the mark).
- Grading floors halved and catalog ΔE 5: documented in DESIGN.md "Implementation deviations" (with the Master bonus roll, Heritage canvases and gallery paint cost).
- Heritage canvases: `prestige.grantHeritageCanvases` (run from the world tick right after a Renovate) grants `grand-rotunda-window` on the first Renovate and `heritage-tapestry` on the third. Granted from the tick, not inside `renovate()`, because `test/balance.test.js` (owned by the balance worker) asserts the canvas list right after `renovate()`; it also fixes up saves that renovated earlier.
- Renovate keeps `gallery.walls` (and hung pieces); rebuying wall rooms uses max(current, rooms-derived), never a second add.
- quests.js plural templates: already `{n|one|many}`.
- Master bonus roll simplified to Seals/postcard: documented.
- `boardSolved`: the grading screen calls `ctx.game.emit('boardSolved', {puzzle, tier, tints})` after its act; onboarding step 2 advances on it (e2e-verified).
- names.js third pattern is now "Place Noun" ("Abbey Marigold"); no "-ish" hue words.
- Balance tests: green.
- `tools/bump-version.js 0.1.0` run: SHELL lists all 88 shipped files; a fresh install boots offline from the precache (e2e, with the server stopped).
- kit.h: booleans inside a quoted attribute value render "true"/"false" (`aria-pressed="${a === b}"` now works); in content position they still render nothing. Audited: catalog, settings, shelf, paint, map, album, orders, puzzles all correct now.
- `sim/hunters.js` exports `cardChance`; the map's send sheet uses it.
- `state.activePuzzles` and `stats.fastSolves` have defaults (new and loaded saves).
- fx.pourFill and fx.rollNumber clamp t ≥ 0 on the first frame.
- Collector offers: `gallery.tickAdmission` (inside `tickFactory`) schedules them every tick; verified offers appear.
- Workshop `show({assign: colorId})` (catalog "Assign to mixer"): an idle mixer takes it straight away; with every mixer busy, a sheet asks which one switches.
- paint.js uses `gallery.regionCost(state, canvasId, regionId, pieceId)` and `gallery.clearRegion`.
- Ledger "Almost there" / lines: the event line opens Quests with `{section:'event'}` (was `{tab}`); the stamp path records `allCaughtUpAt` and emits `allCaughtUp` also when she handled things elsewhere first.

Fixed while walking the first ten minutes:
- pwa.js crashed when `serviceWorker.register` resolved to nothing (automation / locked-down browsers).
- The first Relaxed board could reveal a tint already in the catalog; the first board during onboarding now always reveals the nearest undiscovered tint.
- The tutorial order said "A neighbor" in the coach mark but showed a random customer.
- Coach marks covered the button they described and sat on top of open sheets: step 3 now points at the flow-meter suggestion button, marks hide while a screen's dialog/sheet is open, pointing tags let taps through (only "Got it" is tappable), and targets scrolled under the header no longer count as visible.
- Workshop had no `data-coach="mill-room"` target (step 5).
- Small rates read "0 jars/s" (shop sells 0.04/s): workshop rates under 0.1 show two decimals.
- Empty vat label "Pick col…" truncated: now "Choose".
- `window.tincture.debug.advance(ms)` / `debug.discover(id)` for tests and the console.

Final pass (early pace, toasts, small open items, review, update flow, README):
- Early pace (TUNING.md change 7): `STARTING_COINS = 25`; the tour's first order and first board pay a tutorial reward of one cheapest upgrade (`economy.tutorialReward`, `order.tutorial`, `onboarding.flags.firstBoardPaid`); starter sources cost 6 (was 10; shop and vat kept at 40 / 60, see TUNING). The e2e walk buys the flow meter's suggestion when affordable, else the cheapest Level up, and checks at least 6 upgrades with at most 10 minutes of `debug.advance`: 8 upgrades, 5.1 minutes advanced (43.1 Coins vs a 6.9 upgrade right after the first order and board).
- Toasts sit below the screen head (`--head-h` 66 px + 10 px + safe area = 76 px), at most 3, and a tap anywhere on one dismisses it (action toasts too).
- Map tab dot: `hunters.mapAttention(state, now)` (pure read) through the router's new `tabDots` option; `markHaulsSeen` runs when the map is on screen.
- A Deep Sea loan shows a "this week" paper tag in the Workshop's sources panel.
- Paint with no piece on the easel closes, opens the Gallery and toasts "Pick a canvas to start painting" (e2e-checked).
- Review fixes (tests in `test/review.test.js`):
  - `mergeDefaults` fills missing keys one level deep in every object section (gallery, onboarding + flags, orders, shelf, hunters, quests, ...) and resets non-finite coins/seals/heritage; a v1 save missing them loads and plays.
  - `deserialize` refuses JSON without `state.stations` and `state.catalog`: before, `{"state":{}}` imported as a blank game and wiped hers. Settings now toasts on a bad file ("Your game is unchanged") as well as on a good one.
  - Clock moved back: `Game._fixClock` only rebased `lastTick`/`lastSeenAt`, so hunter trips, Rush, boosts, order refresh and spillover waited an extra day. It now shifts every schedule (`sim.shiftClock`, shared with `debug.advance`, which now also ages boosts and Rush). `rush` ignores a `rushedAt` in the future. `rollDaily`/`rollWeekly` keep the current quests when the date goes backwards (before: free fresh dailies, then a bank top-up when the clock came back).
  - `reset()` also removes `tincture.ui.*` notes (the hunters' postcard log would otherwise show the old game's cards) and the `.unreadable` copy; layout prefs stay.
  - Checked and fine: 30-day `catchUp` (~20 ms, no NaN/Infinity anywhere in state or summary), full shelf + full storage + 6 hunters out + 10 orders, Rush cooldown across a reload, Renovate twice (second refused), Clerk/Dispatcher/Steward with 0 Coins, `flowMeter` with no production, `puzzleReward` on odd states (always finite and > 0).
- Update flow verified (`test/update-flow.e2e.mjs`, in `npm run e2e`): 0.1.0 says Up to date; after `bump-version.js 0.1.1` in a temp copy served on the same origin (with GitHub Pages' `max-age=600` headers) Settings shows Update ready + Restart, and Restart reloads on 0.1.1 with only the `tincture-v0.1.1` cache. No pwa.js / sw.js change was needed. `window.tincture.version` exposes `APP_VERSION`.
- README.md at the repo root.

## Open

- The first grading board in onboarding uses the running event's palette and frame (Autumn Harvest leaf); a plain board in her own colors may read better as the very first one.
- Gallery, hunters, commissions, packing and purify are beyond the first ten minutes: the e2e only opens their screens empty. A second walk (Phase 2+) should drive them.
- The All caught up stamp needs every pending thing handled (quests, event steps, accidents, muddy batches, collector); after 3 days away that means selling or purifying every muddy batch. Consider letting "Sell as is" batch-sell from the Ledger line.
- Early pace: 8 upgrades in the walk's first session, against DESIGN's "about 10". The shop's reserve (24 jars, ~10 minutes of one mixer) means no idle income in the first session; orders and boards (paid in minutes of r_idle once a mixer runs) carry it. Levers if playtests want more: a smaller Phase 1 reserve or a cheaper second mixer (TUNING.md "Open").
- The flow meter's first suggestion after a recipe is the shop (46) and then the mixer (288): neither is affordable in the first minutes, so the coach mark at step 3 points at a button that says "Needs …" while cheap source upgrades sit in the panels. Consider letting the suggestion fall back to the cheapest affordable upgrade in Phase 1.
- Old saves: `lastHaul.seen` is missing on hauls from before this pass, so the map tab shows a dot once until she opens the map.
- Toast offset is a fixed `--head-h` (66 px). Every overlay head measures 62 px; the Workshop's taller HUD (title row, meters, suggestion) is partly under a toast, but its gear and title are not.
- Per-screen injected `<style>` tags were left as they are (consolidating them into style.css is not trivial: 20+ screens, each scoped by its own prefix).
- Shipped files changed in this pass but the version stays 0.1.0 (as instructed; `bump-version.js 0.1.0` refreshed the SHELL list). Bump to 0.1.1 before deploying over an installed 0.1.0, or installed players will not be offered the update.
