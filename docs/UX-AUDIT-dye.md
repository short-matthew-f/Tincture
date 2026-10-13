# UX audit: Dye Studio prototype (`proto/dye/`)

Audit and fix pass, 2026-10-13. Player: an experienced knitter and weaver, playing on her phone
(one iPhone and one Android in the house).

**Sources.** Handbook chapters 01, 03, 06, 08 and 09, and `docs/UX-GUIDELINES-REVIEW.md` for how
this project applies them (44 pt for ordinary controls, one strongest action, teach by doing,
name the evidence).

**Evidence** (handbook ch. 08 §2.1). Everything below is **scripted interaction** in Chromium
with real touch input. Taps, holds and drags went through CDP `Input.dispatchTouchEvent`, never
`page.click`, with `isMobile`, `hasTouch` and DPR 2, at 390x844 and 360x740. It also covers
landscape (740x360, 844x390), a rotation back to portrait, and one run with
`prefers-reduced-motion: reduce`. Nothing was checked on a physical phone or watched with a
person. Fonts were blocked in the sandbox, so the serif is a fallback.

Screenshots are in `scratchpad/ux-dye/`, which here means
`/tmp/claude-0/-home-user/6cd292cd-7401-56f1-9a7c-dd3a852f13c1/scratchpad/ux-dye/`. A
`before-*` shot was taken before the fixes and an `after-*` shot after them. The walk scripts are
in `scratchpad/walk/` (`w1` first open, `w2` batik, `w3` every technique, `w4` keep, stash,
surprise, switching, reload and rotate, `w5` reduced motion, `w6` exceptions and reloads, `w7`
edge cases, `land` landscape).

**Flows walked.**
- First open.
- Every technique, start to finish:
  - solid;
  - ombré, with a stepped second dip;
  - batik: tjanting, tjap, "Stamp all over", crackle and boil;
  - shibori: itajime, arashi, kumo and mokume;
  - tie-dye, ice, marbling and block print.
- Changing the cloth mid-piece.
- Undo and Start over.
- Keep, including keeping twice.
- The stash drawer: rename, remove, and bringing a piece back.
- Surprise me, from the chip and from the bottom card, plus skipping it and tapping other things during it.
- Switching technique while bound.
- Loupe ("Closer").
- Reload mid-piece: batik, bound shibori, marbling with ink still floating.
- Landscape, then rotating back.

---

## Blocker

1. **The "Surprise me" button on the bottom card did nothing.** `#surpriseBtn` in `index.html`
   had no listener. Only the chip at the top worked. This is a visible button on the "Not sure
   where to start?" card, which is exactly where a hesitant first-timer taps.
   Evidence: the walk logged `bottom surprise started? false`. In `before-02-scrolled-bottom-360.png`
   the button is on screen.
   **Fixed.** The button is wired to `surprise()`. Both the button and the chip read "Skip to the
   end" while a demo runs.

## Major

2. **"Closer" was a hidden sticky mode, so taps meant different things.** After tapping Closer,
   every touch on the cloth showed the loupe instead of drawing wax, setting the ombré line or
   stamping. This lasted until she found the button again, and it carried across technique
   switches. Nothing on the cloth showed that the mode was on. This is the likely "hidden mode
   that made taps behave inconsistently". Evidence: `wax after loupe drag? … loupe still on true`,
   and a second drag still made no wax.
   **Fixed.**
   - Closer is now one look: lift the finger and it switches off.
   - Changing technique turns it off.
   - The stage tag reads "Touch the cloth to look closer" while it is armed.
   - On a bundle or the marbling bath, it says "Open it up first, then look closer" and does not
     arm.

   Verified: the second drag draws wax.

3. **Marbling silently swapped the cloth for an empty bath.** After "Lay the cloth", picking any
   ink pot (or a tool) turned the stage back into a blank bath. Her marbled cloth vanished
   without a word. Tapping the cloth only said "Follow the steps below", "Lay the cloth" stayed
   the dark primary on an empty bath, and the tag still named the cloth while the bath was
   showing. Evidence: `before-61-marble-laid-390.png`, then `before-62-marble-pick-after-lay-390.png`.
   **Fixed.**
   - Only "Float more colors" opens the bath.
   - A tap on the laid cloth says "Tap “Float more colors” below for another layer".
   - "Lay the cloth" is dark only when there is ink on the bath.
   - The tag reads "Marbling bath" on the bath.
   - Keep with ink still floating lays the cloth first.

   Verified: `after-61/62`, `after-64-marble-keep-autolay.png`.

4. **Holding "Hold to dip" while scrolled down to the steps dipped a cloth she could not see.**
   The dock is fixed, so the hold button is always reachable. With the panel scrolled to step 3,
   the stage was at y -641…-305. Evidence: `before-15-dip-while-scrolled.png`.
   **Fixed.** `showStage()` scrolls the cloth into view when a dip starts. This is smooth, or
   instant with reduced motion. Verified: stage at 8…344 (`after-15-dip-while-scrolled.png`).

5. **Undo was slow: about 1.4 s on a laptop, several seconds on a phone.** Undo replayed every op
   from a blank cloth, and a crackle in the history alone took 1.27 s. Evidence: `undo ms 1444`
   in the walk; the perf probe showed `crackle: 1271`.
   **Fixed.**
   - The piece is checkpointed before each of the last 6 ops (`clonePiece` in `dyecore.js`), so
     Undo restores a checkpoint.
   - `R.crackle` caches its Worley cell points. The output is identical (checked by hash) and it
     runs 2.6x faster.
   - `dyecore.js` memoises the last 3 crackle maps.

   Verified: undo takes 14 ms, and three more undos take 34 ms.

6. **Crumple froze the page.** The 1.3 s synchronous crackle ran after the animation, with no
   feedback. **Fixed** by the same speed-up as finding 5 (about 290 ms in node).

7. **A reload lost the piece in progress.** Only the technique and the cloth were remembered. An
   iOS tab eviction or an accidental pull-to-refresh threw her work away. Evidence: `reload: ops
   before bind,unbind,wax after ''`.
   **Fixed.**
   - The ops, seed, cloth, technique and marbling bath are saved to `sessionStorage`. That has
     its own quota, so it cannot crowd the shared stash out of `localStorage`.
   - Saving uses `packOps` / `unpackOps`. Wax paths are rounded to 1/10000 of the cloth.
   - A marbling op keeps the bath it was printed from, plus its seed and cloth, and the delta is
     rebuilt on load.
   - She is greeted with "Here is the piece you were making".

   Verified for batik, bound shibori (the bundle is still bound) and marbling (the print and the
   floating ink both come back): `after-32-shibori-reloaded-bound.png`, `after-63-marble-reloaded.png`.

8. **Start over and Surprise me threw away unkept work, and there was no way back.** Evidence:
   the walk logged `ops before wax,dip now wax,wax`, meaning the demo replaced her piece.
   **Fixed.**
   - Unkept work is set aside.
   - After Start over, Undo brings it back ("A fresh piece. Undo brings the last one back").
   - After a demo, a "← Back to my piece" button sits on the cloth while the new piece is
     untouched, and the demo ends with "Like it? Keep it, or tap “Back to my piece”".
   - Kept pieces are never set aside, because they are already safe.

   Verified: `back to my piece ops wax,dip,wax`.

9. **Reduced motion took away the core mechanic.** With `prefers-reduced-motion`, the dip used a
   fixed 1.5 s soak, so a 250 ms hold and a 2.5 s hold dyed identically. Marbling drops were all
   one size. Evidence: `[0.944, 0.944]`, drop areas `[20103, 20103]`.
   **Fixed.** How long she holds always sets the depth. Only the liquid's wave animation is
   frozen. Verified: `[0.46, 1.137]`, drops `[13080, 73700]`.

10. **There was no "you are here" in the steps, so the next round was easy to miss.** The batik
    panel is six numbered paragraphs, and "Wax more, dye darker / Repeat 2 and 3" is plain text.
    Nothing showed which step comes next, and "Boil it off" was a dark primary from the very
    first second.
    **Fixed.**
    - A pure `nextSteps(tech, ops, st)` in `dyecore.js` drives the markers.
    - The next step gets a gold number and a "Next" tag.
    - Alternatives get "or this". In batik, after the first dip, Boil is Next and step 4 "Wax
      more, dye darker" and step 5 Crackle get "or this".
    - Optional extras get "if you like".
    - A step's main button (Boil, Bind, Open, Tie, Rinse, Lay…) is dark only while it is Next.
    - "Keep it" gets a gold ring when the piece is finished.

    Verified: `after-02-scrolled-bottom-360.png`, `after-88-landscape-scrolled-dip-740.png`, and
    the `steps 1 2 3* 4 5 6` log line.

11. **Any `S.busy = true` path that threw stayed locked.** `endDip` ran from `pointerup`, outside
    `action()`'s catch. `setTech` and `keep` awaited `melt` and `unbindWithReveal` unguarded.
    `stampAllOver` and `tjapAllOver` were the same. A throw in the dip's requestAnimationFrame
    loop left the cloth "in the pot" for good.
    **Fixed.**
    - Every busy path now goes through `withBusy()`: `endDip`, `unbindWithReveal`, `melt`,
      `layCloth`, `stampAllOver`, `tjapAllOver`, `bindShibori`, `tieUp`, `crumpleFx` and
      `boilFx`. It is a `try/finally` that restores the flag and clears the overlay, reveal and
      display state. Nested demo calls keep the outer flag.
    - The dip loop is wrapped (`loopSafe`) and ends the dip if a frame throws.
    - Any `pointerup` or `pointercancel` anywhere, `lostpointercapture`, or the page hiding ends
      a dip or drag.
    - The demo's `finally` resets everything.

    Verified by injecting a throw: boil with a broken weave field gives `busy: false`, a dip
    frame throwing gives `busy: false`, and the studio keeps working after both.

12. **Ordinary controls were 36 px tall.** This covered Undo, Start over, Closer, Keep it, Your
    stash, Done, Save name, Remove, Close, Turn, and the marbling starter and skim buttons. The
    cause is `.btn.small` in `shared.css`. Evidence: the w1 tap audit listed five such controls on
    first open.
    **Fixed** in `proto/dye/index.html` (`.wrap .btn.small, #sheet .btn.small { min-height: 44px }`).
    The tap audit now reports nothing under 44 px at 360 and 390, in the sheet too.

13. **Stage messages were cut off.** The say pill was `nowrap` with an ellipsis, so "Lifted! The
    bath is skimmed clean for an…" lost its second half, and at 360 so did "Like it? Tap Keep it
    to add it to your stash". Evidence: `before-61-marble-laid-390.png` and the truncation probe.
    **Fixed.** The pill wraps, centered, at 14 px. Probe: nothing truncated.

14. **On first open, nothing said which technique she was in.** The default chip (Batik) sat off
    the right edge of the chip row at 360 and 390. Evidence: `before-01-first-open-360.png`.
    **Fixed.**
    - The active chip is scrolled into view with the smallest possible scroll, so "Surprise me"
      still peeks in on the left.
    - The row stays still during a demo. It used to scroll "Skip to the end" out from under her
      finger.

    Verified: `after-01-first-open-360.png`.

15. **Landscape: the dock covered the cloth and Keep it.** At 740x360 the stage ran 57…287 under
    a dock starting at 209, and Keep it (266…302) sat behind the dock.
    **Fixed.** On short landscape screens the layout goes to two columns: the cloth is sticky on
    the left, sized to fit above the dock, and the chips, bar and steps scroll on the right. The
    dock is compact (pot names hidden; the chosen dye's name still shows in the dock label).
    Verified: `after-87-landscape-top-740.png` and `after-88-landscape-scrolled-dip-740.png`. The
    cloth stays visible while dipping from the scrolled steps. The canvas resizes back to the
    stage when the phone turns upright.

16. **Removing a fabric from the stash was instant and permanent.**
    **Fixed.** The sheet shows "‹name› put away. [Bring it back]". Verified (`after-83-stash-removed-360.png`).

## Minor

17. **Tie-dye, ice and marbling made the wrong button the dark primary.** "Rinse and open", "Let
    it melt" and "Lay the cloth" were primary before any dye or ink was on, so the dock pointed
    her at a step that did nothing. Evidence: `before-41`, and `before-40-tiedye-tied-390.png`
    for the moment just after tying.
    **Fixed.** Each is secondary until there is something to rinse, melt or lay (`after-40-tiedye-tied-390.png`).

18. **"Follow the steps below" when a tap does nothing.** **Fixed.** Each technique now says what
    will work: "Tie it first (step 2), then squirt dye on the bundle", "Scrunch it and pile on ice
    first (step 2)", "Bind it first for a pattern, or hold to dip for a plain color", and so on.
    Guards that used to read like errors are reworded as guidance:
    - "No wax on the cloth right now" became "The cloth is wax-free already: keep it, or draw more wax".
    - "Crackle needs wax on the cloth first" became "Draw some wax on the cloth first, then crumple it".

19. **Keep it: duplicates, and what happens next.** Tapping Keep twice made "Indigo batik" and
    "Indigo batik no. 2". Keep on a blank cloth stored an undyed square. The toast (seen mid-fix) sat over Start
    over and Closer at 360 (`before-80`, then `after-80` mid-fix).
    **Fixed.**
    - After keeping, the button reads "Kept ✓".
    - A second tap says "This one is in your stash already. Change it to keep another".
    - The confirmation ("In your stash: ‹name›") is said on the cloth.
    - An "In your stash →" button on the cloth opens the drawer on that fabric.
    - A blank cloth gets "Put some color on it first, then keep it".
    - If `stash.js` drops a piece at its 60-piece cap, she is told.

    Verified: `after-80-kept-360.png`.

20. **The Quilt Designer link sat below every dyed swatch.** With a dozen pieces it was off the
    sheet. **Fixed.** It is now right under the stash summary (`after-83`).

21. **Taps during a demo were silently ignored.** **Fixed.** They say "Tap “Skip to the end” to take over".

22. **Renaming:** Enter in the name field now saves (`enterkeyhint="done"`). The sheet moves focus
    to Done when it opens and returns focus when it closes.

23. **Small text:** pot labels went from 11 to 12 px. The 12 px tag and step numbers stay; they
    are labels, not reading text.

24. **iOS long-press callout:** `-webkit-touch-callout: none` is now on the hold button and the
    stage, so a long hold can't pop the iOS menu.

## Polish (not changed)

- The dye-pot row scrolls sideways with its scrollbar hidden. At 360 px, Logwood and later pots
  are cut off at the edge. The partial pot hints that the row scrolls, but a fade would say it
  more clearly.
- `touch-action: none` on the cloth means a scroll can't start on it. It has to, for drawing.
  There is plenty of page outside the cloth to scroll from.
- Shibori names (itajime, arashi, kumo, mokume) appear on the picks without a gloss until one is
  chosen. Each choice then shows a one-line note. For an experienced fiber artist this reads as
  vocabulary, not jargon.
- Hold-to-dip has no tap-to-start / tap-to-stop alternative (ch. 09 §4). The keyboard (Space or
  Enter) holds, and a quick tap gives a light dip, which Undo can take back.
- There are no sound or haptics (ch. 06 §16).

## Checked and fine

- **Hold-to-dip responds at once.** The fill is about 27% after 120 ms and the liquid rises
  within 260 ms.
- **Every technique runs start to finish with touch input**, with no console errors and no
  horizontal overflow at 360 or 390 (`after-20`…`after-70`).
- **Changing the cloth mid-piece** replays the piece on the new cloth ("Your piece, on linen").
- **Switching technique while bound** opens the bundle first, then switches.
- **Busy actions bring the cloth into view first.** `action()` scrolls the cloth up (today's
  fix), and the bind and open steps are verified to show 100% of the cloth.

## Changes and tests

- `proto/dye/app.js`: findings 1–24.
- `proto/dye/index.html`: 44 px controls, wrapping say pill, step markers, stage buttons, compact
  landscape layout, touch callout.
- `proto/dye/dyecore.js`: `clonePiece`, `packOps` / `unpackOps`, `nextSteps`, and the crackle
  memo.
- `proto/dye/resist.js`: crackle cell-point cache (identical output).
- `test/dye.test.js`: 5 new tests.
  - A clone is isolated, and continuing from it equals a replay.
  - A bound clone keeps its own section colors.
  - Ops round-trip through JSON (marble delta dropped and rebuilt, wax rounding doesn't move the
    wax).
  - Crackle is deterministic.
  - `nextSteps` walks every technique.

  The dye tests are 27 of 27 and take about 0.8 s. `npm test`: 458 of 458 passing.

## For the owners of shared files (not edited)

- `proto/fabric/stash.js` `addFabric` silently drops the oldest dyed fabric beyond
  `STASH_MAX` (60). `write()` silently drops dyed fabrics one by one when `localStorage` is
  full, and returns `false` without telling the caller. Neither app can tell her a piece was
  lost. The Dye Studio now checks after keeping and says so, but the Quilt Designer may not.
  Suggestion: return what was dropped.
- `ensureStarters()` re-adds the whole starter bundle whenever no starter is left. If she hides
  every starter, they all come back on the next load, while hiding some keeps them hidden.
- `proto/shared.css` `.btn.small { min-height: 36px }` is below the 44 pt rule for ordinary
  controls in every prototype that uses it. The Dye Studio overrides it locally.
