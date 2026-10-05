# Puzzle, Match & Merge Games UX Guide

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Scope

This guide covers match-3, match-4, swap puzzles, blast puzzles, merge games, block-placement games, tile-clearing games, and other board-centric mobile games.

These genres are especially vulnerable to bad automation because agents often make boards too small in **cell count** in order to make each piece visually enormous. That can reduce strategic space, blocker variety, special-piece interactions, and the spectacle of cascades.

## 2. Treat the board as one interaction surface

A grid is not a set of isolated buttons floating in empty space. It is one continuous spatial surface divided into cells.

Hit testing should generally resolve the touch to a cell even if the artwork occupies only part of that cell.

Recommended implementation:

1. Convert pointer coordinates into board-local coordinates.
2. Determine the source cell from those coordinates.
3. Track motion after a small jitter threshold.
4. Infer a dominant direction.
5. Resolve the intended neighbor or drag destination.
6. Show visual preview before final commitment when useful.

This approach makes dense grids practical without requiring every gem, fruit, tile, or token to behave like a 44-point UI button.

## 3. Grid size should be a game-design decision

Choose board dimensions based on:

- desired strategic possibility;
- blocker geometry;
- cascade length;
- special-piece footprint;
- level goals;
- portrait/landscape composition;
- smallest supported screen;
- demonstrated interaction reliability.

Do not impose a universal maximum like “7×7 on phone.” Many successful puzzle games use denser boards because the interaction model supports them.

A board is too dense when real players cannot reliably distinguish or manipulate the intended cells — not when an abstract size rule is crossed.

## 4. Use the entire cell as the target

Artwork can breathe inside the cell while the entire cell remains interactive.

Good dense-board practices:

- no interaction dead zones between adjacent cells;
- slightly enlarged board bounds at outer edges;
- nearest-cell resolution for borderline taps;
- forgiving drag paths;
- optional magnetic resolution toward legal neighbors;
- stable source selection so the selected tile does not flicker as the finger drifts.

### 4.1 Design explicitly for finger occlusion and boundary ambiguity

Dense boards should acknowledge that the finger can obscure the selected object and that touch location has systematic error. The response is **not automatically larger cells**; it is an interaction model that makes the game’s interpretation visible and correctable.

For swipe puzzles:

- visually acknowledge the source cell immediately;
- lock the source after a small motion threshold so it does not flicker across boundaries;
- infer intent primarily from the dominant swipe vector once the threshold is crossed;
- tolerate diagonal drift rather than requiring a line through the destination center;
- animate toward the inferred neighbor before final commitment when that preview helps.

For drag-and-merge play:

- render the picked-up object offset above or beside the finger;
- preview legal merge partners or destinations;
- use magnetic resolution toward a legal destination when the drop is close;
- keep the original cell or shadow visible so the source remains understandable;
- consider zoom or magnification only when the interaction remains ambiguous after simpler techniques.

Research on touch behavior shows that touch positions can be systematically biased and that compensation can reduce error. Treat intent inference as a legitimate engineering tool, but **validate the resulting interaction with humans on physical devices**.

## 5. Swipe-to-swap is information-rich

A swipe conveys both **source** and **direction**. That makes it more robust than requiring two tiny taps.

For swap games:

- establish the source cell on touch-down;
- wait for a small directional threshold;
- choose the dominant axis/direction;
- preview the swap early;
- commit once the gesture is unambiguous;
- allow some cross-axis drift;
- snap back quickly on invalid moves.

Avoid demanding that the finger physically land in the exact center of the destination cell.

## 6. Selection feedback should happen before the move resolves

When the player touches or begins to drag:

- lift or scale the tile subtly;
- shift it toward the intended neighbor;
- brighten the destination;
- add a soft audio cue;
- optionally use light haptics for confirmed special interactions.

The player should understand which tile the game thinks they are moving before the final result.

## 7. The board must remain readable during spectacle

Cascades and special-piece combinations are a major source of pleasure, but readability matters.

Use a hierarchy:

1. Show the player’s initiating action.
2. Show the immediate consequence.
3. Allow chained effects to escalate.
4. Settle the board cleanly before expecting another decision.

Do not let particles, score text, screen shake, and booster effects hide the cells that determine the next state.

## 8. Special pieces need consistent visual grammar

A player should be able to predict broad behavior from appearance.

Examples of dimensions you can encode consistently:

- line direction;
- area radius;
- color affinity;
- rarity/power level;
- charged versus ready state;
- movable versus fixed.

Avoid creating a dozen special pieces that all use unrelated visual languages.

## 9. Merging boosters should reward experimentation

When two boosters can interact, the combination should feel intentionally designed rather than like two effects merely firing sequentially.

For each booster pair, define:

- what the combined effect is;
- whether order matters;
- the visual anticipation cue;
- the animation hierarchy;
- how the result is communicated before or during activation;
- whether the combination creates a unique tactical use.

If two rakes merge, for example, the result should have a legible combined identity — such as clearing a larger cross, multiple rows/columns, or a board-sweeping pattern — rather than simply playing rake A and then rake B with no special payoff.

## 10. Blockers should change decisions, not only add hit points

Strong blockers alter how the player thinks:

- restrict movement;
- occupy space;
- spread;
- require adjacency;
- respond to specific special pieces;
- create channels or islands;
- alter gravity;
- transform after being hit;
- protect or hide other objects.

Introduce them one at a time before combining them heavily.

## 11. Goals must be legible on the board

If the level goal is “collect carrots,” the player should be able to see which carrots count and how they are collected. If the goal is “clear moss,” moss should be visually distinct from decorative ground.

The objective panel should summarize. The board should explain.

## 12. Hints should teach patterns, not play the whole game

A hint can:

- pulse a legal move after inactivity;
- prioritize a move relevant to the current objective;
- avoid repeatedly suggesting strategically terrible moves;
- disappear immediately when the player acts.

For deeper puzzle games, consider a hint ladder:

1. indicate an area;
2. indicate a source tile;
3. show the exact move only if requested or after extended inactivity.

## 13. Loss should return the player to play quickly

For unlimited-replay games, failure should be a learning event, not an administrative punishment.

A good loss flow:

- clearly show why the attempt ended;
- preserve the level goal in memory;
- offer a fast retry;
- keep optional boosters secondary;
- avoid multiple monetization-style interruptions if the game is not built around them.

## 14. Difficulty should expand the decision space gradually

Difficulty can increase through:

- blocker combinations;
- tighter objectives;
- unusual board shapes;
- constrained movement;
- altered gravity;
- special-piece planning;
- turn limits;
- sequencing requirements.

Do not rely only on reducing move counts until luck dominates.

## 15. Portrait-board composition

Use screen space intentionally:

- board gets priority;
- objectives and move count stay concise;
- boosters remain reachable but do not steal board area;
- bottom controls can approach the bottom safe area without leaving a visually awkward empty band;
- top status should not float unnecessarily high if it disconnects from the board;
- level-end overlays should preserve a glimpse of the board when the final state matters emotionally.

## 16. Merge-game specifics

Merge games need extra support for dense object fields.

Use:

- strong selected-object state;
- target preview for valid merge partners;
- drag pickup offset so the finger does not fully cover the object;
- automatic placement into the nearest legal open space when the drop is close;
- clear distinction between move, merge, sell, and delete actions;
- undo when accidental merges would be unusually costly and the economy permits it.

## 17. Puzzle engagement principles

Players stay engaged when:

- early moves feel productive;
- levels have recognizable identities;
- new blockers create new thought patterns;
- special-piece combinations produce satisfying peaks;
- failures feel close enough to invite another attempt;
- the board state remains comprehensible even during cascades;
- long sessions remain valid rather than being artificially gated.

## 18. Agent implementation rules

An agent must not:

- cap the grid solely to satisfy a generic UI target dimension;
- leave dead gaps between visual tiles and hit areas;
- require precise destination-center swipes;
- over-animate every ordinary match until play becomes slow;
- introduce multiple blockers without a clean learning progression;
- make booster combinations visually indistinguishable from separate activations.

An agent should:

- instrument wrong-source selections, wrong-destination selections, rejected gestures, and invalid input rates;
- test on the smallest supported phone;
- preserve board size while improving input inference first;
- inspect screenshots for board dominance and wasted vertical space;
- ensure every special piece has a consistent visual and behavioral grammar.

## 19. Puzzle UX review checklist

- [ ] Board dimensions serve the game design, not an arbitrary control-size rule.
- [ ] Every touch on the board resolves predictably to a cell or object.
- [ ] Swipes tolerate natural finger drift.
- [ ] Source selection remains understandable even when the finger covers the artwork.
- [ ] Dragged merge objects use offset/preview/magnetism when occlusion would otherwise hide intent.
- [ ] Source and destination feedback appear before commitment.
- [ ] Cascades remain readable.
- [ ] Goals can be understood from the board state.
- [ ] Special pieces are visually distinguishable at a glance.
- [ ] Booster combinations have unique, legible payoffs.
- [ ] Failure returns the player to a retry quickly.
- [ ] The board receives more screen priority than peripheral UI.

## Selected references

- Holz & Baudisch, **Understanding Touch (CHI 2011)**: https://hpi.de/baudisch/projects/understanding-touch.html
- Henze, Rukzio & Boll, **100,000,000 taps: analysis and improvement of touch performance in the large**: https://research.lancaster-university.uk/en/publications/100000000-taps-analysis-and-improvement-of-touch-performance-in-t/
- Apple Human Interface Guidelines, **Game controls**: https://developer.apple.com/design/human-interface-guidelines/game-controls

- Apple, **Make your game great with touch (WWDC26)**: https://developer.apple.com/videos/play/wwdc2026/358/
- Apple, **Design advanced games for Apple platforms (WWDC24)**: https://developer.apple.com/videos/play/wwdc2024/10085/
- Android Developers, **Make apps more accessible**: https://developer.android.com/guide/topics/ui/accessibility/apps
