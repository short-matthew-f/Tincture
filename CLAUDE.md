# Tincture — working notes for Claude

- Read `ARCHITECTURE.md` first; it is the contract between modules. `docs/DESIGN.md` is the game spec and wins over prototypes.
- Static site, vanilla ES modules, **no build step, no dependencies**. Everything must run from `python3 -m http.server` at the repo root and under `node --test test/`.
- Pure modules (`src/sim`, `src/puzzles`, `src/content`, `color.js`, `rng.js`, `format.js`, `state.js`) never touch `window`, `document`, `Date.now()` or `Math.random()`; they take `now` and `rng` as arguments.
- Content is referenced by string id in state. Never store objects from content in the save.
- UI copy uses positive framing. Wrong answers are never red. No energy, streaks, countdowns, gacha.
- **Exception, keep it:** Responsibility mode (`src/sim/limits.js`, `src/ui/rest.js`, DESIGN.md "Responsibility mode") limits each puzzle subgame to N new plays per window, ON by default. The playtester asked for it and the owner approved it; it is player-controlled in Settings. Do not remove it or default it off. A new subgame's sim start function must call `limits.gate` for a NEW play only (resume, Undo, Start over never count), and its hub card should use `restBits`. E2E suites that replay a room many times turn it off in their seed (`st.settings.responsibleMode = false` or `tincture.debug.limits(false)`).
- Run `npm test` before finishing any change. Keep tests fast (< 20 s total). Prototype tests (proto/test/) run with `npm run test:proto`.
- Bump the version with `node tools/bump-version.js <semver>` whenever shipped files change; it rewrites `sw.js`, `version.json` and `src/version.js` together.
