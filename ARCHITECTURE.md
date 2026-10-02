# Tincture — Architecture

Tincture is a cozy color-mixing idle game for phones, built as an installable
PWA: static files only, vanilla ES modules, no bundler, no runtime
dependencies, Canvas-free (DOM + inline SVG). Design spec: `docs/DESIGN.md`
(the spec wins over any prototype). Approved look-and-feel prototypes:
`docs/prototypes/*.dc.html` (reuse their SVG shapes, OKLab math, and
Web Audio sound code; ignore their `DCLogic` component framework).

Scope of this build: **Era 1 complete** (all four puzzles, Mixing bench,
Merge Shelf, Gallery, 3 hunters → 6, postcards for 5 regions, dailies, weekly,
commissions, Renovate + Heritage tree, the full 8-event rotation as data).
Eras 2 and 3 are data-driven extension points (era table in content) and are
not playable yet; the era capstone commission shows "coming in a later
update".

Live URL (GitHub Pages, repo root): `https://short-matthew-f.github.io/Tincture/`
All asset URLs are **relative** (`./sw.js`, `src/…`) so the app works from any
sub-path and from `python3 -m http.server`.

```
index.html             app shell: one page, every screen is a <section data-screen>
style.css              design tokens + papercut components (see "UI kit")
manifest.webmanifest   PWA manifest
sw.js                  service worker (app-shell cache, versioned)
version.json           {"version":"0.1.0","build":"2026-10-02T…"} — bumped with sw.js
src/
  app.js               boot: load save, start Game, mount screens, SW + update check
  game.js              Game class: owns state, tick loop, autosave, change events
  pwa.js               registerSW(), checkForUpdates(), applyUpdate(), install prompt
  color.js             OKLab/OKLCH, ΔE, paint mixing, note mapping   (pure)
  rng.js               seeded PRNG (mulberry32) + helpers             (pure)
  format.js            number/time formatting (1.2K, "6 h 20 m")       (pure)
  state.js             createInitialState(), SAVE_VERSION, migrate() (pure)
  content/             static game data (pure data modules, see "Content")
  sim/                 game rules as pure functions on state (no DOM)
  puzzles/             puzzle generators + rules (pure)
  ui/                  screens, audio, haptics, fx (DOM only here)
test/                  node --test suites (*.test.js) + Playwright smoke (*.e2e.mjs)
tools/                 balance simulation, icon generation, catalog generation
icons/                 icon.svg source + PNGs
```

## Rules for every module

- `src/sim`, `src/puzzles`, `src/content`, `color.js`, `rng.js`, `format.js`,
  `state.js` are **pure**: no `window`, `document`, `Date.now()` (take `now`
  as an argument), no `Math.random()` (take an `rng` function returning
  [0,1)). They run under `node --test`.
- All randomness in sim uses `state.seed` via `src/rng.js` so offline catch-up
  and tests are deterministic.
- Time is milliseconds since epoch (`now`). Durations in ms. Rates are per
  **second**.
- Money and stock are plain JS numbers (floats). Never store NaN; sim
  functions must guard division by zero.
- Every sim function has the shape `fn(state, args, now) -> result` and
  mutates `state` in place. The UI never mutates state directly; it calls
  `game.act(fn, args)` which runs `fn(state, args, now)`, then emits
  `change`.
- Content is referenced by string **id** everywhere in state (never by object
  or array index), so content can change between versions without breaking
  saves.
- No external network calls, fonts included: Young Serif and Figtree are
  loaded from Google Fonts with `display=swap` **optional** (the game must be
  fully usable with the fallback Georgia / system sans when offline).

## State (src/state.js)

`createInitialState(now, seed) -> state`. `SAVE_VERSION` is an integer; every
shape change bumps it and adds a step in `migrate(save)`. Saves live in
`localStorage['tincture.save']` as JSON `{v, savedAt, state}`.

```js
state = {
  v: SAVE_VERSION,
  seed: 123456,                 // advanced by rng use
  createdAt, lastTick, lastSeenAt,   // ms
  settings: { sound: true, haptics: true, reducedMotion: 'system'|'on'|'off',
              colorblind: false, notation: 'short'|'sci', disabledQuestTypes: [],
              notifyHunters: false, notifyVats: false, puzzleTier: {grading:'relaxed'} },
  onboarding: { step: 0, done: false, flags: {} },    // first-ten-minutes script
  era: 1, phase: 1,              // phase 1 Workshop, 2 Factory, 3 Commissions
  coins: 25 /* STARTING_COINS: a few coins left in the drawer */, seals: 0, heritage: 0, heritageSpent: {},  // heritage tree node id -> level
  runEarned: 0,                  // coins earned this run (Renovate formula)
  lifetime: { earned: 0, puzzles: 0, discoveries: 0, renovations: 0 },
  rooms: ['bench'],              // room ids unlocked
  stations: {
    sources:  { madder: {level:1}, ochre:{level:1}, woad:{level:1} },   // id -> {level}
    grinders: [ {kind:'mortar', level:1} ],
    mixers:   [ {recipe:'orange'|null, level:1, progress:0, rushedAt:0, accident:null} ],
    vats:     [ {level:1, color:'madder'|null} ],  // display vats; color = which stock is shown
    shop:     { level:1 },
    fleet:    [ {kind:'handcart', level:1, route:'harbor'|null, departedAt:0, arrivesAt:0, cargo:null} ],
  },
  cellarLevel: 1,
  raw: { madder: 0, ochre: 0, woad: 0 },            // raw material per source id
  pigment: { madder: 0, ... },                        // ground pigment per pigment id
  stock: { orange: { jars: 12.5, purity: { muddy:0, standard:12.5, pure:0, flawless:0 } } }, // per color id
  catalog: { discovered: { madder: {at, name:'Madder', custom:false, essence:0} }, pinned: [] },
  apprentices: { errandRunner:true, orderClerk:false, dispatcher:false, packer:false, steward:false },
  stewardOn: false,
  orders: { open: [ Order ], nextRefreshAt, reputation: 0, filledCount: 0 },
  muddyBatches: [ { id, color, jars, tubes } ],      // pending purify puzzles
  boosts: [ { kind:'production'|'income', mult:0.5, until } ],
  shelf: { cols:5, rows:7, cells: [ null | {color, tier:1..5, golden:false} ], rowLabels: [null|'blue',...], nextSpilloverAt },
  gallery: { unlocked:false, canvases:['harbor-window',...], pieces:[ Piece ], walls:4, hung:[pieceId], taste:'green', nextCollectorAt, collectorOffer:null },
  hunters: { roster:[ Hunter ], regionsUnlocked:['meadow'], },
  album: { cards: { 'meadow-1': {count:2, at} }, setsDone:['meadow'] },
  quests: { daily:[ Quest ], dailyDate:'2026-10-02', rerollUsed:false, weekly:Quest|null, weeklyKey:'2026-W40', bank:0 },
  event: { key:'autumn-harvest', weekKey:'2026-W40', points:0, claimed:[1,2], region:'orchard' },
  eventProgress: { 'autumn-harvest': { points, claimed:[] } },   // saved across reruns
  commissions: { open:[Commission], done:['harbor-lighthouse'] },
  ledger: { pending: LedgerSummary|null, allCaughtUpAt },        // built on return
  stats: { sessionStartedAt, lastCloseUpAt },
}
```

Sub-shapes:

- `Order {id, kind:'match'|'any', target:'#hex', recipe:[{pigment,weight}], pay, container:null|{color,tier}, postedAt, customer:'Harbor Town'}`
- `Hunter {id, name, trait, level, xp, state:'home'|'out', trip:{region, duration:'short'|'long'|'overnight', departedAt, returnsAt, choice:null|'a'|'b', choiceOfferedAt}, pityStreak, perks:[]}`
- `Piece {id, canvas, title, regions:{r0:'madder',...}, signedAt, value, hung:boolean}`
- `Quest {id, type, target, progress, done, claimed, reward:{seals, boostMin, item?}}`
- `Commission {id, steps:[{color|family, jars, purity?, tier?, done}], reward, started}`
- `LedgerSummary {away:ms, produced:[{color,jars}], shipped, coinsEarned, huntersHome:[], postcards:[], ordersPosted, vials, canvases, collector, questsReady, almostThere:[{icon,text,screen}]}`

## Content (src/content/)

Each file exports frozen data and a lookup helper. Ids are kebab-case strings.

- `pigments.js` — `PIGMENTS: {id, name, hex, source, tier:'primary'}` Era 1 primaries: madder (#B8433A), ochre (#D39B2A), woad (#3E6A9E); hunter-unlocked: saffron, indigo, murex, lapis, cochineal, umber, sulfur, bone-black, chalk-white.
- `sources.js` — `SOURCES: {id, name, pigment, baseRate, baseCost, unlock:{type:'start'|'hunter', region?}}`
- `catalog.js` — `CATALOG: Color[]` 100 Era 1 colors: `{id, name, hex, era:1, page:'wheel'|'tints'|'shades'|'earths'|'wild', tier:'primary'|'secondary'|'tertiary'|'tint'|'wild', basePrice, recipe:[{pigment,weight}]|null, foundBy:'mix'|'grade'|'hunt'|'commission'|'accident', region?, hint:'found by grading'}`. Mixable colors' `hex` **must equal** `mixPaintHex(recipe)`; `tools/gen-catalog.js` regenerates hex from recipes and the test `catalog.test.js` asserts it.
- `rooms.js` — `ROOMS: {id, name, cost, colorsRequired, adds:{mixerSlots,vatSlots,grinderSlots,fleetSlots,walls}, phase}` bench, mill-room, mixing-hall, cellar, loading-yard, atelier, gallery-wing, long-hall, rotunda.
- `stations.js` — cost/output constants per station kind, milestone levels, grinder kinds (mortar, millstone, roller-mill), vehicle kinds with capacity/trip time per era.
- `routes.js` — `ROUTES: {id, name, palette:['blue','teal'], premium, bulk, unlock, demandDriftDays}`
- `regions.js` — `REGIONS: {id, name, unlock:{colors|era|event}, palette:[family], wildHues:[colorId], hauls:[pigmentId], postcards:8}`
- `hunters.js` — `HUNTERS: {id, name, trait, voice:'warm'|'dry'|…, portrait:'svg id'}` six named hunters; `TRAITS`, `DURATIONS: {short:{ms:30min, haul:1, wild:0.03, card:0.10}, long:{4h,6,0.12,0.35}, overnight:{12h,15,0.25,0.60}}`
- `postcards.js` — `POSTCARDS: {id, region, n, title, lines:[two lines], rare}` 40 cards + event sets (8 per event).
- `canvases.js` — `CANVASES: {id, name, kind:'window'|'mosaic'|'plate'|'quilt'|'tapestry'|'print', regions:[{id, d:'svg path', size:1|2|3}], viewBox, leading:'svg path', unlock}` 6 starter + milestone/postcard/commission/event designs.
- `apprentices.js`, `commissions.js`, `quests.js` (quest type pool with generator params), `events.js` (8 events with palette, region, twist, track rewards[10]), `heritage.js` (tree nodes), `eras.js`, `names.js` (suggested color-name generator word lists by hue family and lightness).

## Sim (src/sim/)

- `economy.js` — `stationCost(kind, level)`, `stationOutput(kind, level)` (1.15 growth, 1.10 for vats; milestones 10/25/50/100/150/200 double), `colorPrice(state, colorId, purity)`, `incomeMultiplier(state)` (catalog milestones +2%/10 colors, Heritage 1+0.05H, boosts capped +200%, Essence), `cheapestUpgrade(state)`, `puzzleReward(state, tier)` = max(k·r_idle·60, 0.25·m·c_min) with k 8/12/20/32 and m 1/1.5/2.5/4, `flowMeter(state)` -> {make, store, ship, weakest, suggestion:{label, cost, action}}, `tutorialReward(state)` = 1× c_min (paid once by the tour's first order, `order.tutorial`, and first board, `onboarding.flags.firstBoardPaid`).
- `factory.js` — `tick(state, now)`: advances production for `dt = now - lastTick` in one closed-form step (sources → grinders → mixers → stock, capped by storage; production pauses when full; shop sells at sell rate; fleet trips resolve; spillover vials; happy accidents; rush cooldowns; boosts expire). Must be **O(1) in dt** (no per-second loops) so a 3-day offline catch-up is instant. Exposes `collect(state, now)`, `rush(state, mixerIndex, now)`, `assignRecipe`, `buyUpgrade(state, {kind, index|id})`, `buyRoom`, `setVatColor`, `claimAccident`.
- `storage.js` — `capacity(state)`, `fillTime(state)` ("vats fill in 6 h 20 m"), `addStock(state, color, jars, purity)`, `takeStock(state, color, jars, {preferPurity})`.
- `shipping.js` — `dispatch(state, vehicleIndex, routeId, cargo, now)`, `resolveTrips`, route demand drift (`currentDemand(state, routeId, now)`), auto-dispatch for Dispatcher.
- `orders.js` — order board refresh (3–6 open), `generateOrder(state, rng)` from a real recipe of her discovered pigments, `scoreMatch(targetHex, mixHex)` -> {tier:'perfect'|'great'|'good'|'close', pct}, `submitOrder`, Order Clerk auto-fill at 70%.
- `discovery.js` — `tryDiscover(state, hex, method, now)` (ΔE ≤ 4 to an undiscovered cell), `discover(state, colorId, method, now)` → returns ceremony payload, `nameColor`, `catalogMilestones`, `nearbyUndiscovered(state, hex)` for the shimmer hint.
- `shelf.js` — spillover scheduling, `place`, `merge(state, from, to)` → chain merge result list, golden vial, `sell(state, cellIndex)`, tidy-row bonus, Cask → Essence.
- `gallery.js` — `startPiece`, `paintRegion` (consumes jars), `signPiece` (value = rarity·purity·variety·taste), `hang/unhang`, admission per second = 2e-5 · value, visitor comments, collector offers.
- `hunters.js` — `mapAttention(state, now)` -> {choices, hauls} (pure read for the map tab dot; `markHaulsSeen` sets `lastHaul.seen` when the map is shown), `sendHunter`, `resolveReturns(state, now)` (haul, wild hue with pity timer +2%/trip, postcards, companion postcard 1/15 long trips, special markets for Trader), scouting choice, hiring, leveling perks.
- `quests.js` — daily roll (3/day, weighted by unlocks, disabled types), reroll, progress hooks (`questEvent(state, type, amount)`), weekly quest, catch-up bank (2 days).
- `events.js` — 8-week rotation keyed by ISO week; event points; track claims; progress persists per event key across reruns.
- `commissions.js` — open 2–3, step progress via stock delivery, rewards (signature color id).
- `prestige.js` — `heritagePreview(state)` = floor(sqrt(runEarned/1e7)), `renovate(state, now)` (resets stations/coins/rooms/shelf contents; keeps catalog, hunters, album, apprentices, heritage, gallery, essence), heritage tree purchase.
- `ledger.js` — `buildReturnSummary(state, before, after, now)` and `almostThere(state)` (3–5 nearly-finished things across zones).
- `offline.js` — `catchUp(state, now)`: snapshot, `factory.tick`, hunters, spillover, accidents, gallery admission, then builds the ledger. Called on boot and on `visibilitychange` → visible. `shiftClock(state, ms)` moves every saved clock and absolute schedule (orders, Clerk, spillover, collector, admission, trips, fleet, Rush, boosts) `ms` into the past: `Game` uses it when the device clock went backwards (trips and cooldowns keep their time left), `debug.advance` to fake time passing.
- `closeUp.js` — `closeUpShop(state, now)`: sends idle hunters overnight, queues every mixer, returns `{fillTime}`.

## Puzzles (src/puzzles/)

All pure, all take `rng`. Each exposes `create(opts, rng) -> puzzle`, `apply(puzzle, move) -> {ok, events}`, `isSolved(puzzle)`, and `reward(state, puzzle)` glue lives in sim.

- `grading.js` — `TIERS` {relaxed:{cols:4,rows:5,anchors:'alt-edges',neighborDE:12,dims:['h']}, steady:{6,8,'sparse-edges',8,['h','l']}, tricky:{8,10,'corners+4',5,['h','l']}, master:{9,12 or shape,'corners',3,['h','l','c']}}; `createBoard({tier, palette:{hexes from catalog or event}, shape?}, rng)` generates corners in OKLCH, bilinear in OKLab, clamps gamut, **rejects and retries** when min neighbor ΔE < floor (max 40 tries, then relax the corners' spread). Shuffle leaves anchors fixed and never yields a solved board. `swap(board, i, j)`, `isSolved`, `correctCount`, `revealedTints(board)` → 1–2 in-between hexes for discovery. `switchTier` keeps progress by re-mapping positions.
- `matching.js` — `createOrder` (sim/orders uses this), `blend(drops)` via `mixPaint`, `score`.
- `purify.js` — tube sort: `create({colors:4..9, tubes:colors+2}, rng)` generated by **reverse pours from a solved state** so every puzzle is solvable; `pour(p, from, to)` moves the whole contiguous top run as capacity allows; `undo`; `addTube` (Relaxed); `isSolved` (every non-empty tube is one color and full or empty).
- `packing.js` — `create({routes:[{id, palette}], jars:[colorId…]}, rng)`; `drop(p, jarIndex, crateId)` → `{clean}`; result `{cleanCrates, bonus:0.25}`.

## UI (src/ui/)

- Screens are modules exporting `{ id, mount(root, ctx), show(params), hide(), render(state) }`. `ctx = { game, audio, haptics, fx, navigate(screenId, params), toast(text), modal(...) }`.
- Bottom bar tabs: workshop, orders, puzzles, map, catalog. `createRouter({tabDots})` reads `tabDots(state) -> {tabId: true}` on every render and shows a walnut dot (the map: a scouting choice waiting or an unread haul). Toasts (`overlay.toast`) sit just below the screen head (`--head-h` + safe area), at most 2, a tap dismisses; `toast(text, {kind:"info"})` news collapses into one slip. Overlay screens (ledger, album, quests, gallery, shelf, settings, grading, purify, packing, naming, phase-beat) open as a stacked `<section>` with a back button.
- Rendering is innerHTML-rebuild of the changed card/list at most 10×/s (`render` is called on `change` and throttled with rAF). Number counters use `fx.rollNumber(el, from, to)`.
- Every tap: `audio.tick()` + `haptics.light()` via a delegated `pointerdown` listener on `[data-tap]`.
- `audio.js` — Web Audio synth, no samples. One `AudioContext` unlocked on first gesture. API: `tick()`, `tink(hz|lightness)`, `note(L)`, `arpeggio(Ls[])`, `chord(Ls[], bright)`, `clink(tier)`, `chain(step)`, `glug(fillRatio)`, `cork()`, `thunk()`, `stamp()`, `knock()`, `bell()`, `motif()` (four-note Tincture motif), `coins(n)`, `evening()`, `duck(ms)`. All pentatonic from `color.noteHz`. Respects `settings.sound` and the `visibilitychange` (suspend when hidden).
- `haptics.js` — `light/medium/heavy/success` on `navigator.vibrate` when available, ≤1 per 80 ms, respects `settings.haptics`.
- `fx.js` — `rollNumber`, `press(el)`, `squash(el)`, `pourFill(svgEl, hex, fromPoint)`, `confetti(hexes)`, `shimmerSweep`, `flyTo(fromEl, toEl, hex)`; all honor reduced motion (fade instead).
- `kit.js` — tiny HTML helpers: `h(strings)` template tag with escaping, `card()`, `button()`, `tag()`, `swatch(hex)`, `containerSvg(tier, hex)` (the five shelf containers from `docs/prototypes/Style.dc.html`), `vatSvg(fillRatio, hex)`.

### UI kit (style.css)

Tokens from the spec: `--plaster:#E3E6E0 --paper:#F7F4EC --walnut:#7B5236 --ink:#2A2622 --ink-soft:#5E5148 --shadow: rgba(42,38,34,.25)`. Cut shadow is `box-shadow: 0 3px 0 var(--shadow)`; buttons press down 2 px (`transform: translateY(2px)` and shadow 1 px) for 120 ms. Display type `'Young Serif', Georgia, serif`; UI `'Figtree', system-ui, sans-serif`. No saturated UI accent: the only vivid colors are pigments. Min touch target 44 px. Safe-area aware (`env(safe-area-inset-*)`). `prefers-reduced-motion` and `settings.reducedMotion` map to `html[data-motion="reduced"]` where every animation becomes a 120 ms fade.

## PWA and updates (src/pwa.js, sw.js, version.json)

- `sw.js` follows the proven pattern in the author's other games: `CACHE_VERSION` string, precache `SHELL` list (every file under the repo that the app loads), network-first for navigations/JS/CSS/HTML/manifest/json, cache-first for icons, `skipWaiting` **only on message** `{type:'SKIP_WAITING'}` (not automatically, so the game never reloads mid-session), `clients.claim()` on activate, old caches deleted.
- `version.json` holds the same version string as `sw.js` and `APP_VERSION` in `src/version.js`. `tools/bump-version.js <semver>` rewrites all three and the SHELL list (it globs the files).
- `pwa.js`:
  - `registerSW()` → registers `./sw.js`, listens for `updatefound` → `installed` with an existing controller → sets `updateReady = true` and fires `onUpdateReady` (Settings shows "Update ready: Restart"; a quiet toast appears once).
  - `checkForUpdates()` → `Promise<{status:'up-to-date'|'update-ready'|'downloading'|'offline'|'unsupported', current, latest}>`: fetches `./version.json?ts=…` with `cache:'no-store'` and `registration.update()`; `update-ready` when a waiting worker exists or the fetched version differs from `APP_VERSION`.
  - `applyUpdate()` → posts `SKIP_WAITING` to the waiting worker, then reloads on `controllerchange`.
  - `installPrompt` capture of `beforeinstallprompt` for an "Add to home screen" row.
- Settings screen has: sound, haptics, reduced motion, colorblind, notation, disabled quest types, notifications (two toggles; use the Notifications API only when the user enables them; no nagging), **Check for updates** row (shows current version, result of the check, and the Restart button when ready), Add to home screen, Export save / Import save (JSON file download/upload), Reset game (double confirm).

## Game loop (src/game.js)

- `new Game({save, now})` → `state`. `start()` runs a 250 ms `setInterval` calling `factory.tick` + timers (`resolveTrips`, hunters, shelf spillover, orders refresh, quests roll, event week). A 1 Hz autosave (debounced; also on `visibilitychange` hidden and `pagehide`).
- `act(fn, args)` runs the sim function with `now = Date.now()` then `emit('change', {state, result})`; returns the result.
- On boot and on `visibilitychange: visible` after ≥ 60 s away: `offline.catchUp` then open the Morning Ledger.
- `game.on('discover', payload)` and other domain events bubble from sim results: sim functions push to `state._events` (transient, not saved) and `Game` drains them after each act/tick, emitting them to the UI (discovery ceremony, chain merge sound, hunter knock, etc.).

## Testing

- `npm test` → `node --test test/` must pass. Pure modules get unit tests. `test/balance.test.js` runs the Era 1 simulation in `tools/balance/` for the three profiles (fewer seeds in test, e.g. 5) and asserts the design doc's "Automated balance tests" list.
- `npm run e2e` (Playwright, Chromium at `/opt/pw-browsers/chromium`): `test/shell.e2e.mjs` (shell smoke), `test/first-ten-minutes.e2e.mjs` (walks the first ten minutes with time advanced, counts upgrades, no console errors, offline boot) and `test/update-flow.e2e.mjs` (0.1.0 → bump to 0.1.1 in a temp copy → Settings shows Restart → reload at 0.1.1).

## Conventions

- Files: kebab-case; exports: camelCase; content ids: kebab-case strings.
- Comment the top of each module with what it owns and the spec section it implements.
- Positive framing in all UI copy ("2 more colors", never "8 of 10"). No red for wrong answers.
- Never introduce: energy, streaks, countdown pressure, expiring progress, gacha (see spec "Banned patterns").
