# UX guidelines review: the handbook vs. v0.2

Written 2026-10-05 for Matthew, to read before today's build. Documentation only:
nothing in `src/` or `docs/PLAN-v0.2.md` changed. Read alongside PLAN-v0.2.md;
the bullets in section C are written so they can be pasted into it.

**Sources.** `ux_guidelines/Mobile_Game_UX_Handbook_v1.1_Markdown/` chapters 00–06,
08, 09 in full; 07 and 10 skimmed (index plus 10 §2, §4, §12 and 07 §12).
DESIGN.md (pillars, core loop, Fun and engagement, Interaction feel, Active play,
Merge Shelf, UX, Implementation deviations), UX-AUDIT.md, INTEGRATION-NOTES.md
"Open", the six screen modules, and screenshots from the 0.1.3 walk in
`scratchpad/e2e-5/`, quoted as `[24]`, `[40]` and so on.

**Evidence labels** (ch. 08 §2.1). "code" = read in source; "shot" = seen in a
0.1.3 screenshot; "audit" = UX-AUDIT.md line; "unknown" = needs the phone or a
person. Nothing below has been checked by a human on a phone.

---

## A. What the handbook says that matters here

Only rules that change a decision in Tincture. Numbered so the table in B can
refer to them.

**Touch and layout**
1. Aim for reliable input, not a minimum target size: the board is one surface, every touch resolves to a cell, and there are no dead gaps between cells (ch. 01 §2.1, ch. 04 §2, §4).
2. "Mitigate, then validate": float the dragged object clear of the finger, preview the target, add magnet and hysteresis, then measure. Snapping alone doesn't make occlusion "solved" (ch. 01 §2.2, ch. 04 §4.1).
3. Each screen has one dominant purpose and one strongest action (ch. 01 §3, §3.1).
4. The first feedback is immediate. Animation explains state, and repeated utility flows should get faster with familiarity, not slower (ch. 01 §7, §8).
5. Ordinary controls (buttons, chips, switches, tags) still follow the 44 pt rule. Only game objects get the density exception (ch. 01 §2 table, ch. 09 §3).

**Onboarding and depth**
6. Teach in this order: see, touch, succeed, vary, combine, optimize. Teach through interaction before adding text (ch. 03 §5, ch. 01 §20).
7. Introduce one concept at a time, and never two unfamiliar things at once (ch. 03 §6, §8).
8. An unlock should answer a need the player already feels: she meets the limitation before she sees the fix (ch. 03 §7).
9. Show the cost and the result before she commits: current → next values, recognition over recall (ch. 01 §15, ch. 03 §14, ch. 05 §5–6).

**Engagement without compulsion**
10. Alternate power growth with possibility growth. Unlocks are memory landmarks, so treat them as moments, not as tags that flip (ch. 02 §4, §6).
11. Keep meaningful ritual and remove reward bureaucracy. An admin step earns its place only if it brings understanding, a choice or pleasure (ch. 02 §14, ch. 01 §17).
12. End each stopping point on one future desire, not a list of chores (ch. 02 §8, §19).
13. A long session in one subgame is valid. Cross-rewards should enrich play, not funnel her elsewhere (ch. 02 §15, ch. 06 §10).

**Puzzle, match and merge**
14. Keep spectacle readable: her action, then its consequence, then any escalation, then a settled board (ch. 04 §7).
15. Goals should be readable on the board itself. Objects that look alike should not follow different rules without a visual cue (ch. 04 §11, ch. 03 §15).
16. A combo needs its own combined payoff, not two effects firing one after the other (ch. 04 §9).
17. Merge games need a strong selected state, a pickup offset, a preview of partners, nearest-legal placement, and a clear difference between move, merge and sell (ch. 04 §16).
18. Difficulty should widen the decision space, and tiers should fit session lengths (ch. 04 §14, ch. 09 §6).

**Idle and management**
19. She should be able to see the bottleneck. Order the dashboard as output, bottleneck, affordable actions, then detail (ch. 05 §2, §3).
20. Automation should remove friction, not pleasurable ritual. Manual play stays an option (ch. 05 §7).
21. Prestige says exactly what resets and what persists. Alerts are only for things she can act on (ch. 05 §9, §11).

**Cozy and collection**
22. The world is the interface, and expansion should be visible in the space. Systems arrive through places and characters, not checklists (ch. 06 §2, §7, §11, §12).

**Evaluation**
23. Name the evidence honestly. Test dense input with perturbed touches and log source and destination errors separately before shrinking anything (ch. 08 §2.1, §7, §7.1, §7.2).

**Accessibility**
24. No critical state should depend on a single channel (colour alone, haptic alone). Offer a tap alternative to drag. Motion and haptics are separate options, and settings are reachable early (ch. 09 §2, §4, §7, §8, §10).

---

## B. Where 0.1.3 stands

| # | Principle | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Board as one surface | partly | code: `shelf.js cellAt()` uses `elementFromPoint` at the finger. The 6 px cell gaps and the ~20 px planks between rows resolve to nothing, so `onPointerUp` snaps the drop back. Grading uses one grid with `touch-action:none` |
| 2 | Mitigate, then validate | partly | code: the ghost is drawn at `y − 0.7·h`, so the finger still covers the bottom 30%, which is where the vial's colour sits. The source stays ghosted at 30% (good) and the mergeable target gets a ring (good). The target is resolved under the hidden finger, not under the visible ghost. No magnet, no hysteresis, no measurement |
| 3 | One strongest action | breaks | shot [24]: "Upgrade the shop for 46" and the dark "Collect 31K coins" are stacked as two primaries, with the Almost there card below |
| 4 | Immediate feedback; faster with familiarity | partly | code: the shelf and grading lift on pointerdown. Buttons use a CSS transform only (PLAN F). `onPointerDown` ignores all input while `ui.anim` is set, so a chain blocks the board |
| 5 | 44 pt for ordinary controls | partly | shot [11], [40]: shelf buttons and label tags are 44. shot [42]: settings switches still look about 52×32. audit Top-12 #8 |
| 6 | Teach by doing | partly | shot [02], [11]: first-order and shelf coaches are specific and complete on the action. Puzzle, map, gallery and commissions open cold (playtest note 1) |
| 7 | One concept at a time | breaks | code: `onboarding.js` runs 10 coach steps plus the naming ceremony in ten minutes (order, naming, board, upgrades, shelf, order board, Mill Room, window, door, close-up), plus Seals and quest toasts. audit "First ten minutes as a story" |
| 8 | Unlock answers a felt need | partly | shot [10]: the shelf opens at 5 colours before any vial exists (they are seeded). The muddy batch exists before Purify, which is right |
| 9 | Cost and result before commit | partly | shot [24], [34]: lock tags now speak in the "N more colors" voice (audit fix landed). code `workshop.js:596`: rows show "Level 3 · 0.08 a second" and a cost, but no after-value |
| 10 | Possibility growth, landmarks | partly | audit: naming is "the best beat". Unlocks are a tag that disappears, with no opening moment. One mixer means no new possibility for the first ~30 min (playtest note 6) |
| 11 | Ritual, not bureaucracy | partly | Collect has the coin-arc ritual (keep). INTEGRATION "Open": All caught up needs every muddy batch handled, which is bureaucracy |
| 12 | One future desire at stopping points | follows | shot [25]: the Ledger shows the All caught up stamp, two Almost there lines and Close up shop. audit [17]: the dim and shutters moment still isn't visible |
| 13 | Long single-subgame sessions valid | follows | grading free play is unlimited, and the reward-scaling floor keeps it worth doing |
| 14 | Readable spectacle | unknown | chains run at 90 ms per step (spec). The 2.2 s line sequence doesn't exist yet |
| 15 | Goals readable; look-alikes follow one rule | breaks | shot [40]: about 30 near-identical orange vials that don't pair (exact-colour rule). Six "Label" tags fill a whole column |
| 16 | Combos with their own payoff | n/a | nothing to combine today. The plan's "overlapping lines resolve one at a time" would break this |
| 17 | Merge specifics | partly | code: partner and target classes exist, plus a sell dock and a tap-tap fallback. The pickup offset is partial. No nearest-legal placement |
| 18 | Difficulty tiers fit sessions | partly | shot [30]: grading tiers have one-line hints and a reward. Purify has no tiers and a board can't be cleared (playtest note 5) |
| 19 | Visible bottleneck | follows | shot [24]: the Make / Store / Ship tiles highlight Ship, and the suggestion button names the fix |
| 20 | Automation keeps ritual | follows | the Steward and auto-pack are opt-in |
| 21 | Prestige spells out what resets; actionable alerts | partly | code: `heritage.js` lists what stays and resets. shot [40]: the toast "Pick a canvas to start painting" sits over the shelf's title, carried over from another screen |
| 22 | World as interface, spatial growth | follows | shot [24]: window, calendar, shelf, door and cart are all tappable scene objects with tags. Rooms don't visibly restore yet (unknown) |
| 23 | Honest evidence, dense-input test | partly | the e2e walk is scripted. The 0.1.0–0.1.3 playtest was observed, with N=2. No perturbation test and no error counts |
| 24 | No single channel; alternatives | partly | shot [42]: Sound, Haptics, Reduced motion (Auto/On/Off) and Colorblind aids exist. The shelf has no colourblind aid (code). `haptics.js` uses `navigator.vibrate`, which does nothing on iOS Safari, so on an iPhone every haptic row is silent |

Also still open from the audit in 0.1.3: the tab highlight follows the route,
not where the screen lives (shot [42]: Settings lights Catalog).

---

## C. Amendments to today's plan

### Theme A: pacing and gating

- **Decision line ("colors only reveal the purchase"):** keep colours as the gate and coins as the purchase, but **show the price from the start**. The tag reads "Shelf: 8 colors · 400 coins, 3 more colors", not "3 more colors to see the price". A hidden number is something she can't plan toward, and ch. 05 §2 asks "how long until the next milestone". Recognition over recall: ch. 01 §15.
- **Item 4, add a preview:** tapping a locked object opens a small sheet titled "What this opens", with one looping illustration, one sentence and the price. She sees what she is buying before she spends (ch. 10 §2 by analogy, ch. 05 §5).
- **Item 4, let her feel the need first:** from 6 colours, spillover vials stack behind the glass of the closed shelf in the scene, and its tag says "6 vials waiting". Buying then opens a shelf that is already stocked. This is ch. 03 §7, and it stays forget-friendly because nothing is lost. The map window gets the same pattern later: a knock and a "Wren is waiting" tag.
- **Item 4, make each purchase a moment:** add one shared `unlockCeremony(objectId)` of 1.5 s or less, played in the scene (shelf dusted, window opened, door unlocked). It then routes into that subgame's first-open guide from Theme D (ch. 02 §4, §6; ch. 06 §7).
- **Item 4, Purify row:** drop the 250-coin gate. The first muddy batch is already a felt-need gate, and charging coins between the problem and its fix is a toll (ch. 01 §17). Playtest note 2 doesn't list Purify. If you keep the gate, run Theme C item 5's free tutorial board first and offer the purchase after the solve. As written, Theme A (pay first) and Theme C (tutorial on the first batch) conflict.
- **Item 4, tier rows (Steady / Tricky / Master for coins):** reveal them by colours and keep them free. Decision 4 makes purify tiers free, so paid grading tiers would be two rules for one control (ch. 03 §15). DESIGN says tiers are "player-chosen" with "free switching", and difficulty is an accessibility variable (ch. 09 §6). Revealing one segment at a time is the progressive disclosure the playtest asked for.
- **Item 4, Renovate:** the Renovate sheet lists the unlocks that will close again (ch. 05 §9). After a Renovate, offer one batch purchase, "Reopen the shelf, map and gallery for 3.1K", instead of six separate re-buys (ch. 02 §14, ch. 05 §13).
- **Item 1:** make the third mixer (~60 coins) the flow-meter suggestion right after the tutorial. A third jar appears in the scene and the easel gains a colour. This is the first-session possibility upgrade (ch. 02 §4).
- **Item 2:** a greyed palette colour carries a paper tag ("Set a mixer to make this"), not a dead-grey swatch. Tapping it opens the mixer picker as a **sheet over the easel**, not a navigation away, so the painting stays in view (ch. 01 §9, §10). The picker shows one use per colour, the most relevant one (ch. 03 §3).
- **Item 3:** the default "keep 20 jars" rule does the work. Put the per-colour toggle in the vat's detail sheet, not on the vat row (ch. 03 §9, simple surface and deep inspection).
- **Item 5 (and 6):** add "rewrite DESIGN First ten minutes and `test/first-ten-minutes.e2e.mjs`". At 8 colours plus 400 coins with one tint per Relaxed board, the 4:00 shelf beat and the "1 chain merge" target can't happen. The proposed script is at the end of this section.
- **Item 7, workshop split:**
  - The home screen gets **one primary**. Merge the flow-meter suggestion and Theme D's Next strip into one "Next" button. Collect becomes a secondary button or folds into the coin pill. Almost there lives on the Ledger, or at the very bottom of home (ch. 01 §3.1, ch. 08 §11). Evidence: [24].
  - Show only the segments that have content. Hide Shipping until the Loading Yard opens; until then that's two segments, not three (ch. 03 §4).
  - Remember the last segment. A deep link lands on its row, scrolls it into view and flashes it once (ch. 01 §9, §10).
  - Scene objects work as shortcuts: tapping a mixer jar opens Stations › Mixers (ch. 06 §2).
  - Rows show before → after: "0.08 → 0.11 a second". Keep compact rows, not cards (ch. 05 §6, §16).
  - The segmented control is 44 px tall and sticky once she scrolls past the scene.

### Theme B: the Merge Shelf as a match game

- **Item 1, sizing:** `cell = min((W − 2·pad − 5·gap) / 6, (H_avail − chrome) / 6)`. With the label column gone (item 6), cells come to about 54–56 px at 390 wide. Fold the header card into one line ("A new vial soon · 2 Essence") above the chips, so the board starts high on the screen (ch. 04 §15). Remove `autoScroll` in the drag code, because the board no longer scrolls.
- **Item 1, hit testing:** replace `elementFromPoint` with board-local maths that finds the nearest cell, so gaps and planks count. Extend the board's outer bounds by 12 px (ch. 04 §2, §4).
- **Item 1, occlusion:** draw the ghost **fully above** the finger, with its bottom edge at `y − 12 px`, because the colour is at the bottom of a vial. Resolve the drop at the ghost's base, not at the finger, so what she sees is what she drops on. Add hysteresis: the target changes only once the hotspot is 25% into a neighbouring cell. Add a magnet: within 24 px of a legal merge partner, snap to it; empty cells come second (ch. 04 §4.1, §16).
- **Item 1, pickup preview:** on lift, exact-colour partners ring (the `is-partner` style exists), and cells that would complete a family line get a faint guide in the family colour (ch. 04 §6, §11).
- **Item 3, hue family needs a non-colour cue:** draw a family glyph on each cork (always on, or at least with Colorblind aids) and the same glyph on the colour chips. Pairs merge on exact colour and lines on family, so two look-alike rules need a visible cue (ch. 03 §15; [40] shows the problem today). When she drops a same-family, different-colour container, it simply moves, and a quiet name label shows both colours. Never red.
- **Item 2:** default the five chips to five **different** families so lines are easy to read. Tapping a chip shows the colour's name. Two chips in one family stays allowed.
- **Item 3, diagonals:** ship rows and columns first and hold diagonals until the phone test. Shelves read as horizontal planks; a diagonal crosses them and is a third rule to teach (ch. 03 §6, ch. 04 §11). If they stay in, teach them at the first diagonal that comes close to complete.
- **Item 3, overlapping lines:** lines found in the same check resolve **together** as one "double line". It gets one sequence, two coin arcs that join, a ×2 on the 1.5× bonus, and the shared cell counts for both lines. They don't resolve one after another (ch. 04 §9). Define this in the sim before the UI is built.
- **Item 3, sequence timing:** 2.2 s breaks DESIGN's "Nothing longer than 1.5 s" and "any celebration can be skipped". Budget it at about 1.5 s:
  - (a) six lean-ins at 60 ms each (360 ms), one note per container, no per-step haptic. The 80 ms throttle would drop every other one;
  - (b) pop, 280 ms (the Merge row), heavy haptic;
  - (c) glowing hold, 350 ms (500 ms for her first line ever);
  - (d) tip, coin arc, counter roll and "Sold" stamp, 400 ms, medium haptic on the stamp;
  - (e) shimmer and clear, 150 ms.

  A tap at any point jumps to the end state with the coins credited. From (c) on, cells outside the line accept a new drag; today `ui.anim` blocks the whole board (ch. 04 §7, ch. 01 §8).
- **Item 3, cascades:** a merge, then a 90 ms gap, then the line starts. A chain keeps its 90 ms steps, and the line waits for the last pop to settle (ch. 04 §7).
- **How to judge the auto-sell pause:** not by eye in Playwright. Add local-only counters, `stats.lines` and `stats.lineSkips`, shown in the debug panel. If she skips more than half of her lines after her first ten, shorten (c) and (d). Watch her play without explaining anything: does she wait for the coins, or tap through? (ch. 08 §5, §16). Decision 3 (auto-sell) stands. Ordinary pair merges never auto-sell, so building an Urn for an order stays a manual, deliberate act (ch. 02 §10, ch. 04 §16).
- **Item 5:** while spillover is paused, the header reads "The shelf is resting: make room for new vials". No countdown; minutes only, as the audit asks.
- **Item 7, onboarding:** put the seeded row of five reds on the **bottom** row, nearest the thumb. Put the coach above the board, never over rows; in [11] the bubble covers rows 2–3. After the first clear, show one line: "Six of one color family in a row or column sell together." Teach columns the first time a column has five.
- **Item 8, tests:** add a perturbation test: 200 drops at random offsets up to half a cell from each cell's centre, including gap and plank midpoints, must resolve to the intended or nearest cell at least 99% of the time (ch. 08 §7.1). Run the viewport fit at **375×667** as well as 390×844, the smallest phone (ch. 08 §13).
- **Migration:** on first open after the update, show one paper line: "The shelf is now 6 by 6. Row labels are gone: six of a family in a line sell together." Changed rules get explained (ch. 10 §12).

### Theme C: Purifying

- **Item 1:** keep 2–3 minutes and backlog 10 while she is playing (decision 5), but cap **offline catch-up at 3**, not 10. A return should open on a pleasant job, not a wall of ten batches (ch. 05 §8, ch. 02 §14).
- **Item 4:** muddy batches **never block All caught up**. The Ledger line becomes "3 muddy batches to sort, if you like". That closes the INTEGRATION-NOTES open item and makes "Purify all later" unnecessary; cut it (ch. 01 §17). Add "Sell all as is", with a one-line confirm showing the total (ch. 05 §13, ch. 01 §6.1).
- **Item 3, placement:** put the purify tier control on the Puzzle table's Purify card, using the same segmented component and position as grading, not on each batch card. The same action belongs in the same place (ch. 01 §9).
- **Item 3, session fit:** each tier shows an expected length ("about 1 / 2 / 3 / 5 min") so she can pick one to fit a Tend or Settle-in session (DESIGN Session shapes; ch. 09 §6). Default to Relaxed for her first three batches. Changing tier mid-batch reads "Start this batch on Relaxed", which restarts it with nothing lost. Update DESIGN's "size scales with batch value" line.
- **Item 3, hit areas:** the whole tube column, including the space above the tube, is the target, and the 7 px gaps resolve to the nearest tube (ch. 04 §4). At 11 tubes, check the layout at 375 wide.
- **Item 5:** introduce the cork just in time: that coach step appears when the first tube is one layer from full, not upfront (ch. 03 §5).

### Theme D: subgame onboarding and flow

- **Item 1, coach hygiene rules for `guide()`:**
  - any step that can finish on an action must finish on it; "Got it" only appears on information steps;
  - at most 2 steps before her first action, at most 15 words a step, one concept a step (ch. 01 §13, ch. 03 §6);
  - the bubble never covers its anchor or the next target, and never shares the screen with a toast or a sheet (enforce this in `guide()`, not per screen);
  - a step may wait for its trigger state (first near-full tube, first column of five) instead of firing when the screen opens;
  - add a small "How this works" link in each subgame's header that replays its script (ch. 09 §6).
- **Item 1, the "what's next" card:** show it when she leaves a subgame or after her first success, never mid-play. It has two equal choices, "One more" and "Next: the catalog", and it never navigates by itself (ch. 02 §15, ch. 06 §10).
- **Item 2:** rewrite the hops against Theme A's gates. "Your fifth color opens the shelf" is stale and becomes "8 colors and 400 coins open the shelf". The map is 15 colours and the Gallery 25. Fire each script from that unlock's ceremony (Theme A), so the order of introduction follows the order she unlocks things.
- **Item 2, voice:** where it is cheap, let a character speak the script, with a small portrait in the bubble: the first hunter for the Map, a visitor for the Gallery, a customer for Commissions (ch. 06 §12).
- **Item 3:** don't build a separate Next strip. It becomes the single "Next" slot from Theme A item 7. Three "what next" surfaces would compete (ch. 01 §3.1).
- **Item 4, tests:** in every script step, the coach rectangle doesn't intersect its anchor's rectangle, and no toast is visible while a coach is up.

### Theme E: Gallery discard and sell

- **Item 1:** the scrap confirm says what goes ("12 painted panes will be cleared; the jars used stay spent") and uses a second tap on the same button, not a modal on a modal (ch. 01 §6.1).
- **Item 2:** selling a signed piece destroys something she made, which is the ownership pillar. Use the strongest protection: a sheet with the thumbnail and the price. Also leave a small "Sold to a collector" card in the archive with the thumbnail, so the memory stays (ch. 02 §5, ch. 06 §9).
- **Item 2:** "Take down" on the hung tile needs a 44 px target.

### Theme F: the mobile feel pass

- **Item 1, `drag()`:** remove the 40 ms positional lag. A lagging object reads as input latency and hurts precision (ch. 01 §7). Keep the tilt, driven by velocity and capped at 6°. Build board-local hit testing, ghost offset, hysteresis and the magnet (Theme B item 1) **into `fx.drag`**, so the shelf, the grading board and packing share them.
- **Item 1, haptics:** confirm the phone first. `haptics.js` uses `navigator.vibrate`, which iOS Safari doesn't have, so on an iPhone every haptic in the spec is silent, and the Playwright iPhone 14 descriptor can't show that. If it is an iPhone, either try the iOS 18 `<input type="checkbox" switch>` label-click haptic (unverified; test on the device) or accept sound plus motion as the carriers. Haptics are never the only carrier of meaning (ch. 09 §8).
- **Item 2, buttons:** the press animation is cosmetic. The action fires on release at once and never waits for the spring (ch. 01 §8).
- **Item 2, Buy an upgrade:** quick repeated buys collapse into one squash per frame and never queue (ch. 01 §19).
- **Item 3:** test `pointercancel` from the iOS edge-swipe-back on the shelf and the board. The ghost must clear, and the source must return to its cell.
- **Item 4:** run the frame probe during a **double line** and a merge-then-line cascade, not only during a chain. If frames drop, drop particles before input (ch. 01 §19).

### First ten minutes under the new gates

DESIGN's script assumes the shelf at 5 colours. With Theme A in place:

| Time | Beat | Change |
| --- | --- | --- |
| 0:00 | Welcome, then the first orange, named | keep (the best beat) |
| 1:30 | A Relaxed board in her own colours reveals one tint | keep, one tint |
| 3:00 | First upgrades; the "Next" button is always affordable | INTEGRATION open item |
| 4:30 | Buy the third mixer: a new jar in the scene, two recipes running | new possibility (ch. 02 §4) |
| 6:00 | The order board fills; the closed shelf starts collecting vials behind glass | felt need, as a tag, not a bubble |
| 8:00 | Mill Room goal; the window and door tags (no bubbles) | fewer interruptions |
| 9:00 | Close up shop | keep |

New target: 5 colours, 1 named colour, about 8–10 upgrades, 1 new possibility,
no more than 5 coach bubbles, and no chain merge. The shelf becomes the landmark
of session two (ch. 03 §6, ch. 08 §8–9).

---

## D. New items the plan is missing

| Item | Why (handbook) | Priority | Cost |
| --- | --- | --- | --- |
| Toast discipline: one at a time, never over a screen head, never carried across screens ([40] shows the paint toast over the shelf title) | ch. 01 §3.1, ch. 08 §11 | now | small, `app.js` toast gate |
| Smallest-phone pass: add 375×667 to the e2e screenshots and the shelf fit test | ch. 08 §13, §20 | now | small |
| Confirm the playtest phones (iOS or Android) before Theme F | ch. 09 §8, ch. 08 §13 | now | five minutes |
| Dense-input perturbation harness in Playwright, reused by shelf, grading and purify | ch. 08 §7.1 | now (with B) | about one worker-hour |
| Before → after values on every Level up row | ch. 05 §6 | this release (with A.7) | small, row strings |
| Family glyph on shelf containers and chips (Colorblind aids at minimum) | ch. 09 §2, ch. 03 §15 | this release (with B) | small, `containerSvg` overlay |
| Local-only counters: wrong drop, rejected drag, line skips, coach dismissed without acting; shown in debug | ch. 08 §16 (no network) | this release | small |
| "What changed in 0.2" paper note for existing saves (shelf 6×6, coin gates, purify tiers) | ch. 10 §12 | this release | small |
| Tab highlight follows the screen's home, not `stack[0]` (still wrong in [42]) | ch. 01 §9 | this release | small, router |
| Shared unlock ceremony component (Theme A bullet above) | ch. 02 §6, ch. 06 §7 | this release | medium |
| Hold-to-repeat on Level up from level 10 | ch. 05 §13 | later | small |
| Separate effects and ambience volume | ch. 09 §8 | later | small |
| Undo the last shelf move or merge | ch. 04 §16 | later (merges always pay; low risk) | medium |

---

## E. Recommended order for today

The plan's order mostly stands. There are two changes. The pure-UI foundations (F.1
motion vocabulary and D.1 `guide()`) move to step 1, because B, C and D are
their consumers; built at step 6 as planned, they mean doing the shelf drag and
the onboarding twice. And step 0 settles the open questions before any worker
starts.

| Step | Work | Change from plan |
| --- | --- | --- |
| 0 | Matthew decides: show the price? Purify gate? Tier gates free? Diagonals now? Which phone? | new, 15 min |
| 1 | A sim + UI (unlocks, 2 mixers, palette, reserve, SAVE_VERSION 2 including `onboarding.seen`) **in parallel with** F.1 (`fx.js` only: spring, lift/settle, drag with hit testing / offset / magnet, coinArc, stamp) and D.1 (`guide()` and its hygiene rules in `onboarding.js`) | F.1 and D.1 moved up; disjoint files, no state clash if A owns the migration |
| 2 | A balance, plus the First ten minutes rewrite in DESIGN and the e2e | first-ten rewrite added |
| 3 | B + E, built on `fx.drag` and `guide()` | uses the step 1 foundations |
| 4 | C, on `guide()` | parallel with 3 |
| 5 | D.2 scripts and the single "Next" slot | Next strip folded into A.7's slot |
| 6 | F.2 per-screen feel pass | vocabulary already exists |
| 7 | Integration walk past minute ten, 375 and 390 screenshots, bump, deploy, then the phone session | phone session made explicit |

**Evidence ladder per theme** (ch. 08 §2.1). Report each result at the level it
reached. Playwright with `hasTouch` is scripted interaction, not touch.

| Theme | Scripted (Playwright / node) | Needs the phone (Matthew) | Needs his wife (observed, no help) |
| --- | --- | --- | --- |
| A | gate unit tests, balance sim (simulated players, not people), first-ten e2e, workshop segments and deep links | none beyond a glance | 3-second test on a lock tag ("what does this need?"); does buying the shelf feel like a reward or a toll? |
| B | line detection, double line, cascade order, fit at 375×667 and 390×844, perturbation fuzz, frame probe during a double line | 50 drags counting wrong source, wrong destination and rejected; magnet feel; haptics | does she discover lines from the coach alone? does she watch or skip the sell (counter)? |
| C | spawn ceiling over a simulated day, offline cap 3, strict solve with solver, tier sizes | tube tap reliability at 11 tubes on 375 wide | after a day away, does the backlog feel like a job or a treat? which tier does she pick? |
| D | each script once and survives reload; coach never intersects its anchor; never with a toast | none | first open of each subgame with no help: count hesitations and "what now?" |
| E | sim tests: sell pays once, scrap refunds nothing | confirm can't be hit by accident | does she find scrap and sell unprompted? |
| F | touch-emulated drags, long-task probe, reduced-motion screenshots | everything that is feel: weight, haptics, edge-swipe cancel, thumb reach | "does it feel good?", reported as observed with N=1, not as validated |

---

## F. Disagreements

The design doc's pillars are the owner's. The handbook advises.

1. **The line sequence (2.2 s) against DESIGN's motion rules (1.5 s cap, every celebration skippable).** This is a plan-versus-DESIGN conflict, and the handbook sides with DESIGN (ch. 04 §7, ch. 01 §8). **DESIGN wins:** budget about 1.5 s, skippable from the first frame (Theme B bullet). If Matthew really wants 2.2 s, amend the motion rule in DESIGN explicitly.
2. **Coin-gated grading tiers against DESIGN "player-chosen, free switching" and decision 4.** **DESIGN wins:** reveal tiers by colours and keep them free.
3. **Manual Collect against ch. 05 §8 ("collect automatically if there is no choice").** **DESIGN wins.** The coin arc is a specified ritual, and the handbook's own ritual clause (ch. 02 §14) protects it. Revisit only if she stops enjoying it.
4. **Auto-sell on lines against ch. 02 §10 (reward choice) and ch. 04 §16 (distinct sell).** **Matthew's decision 3 wins.** Pair merges stay manual, so the choice survives elsewhere. Judge the pause with the skip counter.
5. **Instrumentation (ch. 08 §16) against Tincture's offline, calm design.** **DESIGN wins:** counters stay local and only appear in the debug panel. Nothing leaves the phone.
6. **"Repeated flows get faster" (ch. 01 §8) against the wish for weight.** This isn't settled. Lines are a payoff, not a utility flow (ch. 02 §12 contrast). Let the skip counter decide, not either document.
7. **DESIGN "Merge Shelf at 5 colors, a tactile hook in the first session" against the plan's 8 colours plus 400 coins.** The handbook (ch. 03 §6, §8) backs the plan, and so does the playtest. **The plan wins; update DESIGN** (Merge Shelf "Unlock", First ten minutes, pacing table).
8. **Nothing in the handbook argues for energy, streaks, countdowns or gacha.** Ch. 02 §17 and ch. 10 §6 agree with the Banned patterns. Ch. 02 §11 on pity timers matches the wild-hue pity and the Golden vial.
