# Tincture — working notes for Claude

- Read `ARCHITECTURE.md` first; it is the contract between modules. `docs/DESIGN.md` is the game spec and wins over prototypes.
- Static site, vanilla ES modules, **no build step, no dependencies**. Everything must run from `python3 -m http.server` at the repo root and under `node --test test/`.
- Pure modules (`src/sim`, `src/puzzles`, `src/content`, `color.js`, `rng.js`, `format.js`, `state.js`) never touch `window`, `document`, `Date.now()` or `Math.random()`; they take `now` and `rng` as arguments.
- Content is referenced by string id in state. Never store objects from content in the save.
- UI copy uses positive framing. Wrong answers are never red. No energy, streaks, countdowns, gacha.
- Run `npm test` before finishing any change. Keep tests fast (< 20 s total).
- Bump the version with `node tools/bump-version.js <semver>` whenever shipped files change; it rewrites `sw.js`, `version.json` and `src/app.js` together.
