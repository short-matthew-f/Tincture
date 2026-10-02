# UI contract (screens ↔ app)

Every screen is a module under `src/ui/` with a default export:

```js
export default {
  id: 'workshop',                 // matches <section data-screen="workshop"> in index.html
  mount(root, ctx) {},            // called once at boot with the <section> element
  show(params = {}) {},           // called every time the screen becomes visible (also re-render)
  hide() {},                      // called when it leaves the screen stack
  render(state) {},               // called on every game 'change' while visible (rAF-throttled by app)
};
```

`ctx` (same object for every screen):

| key | what |
| --- | --- |
| `ctx.game.state` | the live state object (read-only from the UI) |
| `ctx.game.act(fn, args)` | runs `fn(state, args, now)` from the sim, saves, emits `change`, returns fn's result |
| `ctx.game.on(type, fn)` / `off` | events: `'change'` (state), and domain events drained from `state._events` (see `src/sim/bus.js` emit calls: `discover`, `accident`, `milestone`, `chain`, `essence`, `golden`, `collector`, `phase`, `room`, `storageFull`, `hunterReturn`, `postcard`, `setComplete`, `questDone`, `weeklyDone`, `eventStep`, `commissionDone`, `renovate`, `allCaughtUp`, `scoutChoice`, `sourceUnlocked`, `comingSoon`); screen-emitted (`ctx.game.emit`): `boardSolved` (grading, after its act), `named`, `namingDone` |
| `ctx.game.now()` | current time ms |
| `ctx.game.setSetting(key, value)`, `exportSave()`, `importSave(text)`, `reset()` | settings/save helpers |
| `ctx.sim` | the namespace `import * as sim from '../sim/index.js'` (all sim functions; also per-module namespaces `sim.factory`, `sim.shelf`, `sim.hunters`, …). Note: use `sim.hunters.unlocked` / `sim.shelf.unlocked`, never a bare `unlocked`. |
| `ctx.puzzles` | `import * as puzzles from '../puzzles/index.js'` → `puzzles.grading`, `puzzles.matching`, `puzzles.purify`, `puzzles.packing` |
| `ctx.content` | one object with every content export merged: `CATALOG`, `getColor`, `PIGMENTS`, `getPigment`, `DROPS`, `ROOMS`, `getRoom`, `STATION_KINDS`, `ROUTES`, `REGIONS`, `HUNTERS`, `TRAITS`, `DURATIONS`, `POSTCARDS`, `cardsForRegion`, `CANVASES`, `getCanvas`, `APPRENTICES`, `COMMISSIONS`, `QUEST_TYPES`, `EVENTS`, `HERITAGE_TREE`, `suggestName`, `VISITOR_COMMENTS`, … (see `src/content/*.js`) |
| `ctx.color` | `import * as color from '../color.js'` |
| `ctx.format` | `{ num(n) (honors settings.notation), duration(ms), countdown(ms), until(ms) (rounded up to the minute: "about 9 m"), rate(perSec), pct(x) }` |
| `ctx.audio`, `ctx.haptics`, `ctx.fx`, `ctx.kit` | `src/ui/audio.js`, `haptics.js`, `fx.js`, `kit.js` (see their exports) |
| `ctx.navigate(id, params)` | push a screen (tabs replace the stack; overlays stack) |
| `ctx.back()` | pop the stack (an overlay with nothing beneath it returns to its home tab) |
| `ctx.toast(text, {hex, ms})` | small paper toast |
| `ctx.modal({title, body (html string), actions:[{label, variant, value}], dismissable}) -> Promise<value>` | centered modal |
| `ctx.sheet({title, body, actions}) -> Promise<value>` | bottom sheet |
| `ctx.celebrate(kind, payload)` | app-level ceremonies: `'discover'` (opens the naming screen), `'phase'`, `'milestone'`, `'allCaughtUp'` |

Conventions:

- Build markup with `kit.h` (escaped template tag) and set `root.innerHTML`; attach ONE delegated `click` listener in `mount` and dispatch on `data-action` attributes (`<button data-action="collect" data-tap>`). Every tappable element carries `data-tap` (the app plays the tick + haptic on `pointerdown`).
- Back buttons: `kit.backButton(label)` renders `[data-back]`; the app handles it. Overlay screens put it in `.screen-head`.
- Layout skeleton: `<div class="screen-head">…</div><div class="screen-body">…</div>` inside the section.
- Keep `render(state)` cheap: rebuild only the parts that change; never rebuild while a pointer is down on a draggable.
- Rolling numbers: `fx.rollNumber(el, from, to, {format: ctx.format.num})`.
- Copy: positive framing ("2 more colors"), names from `sim.displayName(state, colorId)`. Wrong answers are never red.
- Positive-only feedback sounds come from `ctx.audio`; never add new oscillators in screens.
- All screens must work at 390 px wide and must not scroll horizontally.
- Era 2/3 content shows a paper tag "coming in a later update".
