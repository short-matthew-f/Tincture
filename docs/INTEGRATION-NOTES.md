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

## Open

- Map tab dot for a pending scout choice is not wired (needs a read-only "choice waiting" helper; `offerChoice` may mutate state, so it is not called from render).
- A loaned Deep Sea source shows like any other source; the Workshop could tag it "for this week".
- The first grading board in onboarding uses the running event's palette and frame (Autumn Harvest leaf); a plain board in her own colors may read better as the very first one.
- Gallery, hunters, commissions, packing and purify are beyond the first ten minutes: the e2e only opens their screens empty. A second walk (Phase 2+) should drive them.
- `paint` with no piece on the easel closes itself (the e2e checks that); nothing points her to the Gallery from there.
- The All caught up stamp needs every pending thing handled (quests, event steps, accidents, muddy batches, collector); after 3 days away that means selling or purifying every muddy batch. Consider letting "Sell as is" batch-sell from the Ledger line.
- Early pace: after the first order and first board she holds about 7 Coins and the cheapest upgrade is 12; with one mixer on her orange the shop sells 0.04 jars/s (about +0.1 Coins/s, collected by hand until the Errand Runner), so two upgrades take roughly 3 more minutes. The e2e lets 5 minutes pass with `debug.advance`. DESIGN's "about 10 upgrades in the first ten minutes" looks out of reach; a balance question.
- Per-screen injected `<style>` tags were left as they are (consolidating them into style.css is not trivial: 20+ screens, each scoped by its own prefix).
