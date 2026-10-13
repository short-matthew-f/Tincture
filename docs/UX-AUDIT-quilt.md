# UX audit: Quilt Designer prototype (`proto/quilt/`)

Written 2026-10-13. The player is an experienced fiber artist who plays on her phone
(one iPhone and one Android in the household). Handbook chapters 01, 03, 06, 08 and 09
plus `docs/UX-GUIDELINES-REVIEW.md` were the yardstick.

**How it was tested.** Playwright drove Chromium with real touch input: CDP
`Input.dispatchTouchEvent` for taps, drags, flicks and two-finger pinches. Runs used
390×844 and 360×740 viewports at DPR 2 with `isMobile` and `hasTouch`, and one run used
`prefers-reduced-motion: reduce`. Scripts and screenshots are in
`scratchpad/ux-quilt/` (`w1`…`w11`). **Evidence labels** (ch. 08 §2.1): *touch* means it
was driven with touch events and measured; *shot* means it was seen in a screenshot;
*code* means it was read in the source. Nobody has tried any of this on a physical phone.
iOS-specific behaviour (double-tap zoom, the share sheet, canvas limits) is reasoned from
the platform docs and has not been observed.

Times come from headless Chromium with software rendering, so a phone GPU will be
faster. The *ratios* between before and after are the trustworthy part.

---

## Blockers

### B1. A large quilt froze the page for seconds per tap, and up to a minute at boot (fixed)
*touch.* The test quilt was 12×14 Bear's Paw blocks (180×208") with stipple quilting.
- Setting it up took **51 s** of main-thread work at the densest stipple and 4.4 s at the default.
- Each fabric tap on the block then cost **4.8 s**, and a sideways paint stroke cost 10 s.
- A pinch re-rendered the whole quilt every time the zoom crossed 15%, which repeated the multi-second freeze over and over.
- A saved quilt like this froze the page on reload before anything was visible. To her, the screen looked locked.

The cause was that every change rebuilt the quilting: 5.9 M points at 0.5" stipple, stroked five times on a canvas up to 4096 px.

**Fix.**
- The quilting now has its own layer, keyed only by what moves the stitches: the pattern, density, border design, quilt size, and the piecing geometry for ditch, echo, curves and square-in-square. Sewing a fabric never redraws the stitches.
- Stitches are drawn just after the patchwork frame, so a tap shows at once.
- High-resolution re-renders wait until a pinch settles.
- There is a stitch budget (`MAX_MEANDER_CELLS`, `MAX_FANS`, `MAX_POINTS` in `quilting.js`). On huge quilts it loosens the preview and says so in the panel.
- Dense quilting gets a single shadow pass.
- Paths are stroked in batches of 2,500 points. One path holding thousands of small closed shapes was 20× slower: continuous curves went from 1.6 s to 84 ms.
- The offscreen canvas is capped at 3072 px, which keeps it under iOS canvas limits.

**After:** stitch layer 60–100 ms for any pattern, fabric tap about 210 ms, stepper about 300 ms, no long task during a pinch, and export 1.3 s behind a "Making the picture…" state. Tests: "quilting stays quick on a huge quilt", and the budget assertions in "more quilting designs".

### B2. A damaged save left the page dead (fixed)
*touch.* A saved block with a malformed unit made `boot()` throw before `data-ready`, so nothing on the page worked.

**Fix.**
- `sanitizeBlock()` checks every unit: it must be on the grid, have a known shape, have one fill per patch, not overlap another, and cover the grid. `normalizeDesign()` now validates every field.
- `loadStore()` refuses a design that won't lay out or cut, keeps a copy under `tincture.proto.quilt.rescued`, opens the sample and tells her in a toast.
- `boot()`, each panel render, the rAF draw, the stitch pass, export and undo each recover from their own failure.
- `commit()` refuses a change that would not lay out and leaves the quilt as it was.

Verified with four corrupt saves (`w7`). Test: "damaged saves".

## Majors

### M1. The quilt was off screen whenever a control changed it (fixed)
*touch + shot.* The quilt sits at the top and every control is 600–1,500 px below it, so the quilt was 0% visible after tapping Mirror → Both or + columns (`w3`). Step 2 of the hint ("mirror every other block: new shapes appear…") was therefore impossible to see. The same was true of every block edit.

**Fix.** When less than 35% of the quilt is visible, a **docked live preview** sits at the bottom of the screen. It shows the quilt about 110–124 px tall with size, a short summary and **Undo**, and it flashes gold briefly after each change (no flash with reduced motion). Tapping it returns to the quilt and the tabs. The page also gets `scroll-padding` and bottom padding so the dock never hides the end of a panel, and toasts sit above it. The hint now mentions it. Shot: `w3-b-mirror.png`, `w2-a-join1.png`.

### M2. Scrolling over the block editor painted fabric (fixed)
*touch.* At 390 px the block is 342 px wide and had `touch-action: none`. A swipe to scroll the page didn't scroll; it painted the swiped patches instead (`scroll attempt … design changed? true`). Shape, Turn and Join also fired on finger-down.

**Fix.**
- Every tool now acts on a **tap**: finger up within 10 px of where it went down.
- Fabric also paints along a **sideways** drag, as one undo step.
- A vertical swipe scrolls the page and changes nothing.
- Only Fussy cut holds the page still. Its hint says so.
- Finger-down outlines the patch at once, as acknowledgement.

After: `scrollY 743 → 956, design changed? false`.

### M3. Two quick scroll flicks over the quilt zoomed it, then trapped the scroll (fixed)
*touch.* Double-tap was detected on `pointerdown` timestamps, so two quick flicks to scroll counted as a double tap and zoomed to 2.5×. When zoomed, the quilt takes the gesture (`touch-action: none`), so the page then stopped scrolling under her thumb.

**Fix.**
- A double tap now has to be two real taps: short, under 10 px of travel, at most 40 px apart. A gesture the browser cancels never counts.
- While zoomed, the hint changes to "Drag to look around. Fit shows the whole quilt."
- Zooming in from Stand back switches to Up close.

After: two flicks → `z: 1`.

### M4. Undo was only on the Block tab (fixed)
*code.* Changes made in Layout, Fabrics, Quilting and Saved told her "Undo on the Block tab", which meant scrolling up and changing tabs to recover.

**Fix.**
- Undo is in the dock, so it is always reachable while she works below the quilt.
- Messages now just say "Undo brings it back".
- Undo history (40 steps) and the open tab now survive a reload, which iOS does to background tabs.

### M5. Removing a saved quilt was permanent (fixed)
*touch.* One tap on "Remove" deleted it, with no confirmation and no undo.

**Fix.** The panel now keeps a "“Name” is out of My quilts. **Put it back**" note until she leaves the tab or saves. Verified remove → put back (`w6`). Saving under an existing name now says "Updated … in My quilts", plus a one-line hint.

### M6. Hidden mode: editing a block the quilt doesn't show (fixed)
*code.* Opening Block 2 from Layout and then setting "Every other block" back to Same block hid the Block 1/2 switch but left the editor on Block 2. Every edit then went to an invisible block.

**Fix.** The editor returns to Block 1 whenever the quilt has no second block.

### M7. Export: no feedback, repeatable, wrong place on iPhone (fixed)
*touch + code.* Export was a synchronous render with no busy state, so a second tap exported twice. On an iPhone the `<a download>` route saves to Files, not Photos.

**Fix.**
- The button shows "Making the picture…" and ignores taps while busy.
- Rendering waits a frame so that label paints first, and every path resets the busy state.
- The share sheet (`navigator.share` with files) is used where the browser offers it, so "Save Image" goes to Photos. Otherwise, or if sharing isn't allowed, it falls back to a download.
- The temporary canvas is released afterwards.
- The button is now labelled "Save a picture".

The iOS share sheet has not been observed; it needs testing on a phone.

## Minors

| # | Finding | Evidence | What I did |
|---|---|---|---|
| m1 | The selected fabric was shown only as a ring on a color chip. Letters L/M/D/A/B without names. In Shape, Turn and Join the chip still looked selected even though taps didn't sew. | shot | A "Sewing with **Dark: Indigo**" line sits above the chips. With another tool on it reads "Join tool on. Pick a fabric to sew again." and the chip ring turns dashed and dim. |
| m2 | Stash fabrics were off-screen to the right of the chip row, with no sign they were there. | shot | Added a "stash →" cue at the right of the label. |
| m3 | Jargon with no hint: on point, sashing, cornerstones, binding, finished size. | code | Added one-line hints. HST/QST/WOF were already spelled out. The "Fussy" tool now has the accessible name "Fussy cut", and its hint explains it. |
| m4 | "Second block" was clipped at 360 px. | shot | Renamed it "Block 2", matching the editor's switch. |
| m5 | Tap targets under 44 px: Fit (42), grid sizes 2–8 (40), "16"" (43), "No" (41). | touch | Segment buttons now have a 44 px minimum. |
| m6 | iOS double-tap-zooms the page on fast repeated taps of + and − (inferred, not observed). | code | `touch-action: manipulation` on every button. |
| m7 | A fabric taken out of the stash showed as "Missing fabric" in the cutting list. | touch | It now shows "Indigo shibori (no longer in your stash)". |
| m8 | An empty stash (now possible: the shared stash no longer re-seeds starters) gave grey stand-ins with no explanation. | touch | A note appears in Block and Fabrics with "Bring back the starters" and "Dye fabrics →". Verified (`w10`). |
| m9 | The toast wrapped to about 40% of the screen width, and its duration ignored message length. | shot | It now sizes to the message (up to 420 px), and longer text stays up longer. |
| m10 | Removing a border gave no feedback. | touch | Toast: "Border 1 removed. Undo brings it back." |
| m11 | Changing density re-drew 21 quilting pictures in one 505 ms task. | touch | Pictures are cached and filled in after the panel shows, in tasks of about 40 ms. |

## Polish (not done)
- **p1.** Six tabs in two rows sit under the quilt. With the dock this is one tap plus a short scroll. A sticky single-row tab bar would be 6 × 56 px at 360 px, which is too tight without icons.
- **p2.** "Dye your own fabrics →" in the Fabrics panel is an inline 15 px text link. It is acceptable as an in-text link.
- **p3.** Section labels (`h2`) are 12 px uppercase at about 5.7:1 contrast, the shared style.
- **p4.** The value bar marks the Medium role "light value" for the default Ochre floral. That is accurate, but a quilter may want a nudge to pick a truer medium.
- **p5.** Painting down a column now scrolls instead, because of M2. Painting is by tap or a sideways stroke. This is the deliberate trade.

---

## Added in the same pass (owner's request: "even more quilting patterns")

**Quilting designs.** There are now 21 designs, up from 8, shown as pictures over four of
her own blocks at the chosen density, in three groups:
- **Follows the piecing:** in the ditch, echo, continuous curves (an arc across each patch), square in a square (nested per block).
- **Lines:** grid, crosshatch, diagonal, wavy, chevron.
- **All over, edge to edge:** meander, stipple, loop-de-loop, pebbles, swirls, clamshell, orange peel, cathedral arcs, Baptist fan, leafy vine pantograph, spiral.

Density is a five-step choice from Airy to Dense. Borders can have their own design: same,
feathers (a feathered vine), cable, lines or plain. When they do, the center design stops at
the borders. Paths are cached per pattern, size and geometry, and kept within the stitch
budget.

**Blocks.** There are 14 new library entries:
- **Blocks:** Bow Tie (a new flipped-corner unit, cut stitch-and-flip), Double Four Patch, Whirligig, Spool, Hole in the Barn Door and Monkey Wrench (both marked as Churn Dash names), Lady of the Lake, Cake Stand (basket), Pine Tree, Double Nine Patch.
- **Pieces for layouts:** the two Double Irish Chain blocks, a single HST and a plain square.

The library is grouped: Four-patch, Nine-patch, Stars, Five-patch and bigger, Strip and
log, Curves, plus **Whole-quilt layouts**:
- Barn Raising, Straight Furrows and Streak of Lightning (new rotations, also available under Layout → Turn for any block)
- Single and Double Irish Chain
- Trip Around the World / Sunshine and Shadow (a new "Rings" colorway under Fabrics)

**Skipped on purpose.** These need either geometry the editor doesn't have or a reference I
couldn't check:
- **Needs 45° diamonds or 60° geometry:** LeMoyne / Star of Virginia, Tumbling Blocks.
- **Couldn't reproduce faithfully from memory:** Duck and Ducklings, Corn and Beans, Grandmother's Choice, Weathervane, Contrary Wife, Puss in the Corner, Road to Oklahoma, Old Maid's Puzzle, Sister's Choice, Bachelor's Puzzle. A wrong traditional block is worse than a missing one.
- **"Sunshine and Shadow" as an HST setting:** the name is covered by the Trip layout.

**Tests** (`test/quilt.test.js`, 22 tests, about 2 s):
- Tiling for every block, new ones included.
- A cutting list for every block: eighth-inch sizes, every fabric cut, and exact Bow Tie cuts.
- HST settings checked by sampling fabric across shared edges.
- Ring coloring, and every layout preset laying out and cutting.
- Every quilting design drawing, staying in budget on a huge quilt, and keeping its border stitches in the border.
- The Baptist fan's faster neighbour lookup matching the original exactly.
- Damaged-save sanitizing.

## Notes for the shared files (not edited)
- `proto/shared.css` `.btn.small` is 36 px tall. The quilt overrides it to 44 px. Other prototypes that use it get 36 px tap targets.
- `proto/fabric/stash.js` changed during this pass: there is a `seeded` flag, and starters are no longer re-added. The quilt now handles an empty stash and calls `restoreStarters()` through a namespace import, so the page still loads if that export goes away.
