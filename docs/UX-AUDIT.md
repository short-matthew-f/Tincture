# UX audit (screens against the feel spec)

Read-only audit of the real app at 390 x 844. Nothing was fixed here.

**Evidence.** `e2e/01-42` are the 42 screenshots from the browser walk, quoted below as `[NN]`. Phase 2/3 states were captured with scratch Playwright scripts and are quoted as `[p3:name]` (phase 3, 48 colors, hunters hired, gallery open, vials on the shelf, rolled dailies, open commissions, a started painting). A tap-target and overflow audit ran on every screen in those states.

**Spec used.** DESIGN.md "Fun and engagement" (Open loops, Stopping points, First ten minutes, Banned patterns), "Interaction feel" (all tables), "UX, notifications and accessibility", "Art direction" (Tokens, Locked things stay visible), and UI-CONTRACT.md "Conventions".

**Format.** `- [P1|P2|P3] what is wrong -> what it should be (spec: section or rule)`.
- P1: breaks a pillar or the core-loop feel (confusing, dead end, negative framing, looks broken).
- P2: noticeably rough.
- P3: polish.

**Verified clean.**
- No horizontal page overflow on any screen (`scrollWidth <= 390`).
- No red anywhere on a wrong answer. The only red-brown is the All caught up stamp, which is allowed.
- Positive-framing wins to keep: "4 more colors, and the window opens" [30], "11 more to complete" [34], "14 more colors to go" [35], "22 more colors" locks on hunters [p2 map], "Buy 1 Heritage - 1 more to go" [37], "Nothing is spent here, so experiment freely" [24], "Little goals, no rush" [33], "The window opens soon" [30].

**Caveats.**
- Fonts were blocked in the sandbox, so Young Serif renders as a fallback serif. Judge shape, not glyphs.
- Tab highlight in [33] to [38] comes from the walk's navigation order: the router highlights `stack[0]`, the base of the stack. The rule is real and breaks in play, for example Orders -> Shelf.

---

## Workshop [20, 09, 10, 14, 41, 42, p3:a-workshop]

- [P1] The first-session coach at [09] says "tap it for the upgrade that helps most" and points at a grey, disabled "Needs 46 to upgrade the shop". Two toasts and the coach sit on top of it. The instruction and the control contradict, and it reads as broken -> hold the coach until the button is affordable, or word it as "Upgrade the shop: 31 more coins" in the active style. A tappable control should never be the grey of a dead one (spec: Positive framing; Instant acknowledgment).
- [P1] "Needs 46 ..." [09, 10, 14] is "need" framing on the home screen's main button -> "31 more coins to upgrade the shop" with the progress shown on the button (spec: Small tricks, positive framing; Goal gradient).
- [P2] The Store tile clips its value at 390 px. "Full in 15h 24m" shows as "Full in 15h 24r" [09, 10, 14, 15, 17] and "Full in 42m 56" [41] -> shrink, abbreviate ("Fills in ~15 h") or let the tile grow (spec: nothing clipped at 390).
- [P2] "Full in 43m 5s" [20] puts a seconds-ticking deadline on the home screen, and "Full" sounds like waste. Waiting never loses anything -> "Room for 43 more minutes", minutes only, no seconds (spec: Countdown pressure on rewards is banned; the map's "opens soon" voice).
- [P2] "Make 0 jars/s" appears on a fresh shop and on any shop with no recipe [42, p2 workshop], next to "+0/s" -> hide the number until a mixer runs, or say "Pick a recipe to start" (spec: Number formatting, no "0 jars/s").
- [P2] Three dark primary buttons compete: "Upgrade the shop for 46", "Collect 31K" [20], and later "Close up shop" [15]. No single obvious next step -> one primary at a time. Collect should show its unit, coins or jars (spec: Core loop, one clear next action).
- [P2] "Collect 31K" [20] sits beside a coin counter reading 67. It is unclear what is being collected or what it pays -> "Collect 31K jars (about 93 coins)", or show the coins (spec: Interaction spec, Collect income).
- [P2] The scene's unlock tags give absolute numbers while the map speaks in remaining ones: "10 colors" on the window, "20 colors" on the door, "30 colors" on the cart [20]. The map [30] says "4 more colors, and the window opens" -> use the same "N more" voice on the tags, with a plain-text hint on tap (spec: Locked things stay visible; positive framing).
- [P2] The calendar/quests object is tagged only "Later on" [20, 41]. That names no goal, so it is a vague stub -> give the real goal or hide the tag until it matters (spec: Locked things stay visible, a tag names the unlock goal).
- [P2] The scene's scroll (commissions) and calendar objects are about 34 x 56 and 40 x 38 with no labels [p3:a-workshop]. The scroll's tap target is also thin -> label them and give a 44 px hit area (spec: 44 pt controls).
- [P2] Mid-size buttons are 36 px: Rush (84 x 36), Hire (free) (101 x 36), "Choose a recipe" mixer swatch (36 x 36), the Almost there rows (330 x 36) [p3:a-workshop] -> raise to 44 (spec: Accessibility, 44 pt).
- [P3] The sub-line "Level 1 - 0.08 raw/s" [10] uses "raw/s" jargon, and "Level up" costs like "6.9" [p3:a-workshop-s1] show fractional coins -> "0.08 a second", round coin costs (spec: Number formatting).
- [P3] The mixer jar labels truncate ("Harbor S...") [20] -> two-line or smaller label.
- [P3] Card titles ("Sources", "Mixers", "Next room", "Apprentices", "Almost there") use Young Serif [10, 14] -> Figtree 600 for section labels. The serif is for names (spec: Display type = names only).
- [P3] The Mill Room "Open soon / 500" [14] is a disabled-looking button, while its real goal ("5 more colors to open") sits in small text below -> make the goal the paper tag and the button live only when openable (spec: Locked things stay visible).
- [P3] The sticky "Needs 46 ..." button leaves a sliver of a card above it when scrolled [14] -> add a top fade or solid backing.

## Morning Ledger [18, 19, 21, p3:b-ledger]

- [P2] The "All caught up" stamp lands on top of the copy ("The workshop is humming along" [19, 21]) and hides words. It should land in free space, above or beside the text (spec: Interaction spec, All caught up; Peak-end).
- [P2] When nothing is new, the nav title and the card title both say "Morning Ledger" [21, p3:b-ledger] -> keep one, and give the card a warm line instead.
- [P2] "You were away 3 d" [18] uses an abbreviation -> "You were away 3 days".
- [P2] The toast over the stamp, "Step 1: +20 Seals!" [19], introduces "Seals" with no explanation. The first mention of a currency needs one line saying what it is (spec: Core loop, no mystery).
- [P3] Every ledger row is bold at one weight, with the action as small brown 13 px text at the right ("Got it", "View", "Merge", "Claim") [18] -> make the action a real small button or chevron so rows read as tappable (spec: Interaction feel, instant acknowledgment).
- [P3] "33 vials waiting on the shelf" [18] leans on a chore list rather than an Almost there item -> "33 vials ready to merge" first, and end the list on the stamp (spec: End on a high).
- [P3] The Almost there rows are 330 x 36 [p3:b-ledger] -> 44.

## Orders [02, 13, 22, p2/p3 orders]

- [P1] The board's targets are drab olive, taupe, slate and khaki [02, 13, 22]. The first screen the player lands on after naming is mud, and the order is meant to be a delight. Known; the generator fix is with another worker. UI side: show the customer's wish in words with the swatch ("Old Man Feeney would like a mossy green") so a plain swatch carries a story, and never put four drab cards in a row (spec: Art direction, her colors are the brightest thing on screen; Her words come back).
- [P1] "The board is full" [22] reads as an error. It is the countdown slot's text, and it changes the line where "Next order in ..." sat -> "Plenty on the board. Fill one to bring the next" (spec: Positive framing).
- [P1] "Opens in Phase 3" [02, 13, 22] sits in a full-size card beside the real "Mixing bench" button and looks like a disabled button. "Phase 3" is also internal jargon that does not name the goal. The goal is 30 colors plus the Loading Yard (checkPhase) -> a paper tag hung on a quiet scroll: "Commissions open at 30 colors - 12 more" (spec: Locked things stay visible, a paper tag, not a button).
- [P1] The same customer appears twice on one board: "Mapmaker Quill" twice in [22], although `sim/orders.js` says "no customer appears twice" -> dedupe at render and at generation. Duplicates read as placeholder text.
- [P2] "Pays 2 to 4.3" and "Pays 12 to 26" [02, 13] expose a 70% to 150% range with decimals. It is odd, and the range hides what a perfect mix pays -> "Pays up to 4 coins" with the exact figure on the order (spec: Number formatting).
- [P2] "Next order in 8 m 50 s" [13] counts seconds on the page where she decides what to do -> "A new order soon" or minutes only (spec: Countdown copy never pressures).
- [P2] The first-order coach bubble [02] hides cards 2 and 3 and the highlight ring is the only cue. The bubble should sit below the highlighted card without covering the next ones.
- [P2] Orders -> "Open the shelf" keeps the Orders tab lit [stack base], and the shelf's aria back label stays "Back to the workshop" even though back returns to Orders -> the tab bar and back labels should follow where she came from (spec: UI-CONTRACT, back labels; Art direction, tab matches the screen's home). Known.
- [P3] "Anything you love" [p3:a-orders] shows a star on a gold swatch. It is the same star icon used for reputation, Seals and essence -> give each currency its own mark.
- [P3] The empty lower half of the screen with three cards [13] could carry a gentle fill: "Next: the Mill Room at 10 colors - 4 more" (Open loops).
- [P3] The reputation line "0 stars of reputation" [p3:a-orders] reads as a score of zero -> hide until the first star, or "Earn your first star with a Perfect".

## Matching [03, 04, 05, 23, p3 m2]

- [P1] The post-order result [05] is an empty page with one card. It has a swatch pair and needle, the pay, "+1 reputation star" and "Back to orders", and nothing about what she just made or where to go next. Two toasts sit on top. It should carry the result and the way forward: the new color's name and a "Name it" or "See it in your catalog" action, "Try a grading board" and "Back to orders" as peers, and "2 more colors and the shelf opens" (spec: Peak-end; Open loops).
- [P1] The discovery reveal [04] shows only "A NEW COLOR / Tap to continue" with an unnamed swatch, and the result page behind it is already dimmed -> the name should be revealed letter by letter in the same card [08 shows this for the board reveal] (spec: Interaction spec, New color discovered).
- [P2] Both stacked toasts, "A quest is ready to claim" and "Harbor Sunset joins your catalog" [04, 05], cover the screen head and the top of the swatch card, and they repeat what the card says ("This mix found a new color for your catalog") -> show one place, not three.
- [P2] "+1 reputation star" and "This mix found a new color" [05] both use a star glyph -> one icon per meaning.
- [P2] The result's coin number rolls up from 0 while the header is blank [04] -> show the coin counter from the start, or hide the 0.
- [P3] "Close enough" for the lowest tier [source: matching.js] sits next to negative-ish copy. "Anything you deliver pays at least 70%" [03] -> "Anything you deliver is welcome" with the pay shown by the needle.
- [P3] "Pays 4.3" [03] is a fractional coin -> round.
- [P3] The mixing screen [03, p3 m2] has a large blank band between the drop card and the Undo/Reset/Deliver bar. The "Deliver" bar is fine, but nothing hints at how to mix ("tap a drop") after the first order -> a one-line tip.
- [P3] The "Order filled" empty page [23] is reachable only by stale navigation; give it a warm line and a thumbnail of the paid order, plus a way to the next order.

## Bench [24, p3:b-bench]

- [P2] "Sell 1" and "All" are 65 x 36 and 43 x 36 [p3:b-bench] -> 44. "All" sells a whole stock at base price with no confirm or undo -> "Sell all 2.6K for 7.8K?" confirm (spec: no regrets; Banned patterns, expiring progress).
- [P3] "Add a drop" placeholder in the result box [24] -> a faint swatch outline and "Tap a drop to start".
- [P3] Disabled "Undo / Reset jar / Mix it" are all three grey [24] -> hide Undo and Reset until a drop is in.
- [P3] "None" under each pigment [24] -> "0 drops" or nothing.

## Commissions [25, p3:b-commissions]

- [P1] The locked state [25] is a nearly empty page with "Opens in Phase 3" in a tag and no goal -> "Commissions open at 30 colors with the Loading Yard - 12 more", with a preview of the first commission's art (spec: Locked things stay visible).
- [P2] "0 of 5 different colors", "0 of 50 jars", "0 of 10 different colors" [p3:b-commissions] are the "X of N" pattern the spec bans. The headline already says "50 more jars of blues" -> keep that and drop the "0 of ..." lines, or phrase as "5 more different colors".
- [P2] Tags in this list look like the lock tags ("Pure or better", "Bulk order", "Wild hue") but are not locks [p3:b-commissions] -> make requirement chips a different shape from lock tags.
- [P2] "Deliver" is 76 x 36 -> 44 min.
- [P3] The reward row shows a gray "?" box for "A signature color" [p3:b-commissions] -> a hue-family silhouette (spec: Silhouettes of the missing).

## Puzzles [06, 26, p3:a-puzzles]

- [P2] The Purify and Packing cards [26] are text only with no action. Packing even says "Start it from a loaded vehicle at the loading yard" with no link there -> a button that goes to the workshop's Loading Yard, or "Needs a loaded cart" as a tag (spec: Empty states have a next step).
- [P2] "4 by 5" pill [26] on the grading card is unexplained; it looks like a score -> "4 x 5 tiles" or remove.
- [P2] "Reward: about 58 / 1x" [26] has no unit -> "about 58 coins".
- [P2] The tier switch is 80 x 38 [p3:a-puzzles]; "New board in my own colors" is 330 x 36 -> 44. Its flat, cut-off look makes it read like part of the card above [26].
- [P3] Tier names have no description (Relaxed, Steady, Tricky, Master) -> one-line hint under the selected one.
- [P3] Card titles ("Grading boards", "Purify", "Packing") in Young Serif [26] -> Figtree (names only).
- [P3] The coach bubble [06] covers the Purify card text. Anchor it above the highlighted card.

## Grading [07, 08, 27]

- [P2] Toasts "A quest is ready to claim" and "Harbor Sunset joins your catalog" cover the head and the "Relaxed" chip [07], and toasts take pointer events -> keep toasts out of the screen head, and queue them behind a puzzle (spec: Motion rules, nothing blocks the board).
- [P2] The header chip "Relaxed" top-right [07, 27] is bold and boxed like a button, and unexplained -> plain text under the title (it is already there: "Relaxed - 0 swaps").
- [P2] "Relaxed - 0 swaps" [27] counts moves, a hidden scoreboard in a game with "no timers in puzzles" -> drop the counter unless she asks.
- [P2] The solved reveal [08] shows an empty "No board on the table / Start a new one whenever you like" card behind the modal while the celebration plays. The peak should not show an empty state -> keep the solved board visible under the celebration (spec: Peak-end).
- [P3] "Leaf frame / Autumn Harvest" corner labels [27] are tiny (11 px). They are charming, so bump to 12 px.
- [P3] "7 tiles to go" [07, 27] is the "to go" framing -> "7 more to settle".
- [P3] The board leaves about 100 px of blank in the card below the last row [07, 27].
- [P3] The dots on tiles [07, 27] are small black circles, while the copy says a correct tile "rings" -> use the ring shape.

## Purify [28]

- [P2] "Nothing to purify right now" [28] is a dead-end card with only Back -> offer the next step: "Muddy batches come from mixers. Check the workshop" with a link (spec: Empty states have a next step).
- [P3] The back label "Back to the table" is truthful; good.

## Packing [29]

- [P2] "Nothing to pack right now" [29]: the same dead end, and the header says "Loading Yard" while the back arrow's label says "Back to the loading yard" but returns to Puzzles. Link to the yard from the card.
- [P3] The button says just "Back" [29] where Purify says "Back to the table" -> same pattern.

## Map [30, p2/p3 map]

- [P2] The lock tags on the map [30] overlap each other and the pins: Dreamshore's "Coming later" crosses Volcano's label, and the right-hand tags (Coast, Dreamshore) sit at the edge of the frame -> re-place tags or stack in a legend.
- [P2] Tags show totals ("60 colors to open", "25 colors to open") while the card below says "4 more colors, and the window opens" -> use "N more" on every tag.
- [P2] "0 of 6" and "1 of 6" on "Join the team" [30, p2 map] -> "5 more joining soon".
- [P2] The Hire buttons are 55 x 36 [p3:a-map], and the disabled "Hire" next to "Hunters arrive at 10 colors" tag [30] is a double lock -> keep only the tag.
- [P2] The "Album" button at the top right [30, p3:a-map] is 71 x 36 and opens a page of eight "?" cards before any hunter exists -> lock with a tag, or open it with a next step (spec: Locked things stay visible).
- [P3] "Everyone is home" [p2 map] is warm, good.
- [P3] Two lock-tag shapes appear on the map, one at the pin and one in the card [30].
- [P3] Hunter names in Young Serif are right (names) [p3:a-map].

## Hunter [31, p3:b-hunter]

- [P1] "That hunter has not joined yet." [31] is a bare, negative dead end with a plain serif sentence and a full-width Back -> a silhouette card with the lock tag "Wren arrives at 10 colors - 4 more" (spec: Locked things stay visible; the "window opens soon" voice).
- [P2] The page title is the generic "Hunter" [31] -> the hunter's name, or "Your hunters".
- [P2] The Album button is 71 x 36 [p3:b-hunter].
- [P3] On a joined hunter [p3:b-hunter], "Level 5 - 4 more levels" is good positive framing. "Botanist" and "Level 1" as a dark pill beside "Warm voice" mixes three chip styles -> one chip style.
- [P3] "Botanist" and "Level 1" headings in the serif are not names -> Figtree.

## Album [32, p3:b-album]

- [P1] Page tabs clip at the right edge ("Jung...") with no fade or scroll cue [32] -> add an edge fade and let the tab strip scroll-snap, or wrap to two rows (spec: nothing clipped at 390).
- [P2] A grid of eight "?" / "Not found yet" tiles [32] repeats a negative eight times and has no next step -> hue-silhouette cards, one line "Send a hunter to the Meadow" with a button to the Map.
- [P2] "0 cards collected" in the header and "0/8" on every chip [32] -> "8 more in the Meadow", and show the fraction only once nonzero (spec: Positive framing).
- [P2] "Meadow 0 of 8 cards" [32] is the exact "X of N" form -> keep the "8 more cards to finish this set" line, drop the fraction.
- [P3] Back label is just "Back" [source] -> "Back to the map".

## Quests [33, p3:b-quests, b-quests-s1]

- [P2] "Resets at midnight" [33] is a countdown that implies loss; the catch-up bank is the real rule -> "Fresh ones tomorrow" (spec: Countdown copy never pressures; Days, no streaks).
- [P2] The "Claimed" pill [33] is a dark filled button on a greyed card. It looks like the most active thing on the screen -> a quiet stamp.
- [P2] A completed quest's progress bar is full dark ink [33] and looks like a loading bar -> a gold-filled bar, or hidden once claimed.
- [P2] "2 / 5", "0 / 3" counters and "0 / 3" on the weekly pill [33, p3:b-quests] -> "3 more upgrades" (spec: Positive framing, "2 more" never "8 of 10").
- [P2] The star icon for Seals is the reputation star [33, 02] -> its own mark, and a one-line explanation of Seals on first sight.
- [P2] "Swap" is 63 x 36 [p3:b-quests] and unclear ("reroll") -> "Try another" at 44 px.
- [P2] The event track [p3:b-quests-s1] is a horizontal strip that clips at step 4/5 at the edge with no cue -> same fix as Album tabs.
- [P3] Quest titles are bold Figtree while other cards use serif headings [33] -> consistent.
- [P3] "Reward: 150 Seals and a new wild hue to find." [p3:b-quests-s1] is good copy.
- [P3] The event note "points are saved, so there is never a rush" [p3:b-quests-s1] is the best tone in the app; reuse it for the Map and Ledger.

## Catalog [34, 39, 40, p2/p3 catalog]

- [P1] Catalog opens on the Autumn Harvest event page rather than the Wheel [34] -> open on the Wheel (or the page with the most progress) and make the event a visible separate chip (spec: Catalog structure; Endowed progress, the catalog opens with the three primaries filled). Known.
- [P1] Undiscovered event cells show the numbers 1 to 12 over pastel tiles and "at the event" under each [34] -> a faint hue-family silhouette with no number, and one line for the page ("Found during the event") (spec: Silhouettes of the missing). Numbers read as placeholder text. Known.
- [P1] The page tabs clip at the right edge: the fifth chip shows only "W" and "16 mo..." [34, p3:a-catalog] -> edge fade and scroll-snap, or two rows (spec: nothing clipped at 390). Known.
- [P2] "+0% income from your catalog now" [34] reads negative -> "Every 10 colors adds 2% income".
- [P2] Wheel cells repeat "by mixing" under every undiscovered cell [p2 catalog] and "by commission" with a number "3" / "20" / "22" [p3:a-catalog-s1] -> only the page hint, plus a tap for detail.
- [P2] Cell labels are about 10 to 11 px [34, p2 catalog] -> 12 px minimum, one line.
- [P2] Page chips are 38 px tall and the Era 2/3 "coming" tags are tag-styled `<button>`s that are 300 px wide [p3:a-catalog] -> 44 px, and a plain tag with no button semantics (UI-CONTRACT: "coming in a later update" paper tag).
- [P3] The "Autumn Harvest" row is in serif with "11 more to complete" in bold [34]; fine.
- [P3] The "6 colors in your swatch book" subtitle [34] is lovely; keep.

## Gallery (locked and open) [35, p2/p3 gallery, gallery-s1]

- [P2] The locked header says "Gallery Wing / Coming soon" [35] but the wing opens at 20 colors; "coming soon" suggests an unreleased feature -> "Opens at 20 colors - 14 more" in the header (spec: Locked things stay visible).
- [P2] The lock tag text "Opens at 20 colors with the Gallery Wing" is redundant [35] -> "Opens at 20 colors"; the separate bold "14 more colors to go" line is the right idea, keep it and style it under the tag.
- [P2] Tab highlight is Catalog here [35] (walk order); the door lives in the Workshop scene, so entering from the door should leave the Workshop tab lit, and the walk shows the rule is stack-based (spec: UX, Screens).
- [P2] "0 of 4 walls" [p3:b-gallery] -> "4 walls ready to fill".
- [P2] "Start painting" is 146 x 36 [p3:b-gallery-s1] -> 44.
- [P3] "Visitors love greens this week" with a green dot [p3:b-gallery] is warm, good.
- [P3] The four "Empty wall / Paint one" boxes are dashed frames, which read as placeholders [p3:b-gallery] -> a soft hung-frame shadow.

## Paint [p3:b-paint]

- [P2] "Uses 1 jars a pane" [p3:b-paint] has a plural bug -> "Uses 1 jar a pane".
- [P2] The header "0 painted, 16 to go" [p3:b-paint] -> "16 panes to fill".
- [P2] Undo (62 x 36), Save image (109 x 36), the family chips (32 px tall) and the pane hit areas (42 x 42) are all under 44 [p3:b-paint].
- [P2] The "Sign" button at the top right is grey and disabled with no hint why [p3:b-paint] -> "Sign when every pane is painted" tag.
- [P3] The suggested chip strip clips "Neutrals" at the edge [p3:b-paint] -> fade.
- [P3] The frame is the biggest, best-looking element in the app; it needs nothing.

## Shelf [11, 12, 36, p2/p3 shelf]

- [P1] "The shelf is full. Merge or sell to make room." [36] is in the title position and reads as an error; "0 free spots of 35" repeats it -> "A full shelf: merge a pair to make room" under a normal title (spec: Positive framing; Open loops, a bottle one merge from an urn).
- [P1] The row-label buttons at the right of every shelf row [11, 12, 36] are an unlabeled ring/cog icon, 34 x 44 [p3:b-shelf]. They look like loading spinners or settings -> a labeled tag or tooltip on first view, a simple paper "label" glyph (spec: Small tricks, sorting touch).
- [P2] "0 none yet" with a star [11, 36] is cryptic -> name it ("Essence 0 - a Cask earns one").
- [P2] Opening the shelf from Orders keeps Orders lit and the back label is a fixed "Back to the workshop" [source: shelf.js:161] while back goes to Orders. Known.
- [P2] "Next vial in 9 m 2 s" [11] is a seconds-ticking countdown -> minutes only, or "A new vial soon".
- [P2] "Expand to 6 x 9 for 50K" [11, p3:b-shelf] is a wide grey button that looks disabled and reads as a "not yet" -> a quiet tag "50K to expand" with goal gradient (spec: Locked things stay visible).
- [P2] On the locked state [p2 shelf], "The shelf is waiting for its first colors" plus the "Opens at 5 colors" tag and a separate "2 more colors" bold line is the right idea but split across two styles -> one tag line.
- [P3] The seeded first drop works, but the 2% breathing merge hint is not visible in the stills [11] -> check.
- [P3] The shelf title is serif and the subtitle "Drag or tap two matching containers" is a good instruction.

## Heritage [37]

- [P2] "Opens in Phase 3" on Renovate [37] -> the real goal in a paper tag, plus the "N more" line (same fix as Orders).
- [P2] "Level 0 of 5" and "Level 0 of 3" [37] -> "5 levels to grow".
- [P2] The full Heritage tree is shown with five disabled wide "Buy" buttons before Renovate is possible [37, p3:b-heritage]; the buttons are 330 x 36 -> collapse to one preview and enable at 44 px.
- [P2] Tab highlight is Catalog [37] (walk), but Heritage is a workshop/Renovate screen.
- [P3] "0 earned in all. Each Heritage adds +5% ..." [37] is clear and kind.
- [P3] Card titles ("Deep Pockets", "Spare Vats") are in serif and are names; good.

## Settings [38, p3:b-settings]

- [P2] Switches are 52 x 32, segmented options 38 high, the checkbox 24 x 24, "Check for updates" and "Reset..." 36 high [p3:b-settings] -> 44 (spec: Accessibility, 44 pt).
- [P3] "Follow phone" wraps to two lines in the Reduced motion control [38] -> "Auto".
- [P3] Section labels ("Feel", "Reading and playing", "Daily quests") are in serif [38] -> Figtree.
- [P3] Tab highlight is Catalog [38] (walk); from the gear it should stay on the current tab.

## Naming [p4 n1, 04, 39]

- [P3] The naming prompt (p4) is the best moment in the first minutes: swatch, name, "Joins the Wheel page, now 4 colors strong", "Keep this name" / "Name it yourself". Keep.
- [P3] "Name it yourself" is a flat secondary block button whose bottom edge looks cut off (same as "New board in my own colors") [p4 n1, 26] -> give secondary block buttons the full cut shadow.
- [P3] The walk shows the reveal [04, 39] with the card sitting mid-screen over a dimmed workshop and "Tap to continue"; the 1.5 s skippable timing is met. Good.
- [P3] On first discovery the naming prompt can stack behind other ceremonies when many colors land at once (seen when debug-discovering 25 colors). Cap the queue to one ceremony at a time and merge the rest into the Ledger.

## Phase beat [40, p2 gallery milestone]

- [P2] The fallback beat [40] reads "Something new / Continue" with no line of copy. It is what a bad param would show -> make the fallback say what changed, or never show it.
- [P3] A real beat [p2 gallery]: "20 colors in your catalog / +2% to all income, for good. Every 10 colors adds another 2%." It is warm and specific, but the all-caps kickers ("CATALOG MILESTONE", "A NEW COLOR") are the only all-caps style in the app; fine as a ceremony voice.
- [P3] The illustration (open book) [p2 gallery] is small and generic; fine.

## Onboarding and coach marks [01, 02, 06, 09, 10, 11, 15, 41, 42]

- [P1] The coach at [09] points at a disabled button and sits under two toasts: three overlays at once on the one screen that must teach upgrades -> show coach marks alone, and hold toasts until it is dismissed.
- [P2] The "Got it" button is about 64 x 36 [02, 06, 09] -> 44.
- [P2] The coach bubbles cover what they point at or what is next to it ([02] hides cards 2 and 3, [06] hides the Purify card, [09] hides the shelf and window) -> anchor to the free side.
- [P2] The first-ten-minutes beats 8:00 "Locked but visible: hunters' window and Gallery door" are in the source (coach steps 165, 167) but are not in the walk's screenshots (01 to 19) -> confirm they fire, and show them as paper tags, not extra bubbles.
- [P2] Welcome [01] has a lot of empty space below the button, and the scene stops at mid-screen -> center the block or extend the scene. The skip link is 13 px underlined text (a 44 px target) and fine.
- [P3] [42] shows the welcome overlay translucent over the live workshop at boot (a mid-fade frame) -> make it opaque from first paint so the "Make 0 jars/s" HUD never shows through.
- [P3] The coach text "A neighbor wants orange. Open the order and mix madder with ochre." [02] is specific and kind. The same warmth is missing from later steps ("Orders keep coming in...").
- [P3] A small arc under the window in the welcome art [01] reads as a frown -> remove or reshape.

## Toasts and modals [04, 05, 06, 07, 09, 15, 16, 19]

- [P2] Toasts are dark ink pills, not "small paper" toasts as UI-CONTRACT says, and they stack two deep over the screen head at 4 of the 5 screens in the first minutes [04, 05, 06, 07, 09]. The dark toast is the loudest UI element, louder than pigments (spec: Art direction, pigments are brightest; UI-CONTRACT, `ctx.toast` is paper).
- [P2] Toasts keep `pointer-events: auto` and sit over header controls ("Relaxed" at [07], the title at [05]) -> `pointer-events: none` except an explicit action, and place below the head.
- [P2] Two toasts say the same thing as the page ("Harbor Sunset joins your catalog", "A quest is ready to claim") -> collapse into one line, e.g. "Harbor Sunset joins your catalog. A quest is ready."
- [P3] The Close up shop sheet [16] offers both an "x" and "Not yet" -> keep one. "Your vats fill in about 15 h 24 m." is gentle; add "Your hunters head out too" once they exist.
- [P3] After closing, the only change is a brown banner "Shop closed. Vats fill in 15 h 24 m" above the tab bar [17]; the spec's lights-dim and shutters moment is not visible in the still -> verify the 1.5 s ceremony runs.

## Tab bar [all, 02, 06, 30, 34]

- [P1] The highlighted tab follows `stack[0]`, the screen she came from, not where the screen lives: Orders -> Shelf keeps Orders lit [source: router.js layout()], and Map -> Quests highlights Map though quests live on the Workshop calendar [33]. Known for the Shelf -> give screens a home tab (shelf/gallery/quests/settings/ledger -> Workshop, album/hunter -> Map) and light that (spec: UX, Screens; Art direction, tab matches where the screen lives).
- [P2] The bar hides inside the Orders and Puzzles children (matching, bench, commissions, grading, purify, packing) and during paint/naming/phase-beat [router FULLSCREEN_IDS], so one tap from home is lost -> keep the bar on non-input screens like the bench and commissions.
- [P3] Labels are 11 px [source: .tab], and the unselected tab text is the soft ink; the icons are clear and 44 high is met (72 px bar). Selected is a bold weight only -> add the icon fill as a second cue for colorblind and low-vision users.
- [P3] The Map attention dot exists in the router (tabDots) but never shows in any capture [30, p3:a-map] -> verify with a haul waiting.

---

## First ten minutes as a story

| Beat | What the screens show | Reads as |
| --- | --- | --- |
| Welcome [01] | A calm scene, "Open the shutters", a skip link | Good. The lower 45% is empty. |
| First orange [02, 03] | The board lands with four cards (three drab), a specific coach | Good coach; the drab cards undercut the delight. |
| Naming [04, p4 n1] | Reveal, then "Keep this name / Name it yourself" | Best beat in the game. |
| Result [05] | Empty page, one card, two toasts, one button | A dead end after the peak. Needs the result AND the way forward. |
| First board [06, 07, 08] | Puzzles coach, grading board, reveal | Works; toasts cover the head and the solved board is replaced by an empty state behind the modal. |
| Upgrades [09, 10] | Coach on a disabled grey button, "Needs 46" | The weakest beat; contradicts itself. |
| Shelf [11, 12] | Seeded merge chain, clear coach | Good. "Next vial in 9 m 2 s" and cryptic row icons. |
| Orders [13] | Board of drab cards, "The board is full" | Reads as an error and as mud. |
| Mill room [14] | "Open soon / 500" button, "5 more colors to open" in small text | Positive text in a button-shaped lock. |
| Close up [15, 16, 17] | Intro coach, sheet, brown banner | The ritual is quiet; the dim/shutters moment is missing in the stills. |
| Return [18, 19] | Ledger with produced lines, Almost there, stamp | The stamp covers copy; "Seals" appears unexplained. |

The story is there. It breaks at four points: the result page, the upgrade coach, the stacked toasts, and the locked previews that do not speak in the "N more" voice.

---

## Top 12 by impact

1. **The result and the way forward.** The post-order page is an empty page with one card and a single "Back to orders" [05]; the grading solve, hunter return and purify lands show the same pattern. Every action should land on the result AND the next step (peak-end, open loops).
2. **Locks that are not paper tags, and that name no goal.** "Opens in Phase 3" in a button-like card (Orders [13], Commissions [25], Heritage [37]), "Open soon 500" [14], "Later on" [20], "Coming soon" [35], "That hunter has not joined yet" [31]. Use one tag shape that names the goal in the "N more" voice.
3. **Negative-framing sweep.** "Needs 46" [09], "The board is full" [22], "The shelf is full" [36], "0 of N" (walls, album, commissions, level, team), "Not found yet" x8 [32], "none yet", "+0% income", "Resets at midnight". Each has a positive rewrite above.
4. **Catalog first impression.** It opens on the event page; undiscovered cells show numbers 1 to 12 and "at the event" [34]; tabs clip.
5. **The first-session upgrade beat.** A coach pointing at a disabled grey button under two toasts [09]. This is where the idle loop is taught.
6. **Toast pile-up.** Dark ink pills stacked over the screen head in [04 to 09] covering the title and header controls, repeating what the page says.
7. **Tab highlight and back labels follow the route, not the screen's home.** Orders -> Shelf keeps Orders lit; labels are fixed strings; Quests from the Map lights Map.
8. **Tap targets under 44.** About 36 px for every small button (Rush, Hire, Swap, Deliver, Sell, Start painting, Track, Album, Undo, Save image, Got it), 32 to 38 for chips and segmented controls, 34 x 44 row labels, 52 x 32 switches, a 24 px checkbox.
9. **Drab, duplicated order board.** Olive and taupe targets and the same customer twice [22]. Known.
10. **Strips that clip at the right edge with no cue.** Catalog tabs [34], Album tabs [32], the event track [p3:b-quests-s1], paint families; and the Store tile "Full in 15h 24r" [09].
11. **Ticking second-level countdowns.** "Next order in 8 m 50 s" [13], "Next vial in 9 m 2 s" [11], "Full in 43m 5s" [20]. The map's "opens soon" voice is the model.
12. **Dead-end empty states and mystery marks.** Purify, Packing, Puzzles cards with no button [26, 28, 29]; the shelf's ring icons [36]; one star icon for reputation, Seals, essence and new colors; "4 by 5", unit-less rewards, fractional coins ("Pays 2 to 4.3"). Along with serif used for section headings rather than names only.
