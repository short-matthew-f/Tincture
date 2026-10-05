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

## v0.2 integration (0.2.0)

- fx.js: a forwards-filled spring (lift's 1.06 hold) stays tracked after it finishes, so `settle()` always cancels it (before, a lift held longer than ~280 ms left the element stuck at 1.06). `fx.touchFeel(root, {press, lift, holdMs})` is the one delegated press/lift helper (80 ms touch hold, 6 px move-cancel, pointercancel puts the thing down quietly, `data-lift="1.02"` for wide things); `feel.js wireLift` and `workshop.js bindTouchFeel` are thin wrappers over it. `fx.pourFill` / `fx.pour` take `onFlooded()` (runs when the flood covers the shape, before the overlay leaves).
- haptics.js: inside the 80 ms window a stronger haptic (soft < light/ripple < medium < heavy/success) overrides the running weaker one; same or weaker is dropped (`test/haptics.test.js`). The app's light tick on pointerdown no longer swallows an action's medium.
- app.js: a commission's signature color waits ~900 ms before its naming ceremony, so the "Done" stamp and confetti are seen. Gallery Wing / Loading Yard purchases: the sim emits unlock → room → phase; the room beat is dropped and the phase beat waits for 'unlocked' (after the scene ceremony), so no beat covers the ceremony. The 'unlocked' guide hook covers shelf, hunters/map, gallery, shipping/yard/packing, commissions; Purify is not an unlock (its guide starts on the first muddy batch).
- Catalog guide at 375 x 667: the first faint cell can sit under the tab bar with a few colors found; the guide now scrolls it to the middle of the screen before its first step (verified with 9 colors at 375 x 667 and 390 x 844).
- DESIGN.md: Merge Shelf (6 x 6, five chips, lines of six, no row labels), Purifying (spawn clock, tiers, strict solve) and four new "Implementation deviations" rows (coin gates, 1.5 s line sequence, two starting mixers + bought third, muddy grace period).
- Packing at 375 x 667: the third crate sat below the fold, so a drag to it needed a scroll. A short-phone media query (max-height 700 px) tightens the conveyor and crates (slots 24 px) so all three fit with no scroll (packing.js, CSS only).
- Version 0.2.0 (`bump-version.js`: 92 files in SHELL, including src/ui/feel.js, guide.js, sim/next.js, sim/unlocks.js). `npm test` 294 green (~16–18 s); `npm run e2e` (shell, first-ten-minutes incl. both offline checks, update-flow, drag) green. Screenshot walk of every screen at 390 x 844 and 375 x 667 with a mid-game state (52 colors, every unlock open).
- From the v0.2 worker notes, already resolved before integration: save v3 converts 35 → 36 shelf cells; `factory.buyMixer` and the Next 'mixer' kind agree; Next's cheapest-upgrade fallback is Phase 1 only (TUNING.md change 9); balance (gallery share back to 10–20%, Casual Phase 2 on day 0.5: TUNING.md changes 8 and 11); stale color-count copy now reads `sim.unlocks.status`; guides for shelf, purify and packing register in mount so the unlock hook finds them.

## Open

- **Album guide:** not written (deferred from the guides step); the album opens cold.
- **Debug panel:** the local-only counters (`stats.lines`, `lineSkips`, `wrongDrops`, `rejectedDrags`, `coachDismissed`) are recorded but not shown in Settings yet, so the "shorten the hold if she skips more than half" check has to read the save.
- **Renovate sheet** lists what resets in general terms; it does not yet name which unlocks will close (PLAN Theme A). The batch re-buy after it works.
- **paint.js** still floods with `pourFill(keep: true)` and removes the overlay itself; it can move to `fx.pour(..., {onFlooded})` now.
- `squashOnce` / `flipLabel` (workshop.js) and `springIn` / `dust` (feel.js) are still screen-side helpers; candidates for fx.js.
- Later items from the plan: hold-to-repeat on Level up from level 10, separate effects / ambience volume, undo the last shelf move.
- Haptics are silent on iPhones (no `navigator.vibrate` in iOS Safari); sound and motion carry every meaning, by design.
- e2e coverage past the first session: Gallery, hunters, commissions, packing and purify are only opened by `first-ten-minutes.e2e.mjs`; a Phase 2+ walk should drive them.
- The first grading board in onboarding uses the running event's palette and frame (Autumn Harvest leaf); a plain board in her own colors may read better as the very first one.
- Toast offset is a fixed `--head-h` (66 px); the Workshop's taller HUD is partly under a toast, but its gear and title are not.
- Per-screen injected `<style>` tags were left as they are (20+ screens, each scoped by its own prefix).
- Purify header at 390: "How this works" wraps to two lines between the title and Undo; cosmetic.
- The one-time shelf migration toast ("The shelf is now 6 by 6 ...") sits over the color chips at 375 x 667 for its 6.5 s (tap dismisses it).
- `npm test` takes about 18 s, close to the 20 s budget; the balance suite is most of it.
