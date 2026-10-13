# Tincture 0.3 plan: the Craft Wing

Three new subgames, chosen with the playtester (2026-10-13): the **Tile
Room**, **Marbling and origami**, and the **Weaving Room**. Each is tried first
as a standalone prototype under `proto/` (outside the game and its offline
cache), then integrated once she has played it.

## The rule that picked them

> The game offers the parts of a craft she cannot easily do at home, never the
> parts she already does.

She is a knitter and weaver. A knitting game competed with real knitting, so
it was dropped (the prototype was removed; it is in git history). The loom
was fun because drafting on a computer gives what a real loom makes slow and
expensive: trying a draft without warping, changing colors after the fact,
ten variations in a minute. She liked **drafting** most of all, so the
Weaving Room is a drafting game first and a weaving animation second.

Test every future subgame idea against this rule.

## Shared shape (all three)

- **Opened like the other systems:** a price shows once she has enough
  colors (`src/sim/unlocks.js`), bought with Coins, a short ceremony, then
  the subgame's `guide()` (at most 2 steps before her first action).
- **Made from her factory's colors:** tiles are glazed, inks mixed, yarns
  dyed from jars in stock. Each session spends a few jars (a small, visible
  cost that ties the subgame to production) and never more than she has; the
  shop's keep reserve (`state.keep`) is respected.
- **Products, not points:** each produces a named thing (a mosaic, a folded
  crane, a bolt of cloth) that sells to a collector, fills an order or
  commission kind, or hangs in the Gallery.
- **Never a fail:** no timers, nothing red, undo where it matters, every
  result sells for something.
- **Pure rules:** each subgame's rules are a pure module (`src/puzzles/…` or
  `src/sim/…`) with node tests; the prototype's pure module is the starting
  point.

## 1. Tile Room (drafting tiles, Azul-like; not named after it)

Prototype: `proto/tiles/`.

- Dishes of glazed tiles in five colors; take all of one color from a dish,
  the rest slide to the center; fill staircase pattern lines; full lines set
  a tile into a 5 × 5 wall that scores by adjacency.
- **Ida from the pottery next door** takes one dish after each of her turns
  by a simple stated rule, so the drafting tension survives solo. A setting
  plays without her.
- Overflow goes to a **seconds basket** that sells cheaply instead of costing
  points.
- **Product:** a finished wall is a mosaic. It sells (score-based), can
  become a floor or fountain commission, or hangs in the Gallery.
- **Colors:** the five tile colors are her five shelf chips (or a glaze set
  she picks), so the Tile Room and the Merge Shelf share a palette.
- **Unlock:** after the Merge Shelf (proposal: reveal at 20 colors, 5,000
  Coins, the "Kiln" room).

## 2. Marbling and origami

Prototype: `proto/marbling/`.

- **Marbling:** drop inks on the size bath (each drop pushes older ink
  outward), draw a stylus or comb through it; the published "mathematical
  marbling" transforms keep it smooth and real-looking. Starter patterns
  (stone, gel-git, nonpareil, bouquet) play as short demonstrations.
- **Lay the paper:** the sheet lifts with exactly her pattern on it and goes
  into a paper drawer.
- **Origami:** fold a sheet step by step (tap the crease, the flap swings
  over); her marbling is on the front, plain cream on the back. Simple
  models first (cup, fox, cat, heart, tulip); squash and petal folds (the
  crane) only once the fold engine is proven.
- **Products:** marbled papers sell to the bookbinder (endpapers); folded
  figures sell to collectors, fill "a fox in blues" orders, and sit on a
  Gallery shelf.
- **Inks:** spend a little of each color used.
- **Unlock:** proposal: reveal at 35 colors, 12,000 Coins, the "Paper
  Studio".

## 3. Weaving Room (drafting first)

Prototype: `proto/loom/`.

- **The draft is the game.** Threading, tie-up, treadling (or lift plan),
  4 shafts first, 8 shafts as a later purchase (a natural coin milestone).
- **Match the cloth:** customers bring a cloth; she works out a draft that
  weaves it. A soft similarity meter (shift-tolerant), hints on request
  (threading, then tie-up, then treadling), and a warm "It matches!". This
  is the Weaving Room's equivalent of Orders. It rises from plain weave and
  twills through point twill, herringbone and color-and-weave to overshot.
- **Free drafting:** her own drafts, saved in a library, with WIF
  import/export so she can bring drafts in from real weaving software and
  take them out.
- **Weave mode** stays as the satisfying finish: tap treadles, watch the
  cloth grow.
- **Products:** bolts of cloth in her dyed colors sell along shipping routes
  (a new "textiles" demand) and fill textile commissions; a favorite cloth
  can hang in the Gallery.
- **Unlock:** proposal: reveal at 45 colors, 30,000 Coins, the "Weaving
  Room"; 8 shafts later for about 150,000.

## Order of work

1. **Prototypes (now):** Tile Room, Marbling and origami, Loom with Match the
   cloth, library and WIF. She plays them; we collect what feels wrong.
2. **0.3.0:** the Weaving Room in the game, since its drafting is the most
   loved and the loom prototype is the most mature. The "match the cloth"
   puzzle becomes an order kind.
3. **0.3.1:** the Tile Room in the game.
4. **0.3.2:** Marbling and origami in the game.
5. **Each release:** balance check (the three new incomes stay below hand
   orders per active minute, `tools/balance`), guides, feel pass, e2e walk.

## Open questions for her

- **Tile Room:** is Ida fun, or would she rather play pure solo walls?
- **Weaving:** should matching puzzles care about colors, or only about
  structure (with colors as a bonus)?
- **Origami:** which models she would most like to fold.
- **Weaving prototype:** which of its presets look wrong to a weaver. The
  builder flagged M's and O's style, waffle-style cells, the Monk's belt
  style overshot, broken twill and bird's-eye.
