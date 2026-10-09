# Tincture

Tincture is a cozy color-mixing idle game for phones. You inherit a dusty dye
workshop at the edge of Harbor Town with three pigments and two mixers, and grow
it into a color factory: sources feed grinders, grinders feed mixers, vats store
the jars and the shop and the fleet sell them, while you are away too. Every
color you make or find goes into a catalog of 100 Era 1 hues, and you name the
ones you discover.

A few minutes of hands-on play always move things forward: match customers'
orders drop by drop, slide Hue boards into smooth gradients (which reveal new
tints), sort muddy batches back to pure color, pack crates for markets, merge
containers on the Merge Shelf, paint canvases for the Gallery and send Hue
Hunters to bring back pigments and postcards. Nothing decays and nothing nags:
no energy, no streaks, no countdowns, no gacha.

**Play it:** https://short-matthew-f.github.io/Tincture/

It is an installable PWA (Add to home screen) and runs offline after the first
visit. It is served by GitHub Pages straight from the repo root (no build
step); Pages must be enabled in the repository settings (Settings > Pages,
"Deploy from a branch", the deployed branch, folder `/ (root)`).

## Run it locally

Static files only, vanilla ES modules, no dependencies:

```sh
python3 -m http.server 8000      # from the repo root (or: npm run serve)
# open http://localhost:8000/
```

## Tests

```sh
npm test       # node --test "test/**/*.test.js": unit tests + the balance suite (about 17 s)
npm run e2e    # Playwright: shell smoke, the first-ten-minutes walk, the update flow, the drag harness
```

The e2e scripts are not dependencies of the game. They import `playwright`
from the local install, `/opt/node-tools/node_modules` or the global npm root,
and launch Chromium (falling back to `/opt/pw-browsers/chromium`). When
Playwright cannot be found they print `SKIP` and exit 0. Screenshots of the
walk go to `$E2E_SHOTS` (default: `<tmpdir>/tincture-e2e-shots`).

## Shipping a new version

```sh
node tools/bump-version.js 0.2.2
```

Run it whenever shipped files change. It rewrites `src/version.js`,
`version.json` and `sw.js` together: `CACHE_VERSION` and the `SHELL` precache
list, which it regenerates by globbing every file the app loads. The service
worker installs the new version in the background and waits; players get it
from Settings > "Check for updates" > Restart (the game never reloads by
itself mid-session). A file missing from `SHELL` would break offline play, so
never hand-edit those blocks.

## Balance

```sh
node tools/balance/run.js --seeds 30            # every profile, 21 days, markdown tables
node tools/balance/run.js --profile casual --seeds 10
```

Scripted players (Forgetful, Casual, Engaged, each with and without puzzles)
drive the real sim. `test/balance.test.js` runs 5 seeds per profile and asserts
the spec's "Automated balance tests"; the tuning log is
`tools/balance/TUNING.md`.

## Files

```
index.html             the app shell: one page, every screen is a <section data-screen>
style.css              design tokens and the papercut UI kit
manifest.webmanifest   PWA manifest (name, icons, standalone display)
sw.js                  service worker: versioned precache, network-first code, waits for Restart
version.json           {"version","build"}, read by "Check for updates"
src/app.js             boot: load the save, start the Game, mount screens, register the worker
src/game.js            Game: owns state, the 250 ms tick, autosave, import/export/reset, events
src/state.js           createInitialState, SAVE_VERSION, migrate, mergeDefaults (pure)
src/pwa.js             registerSW, checkForUpdates, applyUpdate, install prompt
src/version.js         APP_VERSION (written by tools/bump-version.js)
src/sim/               game rules as pure functions on state (economy, factory, orders, hunters, ...)
src/puzzles/           grading, matching, purify and packing generators and rules (pure)
src/content/           static game data: catalog, pigments, sources, stations, rooms, hunters, events, ...
src/ui/                screens, router, overlay (toasts, modals), audio, haptics, fx
src/color.js           OKLab/OKLCH, ΔE, paint mixing, note mapping (pure)
src/rng.js             seeded PRNG and helpers (pure)
src/format.js          number and time formatting (pure)
icons/                 icon.svg source and the PNG icons
test/                  node --test suites (*.test.js) and Playwright walks (*.e2e.mjs)
tools/                 bump-version, balance simulation, icon and catalog generators
docs/DESIGN.md         the game spec (wins over prototypes)
docs/INTEGRATION-NOTES.md  integration log and open items
docs/UI-CONTRACT.md    the screen module contract
docs/prototypes/       approved look-and-feel prototypes
ARCHITECTURE.md        the module contract: state shape, sim, UI, PWA, testing
CLAUDE.md              working notes for coding agents
```

## Status

- **0.2.2** (third playtest): bonus vials (Perfect orders, events, hunter
  hauls) land in the shelf's chip colors, and vials arrive every 3 minutes
  (each worth a third, so shelf income is unchanged). Seals finally buy
  something: a Seal shop under Quests (boosts, a crate of vials, calling the
  hunters home). The Map has "Send all back out", and sending from a hunter's
  page returns to the Map. Overlays no longer fade over the screen beneath
  (the Orders "flicker"), and the board shows a row of every waiting order.
  Fleet rows say where a cart is going and that the Dispatcher reloads it.
  Gallery visitors only love a hue family she owns a color in.
- **0.2.1** (second playtest): container orders ("a Jar of …") only ask for
  the shelf's own chip colors, at most one waits on the board at a time (older
  boards are trimmed to one), the card offers "Add <color> to the shelf" or the
  merge to make, and a container order can be passed on to another shop. The
  ledger's commission line says what a step really needs ("7 more different
  colors for Festival Banners") and the workshop's Next button skips a
  commission step she has nothing in stock for.
- **0.2.0** (from the first playtest, docs/PLAN-v0.2.md):
  - **Pacing and gating:** two mixers at the start and a third bought for 60
    Coins right after the tutorial; every system is bought with Coins, colors
    only reveal the price, which shows from the start (Merge Shelf 8 colors /
    400, Hue Hunters 15 / 2,500, Gallery Wing 25 / 8,000, Commissions Phase 3
    / 20,000, Loading Yard 50 / 40,000); each purchase plays a short ceremony
    that hands off to that subgame's guide. Slower discovery, a shop reserve
    ("keep 20 jars"), and a workshop home with one Next button and segments.
  - **Merge Shelf as a match game:** 6 × 6 on one screen, five color chips,
    lines of six of a hue family merge and sell at once (1.5×, a double line
    ×2 more), drag with board-local hit testing, ghost above the finger and a
    magnet.
  - **Purifying:** one muddy batch every 2 to 3 minutes of production (backlog
    10, offline at most 3), a corked (strict) solve, four free tiers, "Sell all
    as is".
  - **Onboarding per subgame:** a `guide()` coach on every subgame's first
    open (at most 2 steps before her first action, a "How this works" replay
    link), and a "what's next" card after a first success.
  - **Gallery:** scrap an unsigned canvas, sell a signed piece to a collector.
  - **Feel:** shared springs, lift/settle, touch lift, coin arcs, stamps and
    pours (`src/ui/fx.js`) across every screen.
  - Saves from 0.1.x migrate (save v3): anything already in use stays open, the
    shelf moves to 6 × 6, and a one-time paper note says what changed.
- **Era 1 is playable:** the factory, all four puzzles, the Mixing bench, the
  Merge Shelf, the Gallery, hunters and postcards, dailies, the weekly quest
  and event rotation, commissions, Renovate and the Heritage tree, the
  first-ten-minutes tour and the Morning Ledger.
- **Eras 2 and 3 are data only:** their tables exist in `src/content`, but
  they are not playable yet (the era capstone says "coming in a later update").
- Open items and known deviations from the spec:
  [docs/DESIGN.md](docs/DESIGN.md) ("Implementation deviations") and
  [docs/INTEGRATION-NOTES.md](docs/INTEGRATION-NOTES.md) ("Open").
