# UX audit: Tile Room, Loom, Marbling and origami (prototypes)

Written 2026-10-13. Scope: `proto/tiles/`, `proto/loom/`, `proto/marbling/` and their tests.
The player is an experienced weaver and knitter on her phone (one iPhone, one Android in the house).

**How this was checked (handbook ch. 08 §2.1, honest evidence).** Static reading of all the code, then
*scripted touch interaction* in headless Chromium (Playwright, `Input.dispatchTouchEvent` for every tap,
hold, drag, swipe and pinch; no `page.click`) at 390×844 and 360×740, `isMobile`, `hasTouch`, DPR 2,
and a repeat pass with reduced motion. Each walk was rerun after the fixes and re-screenshotted. Nothing here
has been checked on a physical phone or with a person; performance numbers come from headless
**software** rendering, which is slower than a phone's GPU for canvas fills (marked *needs device* below).

Severity follows ch. 08 §17: **blocker** (stuck, state lost, repeated wrong action), **major**
(frequent misunderstanding or serious friction), **minor**, **polish**.

---

## 1. The Tile Room

Walked: whole games with Ida on and off (390 and 360, plus reduced motion; all reached the summary,
including the "bag ran out" ending at round 25), undo, the seconds basket, "Finish the round" with only the
middle left, the end summary, new wall (two-tap), reload mid-turn, mid-flight and during Ida's move.

| # | Sev | Finding | Evidence | Done |
|---|---|---|---|---|
| T1 | **major** (stuck) | Tapping a tile in the dish Ida is about to take, during the "Ida's turn" window, resolved Ida's move first and then selected the tile anyway. The bar said "0 woad: tap a glowing pattern line", four lines glowed, and tapping them did nothing. | scripted: `t3` picked the dish Ida chooses; bar read "0 woad…", line taps were no-ops | Fixed: after Ida moves, the tap only selects if those tiles still exist; otherwise the bar says "Ida took that dish just before you. Pick another glaze." Verified. |
| T2 | **major** (lock risk) | `place()` and `resolve()` set `busy = true` with no `try/finally`. Any exception in an animation left the board locked for good. | code | Fixed: both use `try/catch/finally`; on error the rules state is settled without animation (Ida's take, `endRound`), any flying tiles are removed, and `busy` is always cleared. |
| T3 | **major** | At the end of a game the only next action ("Start a new wall") was in the summary card, below the fold at 740 px tall (751–803). The page also stayed scrolled to the bottom, so the finished mosaic (the reward) was off-screen. | scripted + shot `tiles-360-solo-summary` | Fixed: the bottom bar keeps its job at the end ("Final score N. Well made." + **Start a new wall**). The duplicate card button is removed, and the page scrolls to the mosaic when the wall is finished. The header score now shows the final total (it showed the pre-bonus score before). |
| T4 | minor | Reload during a tile's flight lost the move (it was saved only after the animation). | scripted | Fixed: saved as soon as the move is made (with the pending flag), so a reload continues with Ida's turn. Verified. |
| T5 | minor | Ida's face stayed visible while she was resting: `.ida { display:flex }` overrode `[hidden]`. | shot | Fixed (`[hidden] { display:none !important }`). |
| T6 | minor | At 360 px the bottom bar squeezed the message into a 5-line column beside Undo and Finish. | shot `tiles-360-solo-onlymid` | Fixed: the bar wraps, putting the message on its own line and the buttons together below it. Page padding follows the bar's real height (ResizeObserver). |
| T7 | minor | Undo, "Ida: playing" and "New wall" were 36 px tall (`.btn.small` from shared.css). | measured | Fixed locally: 44 px. |
| T8 | minor | "Finish the round" didn't say what happens to the tiles left in the middle. | read | Copy: "…or finish: the rest go to seconds (+1 each)." |
| T9 | minor | The score roll used an unclamped rAF progress (the first timestamp can come before `t0`), so the score could flash below its old value. | code | Clamped to [0,1]. |
| T10 | polish (not changed) | After a placement, Ida moves by herself after 2.3 s, which ends the Undo window. It isn't a visible countdown, but it is time pressure on Undo. | read | Left as is: removing it would add a tap every turn. Worth asking the owner. |
| T11 | polish (not changed) | Pattern lines are 35–38 px tall. | measured | Deliberate: these are board objects, each row is one full-width target with no gaps (ch. 01 §2.1), and taps were reliable in every walk. |

## 2. The Loom

Walked: drafting by tap in threading, tie-up, treadling and lift plan; dyeing chips by tap and by drag;
vertical and horizontal swipes on the grid and on the chip rows; pinch; Zoom; select range; presets; the
library (save, open, remove); WIF export (download) and import (good file and junk); Match the cloth
(hints, solving by tapping the treadling, Next); weave mode (treadles, shuttle animation, Undo pick, rapid
taps); reload; reduced motion. Also the new Tartan macro (section 4).

| # | Sev | Finding | Evidence | Done |
|---|---|---|---|---|
| L1 | **major** | In *Match the cloth*, the result of every draft tap (her cloth, the match %, "It matches!") is in the puzzle card, about 1,100 px above the draft. She solved the puzzle with no visible response; the celebration and **Next puzzle** were off-screen. In the studio, the cloth preview is likewise far above the draft. | scripted `l3`: the solved panel was off-screen when the solving tap landed | Fixed: a slim **peek bar** at the top of the screen appears whenever the draft is in view and the cloth isn't. In a puzzle it shows the order beside her cloth (with matching cells glowing) and the %; on a match it turns gold with **Next puzzle**. In the studio it shows her cloth; tapping it scrolls to the full view. Verified: the bar read "It matches!" on the 16th treadling tap, and Next opened puzzle 2. |
| L2 | **major** (scroll vs tap) | A vertical swipe that started on the warp colour-chip row **dyed** threads instead of scrolling (the strips used `touch-action:none` and painted from the first touch). | scripted `l2`: "dyed? true" | Fixed: direction lock. A tap dyes one chip; a drag *along* the chips dyes each one it passes (one undo); a drag *across* them scrolls the draft and then the page. Verified both ways. |
| L3 | **major** (scroll trap) | `overscroll-behavior: contain` on the 62vh draft box: once the draft reached its end, a swipe on it would not scroll the page. Only a 12 px gutter could. | scripted: page didn't move | Fixed: vertical scrolling now passes on to the page. Horizontal is still contained, because without that a sideways swipe at the draft's edge triggered the browser's **Back** (seen in the walk: the page went to `about:blank`). |
| L4 | **major** | The draft opened scrolled to the far left, so the tie-up, the treadling, end 1 and the weft chips (the right side, where a weaver starts reading) were off-screen, with no cue that they existed. | scripted: scrollLeft 0 of 880 | Fixed: the draft opens right-aligned (and re-aligns after a preset, library open, WIF import, puzzle or tartan). The caption adds "Swipe the draft to see all of it; pinch or use Zoom to resize." |
| L5 | **major** | Select range: the instructions and the Repeat/Mirror/Shift buttons were above the draft, off-screen while she tapped ends. A tie-up tap in select mode did nothing, silently. | scripted | Fixed: in select mode the range tools **dock at the bottom of the screen** (like the weave bar): status line plus Done, one row of tools, and a "What these do" disclosure. A tie-up tap now explains itself. A first try (a sticky bar at the top) covered the threading, so it was replaced. |
| L6 | minor | Pinch on the draft did nothing (`touch-action: pan-x pan-y`); zoom was only the ± stepper. | scripted | Added: two-finger pinch zooms the draft (16–44 px cells), keeping the right edge anchored. Taps that are part of a pinch are ignored. The stepper also keeps the right edge. |
| L7 | minor | **Undo pick** in weave mode used the general history, so with no picks thrown it undid her *draft edits*. | code | Fixed: it only undoes picks thrown at the loom this sitting. The bar shows "Pick N". |
| L8 | minor | Library **Remove** deleted a saved draft at once (no undo). | read | Fixed: two-tap confirm ("Tap again to remove"). Verified. |
| L9 | minor | Hints changed the draft below with no word about it. A first puzzle had no "what do I do" line. | read | Puzzle card: "Set the threading, tie-up and treadling in the draft below; your cloth follows." After a hint: "The tie-up is filled in for you in the draft below." |
| L10 | minor | Dye swatches were 40 px. | measured | 44 px. |
| L11 | minor (risk) | Large drafts made canvases bigger than a phone allows (a 120-end draft at DPR 2 ≈ 51 M px; iOS stops drawing above ~16.7 M). | measured | `fit()` lowers the pixel density to stay under 16 M px. Verified: a 136-end tartan draft was 15.99 M px. |
| L12 | minor | The shuttle animation's rAF had no guard: an exception would leave `anim.active` stuck. | code | Clamped `t` and wrapped the draw; on error the pick finishes instantly. |
| L13 | polish (not changed) | The cloth card (up to 380 px) sits above the draft, so a long scroll separates them. | read | The peek bar covers the feedback need. A re-layout (cloth beside or under the draft) is a bigger design question. |
| L14 | polish (not changed) | "Puzzles" and "All puzzles" appear together on a solved puzzle. | shot | Harmless; left. |

Weave mode fits at 360×740 (the cloth ends at 566, the bar starts at 592) and at 390×844.
Rapid treadle taps queue correctly (5 taps gave 5 picks). Reload keeps the draft. WIF export downloads
a `.wif` file, and junk text gets a gentle message.

## 3. Marbling and origami

Walked: drops (tap, press-and-hold), stylus, comb top→bottom, left→right, diagonal and bottom→top, swirl
(hold), Undo, Clear (with undo), all four starters (watched, skipped, interrupted), Lay the paper, the
drawer. Fold: picker, Cup (easy), Swan (medium), Crane (patient, 24 steps), folding by tapping the paper,
by the button and by dragging; press-and-hold on the pull-open steps; Unfold a step; finishing; the shelf;
Take it down; switching tabs mid-fold; reload; reduced motion.

| # | Sev | Finding | Evidence | Done |
|---|---|---|---|---|
| M1 | **blocker** (lock risk) | The single rAF loop (`frame`) re-scheduled itself at the *end*: any exception in a starter, fold or paint stopped all animation, left `busy` true for good, and froze the bath and the fold. `layPaper`'s tick had the same shape. | code | Fixed: the next frame is requested first and the body is in `try/catch`. On error the starter stops, the fold's anim/hold/drag clear and the pointer is released. The lay-paper tick clears `busy` and the fly canvas on error. |
| M2 | **major** | Starters are tapped from below the tray, and the animation ran in the bath **off-screen** (at 360×740 only 40 px of the bath was visible). | scripted: bath bottom at 40 px | Fixed: starting a starter scrolls the tray into view. Verified (tray top 15 px). |
| M3 | **major** (locked for seconds) | During a starter, Undo, Clear, Lay the paper and the other starters were **silently ignored**. Bouquet ran 21 s, and "tap to skip ahead" still took 18 s. | measured `m3` | Fixed: **Undo** stops the starter and brings back the bath from before it. Clear, Lay the paper (lays what is there) and another starter all take over. The note says "Tap the bath to skip ahead, or Undo to stop." The starter paths are resampled at the engine's own sub-step (0.9·c) instead of every 10 units, which was duplicate work: Bouquet now takes 10.8 s, skip 6.2 s, Nonpareil 6.1 s, skip 2.5 s, all headless. |
| M4 | **major**, *needs device* | On a busy bath (≈48k vertices after 2–3 comb passes) frames took 200–300 ms, so the comb trailed far behind the finger. Profiling: the JS ink work is small (≤ 25 ms a frame); most of the time is canvas fill rasterisation, which headless Chromium does in software. | measured `m4`, `m5`, `m6`, `m7` | Mitigated: (a) ink work has a 12 ms budget per frame, so the comb overlay follows the finger and the ink catches up (also after lift-off) instead of stalling. (b) While ink moves, a busy bath is painted with every 2nd/3rd vertex and no edge stroke; at rest, and in every captured sheet, it is painted in full. Headless worst frames went from 250–300 ms to 120–220 ms (software raster). A phone's GPU should do much better, but **check on both phones**; if it still lags, lowering `LIMITS.maxVerts` (48k → 24k halves the work) is the next lever, at some cost to fine detail. |
| M5 | **major** | At 360×740, **Lay the paper** (and Undo/Clear) was below the fold. The ink palette wrapped into 3 ragged rows (3+3+2). | shot `marb-02-full-360` | Fixed: the palette is one row of 8 touching cells (the whole row is the target), and the order is now bath → inks → tools → **Undo / Clear / Lay** → comb spacing → tip. At 360×740 the action row now sits at 653–697 (visible on first open). |
| M6 | **major** | A reload lost the ink on the bath, and lost her place in a fold (it also dropped her back on the Marble tab). | scripted | Fixed: the bath is saved (debounced after each stroke, on starter end, on undo and clear, on `pagehide` and when hidden) as rounded JSON under its own key, so a quota failure can't touch the sheets. The tab and fold position (model, sheet, step) are saved too. Verified: 460 vertices came back after reload, and Cup came back at step 3 of 6 on the Fold tab. New pure `serializeBath`/`deserializeBath` with tests. |
| M7 | **major** (destructive) | **Take it down** (shelf) and **Let this sheet go** (drawer) deleted at once with no undo, and a shelf piece is something she made. | read | Fixed: second-tap confirm ("Tap again to take it down" / "…to let it go"), which resets after 3 s. Verified (shelf 1, then 1, then 0). |
| M8 | minor | When a fold finished, the name card's **Put it on the shelf / Fold another** sat partly below the fold (686–820 at 740). | scripted | Fixed: the card scrolls into view when it appears. Verified: button at 670–714 of 740. |
| M9 | minor | After laying the paper, the sheet flies to the drawer, which is often below the screen, and the note just said "resting in the drawer". | scripted | The note now says "…in the drawer, further down." when the drawer is off-screen. |
| M10 | polish (not changed) | The fold stage: the step text and **Fold it** fit at 360×740 (button 667–715), but with little to spare. | scripted | Left; fine on both sizes. |
| M11 | polish (not changed) | "Choose another" leaves a fold in progress without asking. | read | Folding replays quickly and the shelf keeps finished work; left. |

Fold flows completed for all three difficulties by tap, button, drag and hold. Pull-open steps respond to
press-and-hold, the helping-hand nudge appears after idling (not with reduced motion), and **Unfold a step**
works mid-model and from the finished state. Tab switches mid-fold keep the fold.

## 4. Added on request: the Tartan macro (Loom)

A **Tartan** button in the draft card opens a sheet:
- **Library** (`proto/loom/tartan.js`, `TARTANS`): Royal Stewart, Black Watch (Government), Dress Stewart,
  MacLeod of Lewis, Buchanan, Wallace, Rob Roy, plus a generic gingham and a tattersall (labelled as not
  tartans, for contrast). Setts are from tartandictionary.org, which compiles the Scottish Register of
  Tartans, House of Tartan, Weddslist and STA records. Where the source states a full-sett total (Royal Stewart
  212, Dress Stewart 244, MacLeod of Lewis 102, Buchanan 472, Wallace 136, Rob Roy 16), a test checks the
  expansion against it. **Gordon and Campbell are left out**: the records disagree on which sett is the clan
  sett, so none was invented.
- **Write a sett**: standard notation (`K4 R24 K24 Y4`, `R/8 G24 K/4`). A slash marks a pivot, and pivots are
  woven once, not doubled. **Mirror at pivots / Repeat as written** toggles symmetric and asymmetric (it
  defaults from the slashes). Letters: R G B K W Y N Az P O T and the D/L shades (DB, LB, DG, LG, DR, LR, DN,
  LN, LY, DY), case-insensitive. An unknown letter is shown in grey with a gentle note, and junk tokens are skipped
  with a note.
- **Legend**: one chip per letter. Tap it to dye that letter with any of her dyes, or go back to the tartan colour.
- **Scale**: Full sett / Half / Quarter. A scale wider than the loom (200 ends) is disabled, with the count in its
  title. The default is the largest scale that fits two repeats into about 120 threads.
- **Weave this tartan**: the same sequence in warp and weft, a 4-shaft straight draw, the 2/2 twill tie-up and
  treadling 1-2-3-4, sized to whole repeats; the draft zooms out, and the page scrolls to the cloth.
  **One Undo** restores the previous draft (verified).

## 5. Not fixed, and why

- **T10** Ida's automatic turn after 2.3 s (ends the Undo window): it's a design choice, and removing it costs
  a tap every turn. Raised for the owner.
- **M4** comb lag on a very busy bath: mitigated and measured in headless only; needs both phones.
  The next step if needed is a lower vertex cap.
- **L13** the cloth sits far above the draft: covered by the peek bar; a re-layout is a design decision.
- No physical-device or human checks were done: iOS Safari edge-swipe-back, real haptics, and real frame rates
  are all still *unknown*.

## 6. Tests

`npm test`: 468 pass, 0 fail (≈19 s wall in all; the three files here run in 0.2 / 0.4 / 0.7 s).
New: `test/marbling.test.js` covers bath save/restore round-trip and junk handling. `test/loom-draft.test.js`
covers tartan pivot expansion (pivots not doubled), asymmetric repeat, unknown letters and junk, library totals
against their sources, warp = weft sequence, 2/2 twill floats, whole repeats and the too-wide refusal.
