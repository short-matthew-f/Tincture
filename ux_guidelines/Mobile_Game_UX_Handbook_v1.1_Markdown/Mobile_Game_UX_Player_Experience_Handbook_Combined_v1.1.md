# Mobile Game UX & Player Experience Handbook

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## What this series is

This is a practical handbook for making mobile games that are easy to understand, comfortable to operate, deep without being overwhelming, and memorable enough that players want to return.

The series deliberately separates **universal interaction principles** from **genre-specific application**. It also separates **engagement design** from **usability design**. A game can be usable but forgettable; engaging but exhausting; deep but incomprehensible. The goal is to avoid all three failures.

The documents are written as working standards rather than essays. Each contains implementation rules, exceptions, failure modes, and review checklists that can be handed directly to a development agent.

## The document set

1. **Mobile Game UI/UX Foundations** — universal interaction, layout, navigation, touch, feedback, accessibility, responsive-screen principles, and player-facing failure states.
2. **Engagement, Progression & Memorable Experience Design** — how to create desire, curiosity, mastery, satisfying progress, memorable moments, and meaningful ritual without relying on pressure or chore loops.
3. **Managing Depth Without Overwhelming the Player** — progressive disclosure, complexity budgets, information architecture, unlock pacing, currencies, inventories, upgrade trees, and expert layers.
4. **Puzzle, Match & Merge Games UX Guide** — dense boards, grid interaction, touch occlusion, gestures, special pieces, blockers, cascades, level flow, boosters, hints, and readable spectacle.
5. **Idle, Incremental & Management Games UX Guide** — large numbers, bottlenecks, dashboards, upgrades, optional automation, offline progress, prestige, and avoiding spreadsheet fatigue.
6. **Cozy, Life-Sim & Collection Games UX Guide** — direct manipulation, gardens, kitchens, decorating, collection, comforting ritual, low-pressure progression, and world-as-interface design.
7. **Action, Arcade, Runner & Roguelike Mobile UX Guide** — thumb ergonomics, intentional execution skill, optional assists, HUD restraint, combat readability, telegraphs, death/retry flow, and between-run choices.
8. **Mobile Game UX Evaluation & Playtest Handbook** — evidence levels, screenshot audits, first-session testing, dense-input fuzzing, human testing, device checks, instrumentation, severity scoring, and release gates.
9. **Mobile Game Accessibility & Adaptive Play** — perceivability, alternative inputs, timing, motion, audio/visual/haptic redundancy, assist modes, menu semantics, and accessibility testing.
10. **Commercial, Live-Service & Connected UX** — a deliberately versioned companion for purchases, randomized rewards, timers, network loss, transaction states, cloud saves, live events, and player trust.

## How to use the series

For any project, read Documents **1–3** first. Then read the genre guide closest to the core play pattern. Use Documents **8 and 9** throughout development rather than only at the end.

Use Document **10** whenever the game contains purchases, premium currencies, online dependencies, cloud state, live events, or other connected-service surfaces. It is intentionally versioned because platform rules and regulations change faster than the evergreen interaction doctrine.

Hybrid games should use multiple genre guides. A cozy game with a match-3 subgame, for example, should use Documents 1–4, 6, 8, and 9; add Document 10 if it contains connected or commercial systems.

## Core doctrine

The series is built around eight high-level rules:

1. **Reliability matters more than nominal dimensions.** Touch-target recommendations are strong defaults for ordinary UI controls, not automatic limits on dense gameplay. Use spatial partitioning, larger invisible hit regions, gesture intent, snapping, pickup offsets, hysteresis, and error recovery — then validate the result on real devices and with real players.
2. **Preserve intentional difficulty; remove accidental input difficulty.** If precision is the game, preserve it. If precision is merely a side effect of flat-glass controls, compensate for it.
3. **Depth should come from systems interacting, not from everything being visible at once.**
4. **The world should do as much interface work as possible.** When players can touch, drag, place, observe, or recognize something directly, do not route them through unnecessary menus.
5. **Every screen should have a dominant purpose.** Secondary functions may exist, but they should not compete equally for attention.
6. **Engagement should primarily come from desire, curiosity, mastery, expression, anticipation, and meaningful ritual — not anxiety, punishment, or reward bureaucracy.**
7. **Accessibility means multiple viable ways to perceive and operate the game, not simply making every object larger.**
8. **Evidence outranks theory.** Automated checks, scripted interaction, input fuzzing, device tests, observed human play, and production telemetry answer different questions. Do not call a design “human-validated” unless humans actually used it.

## Inheritance rule

Genre documents may adapt a general principle to fit the genre, but they should not silently contradict it. If a genre requires an exception, the exception should be explicit and justified by the interaction model.

## Agent reading instruction

When using these documents with an AI development agent, give the agent the relevant documents and instruct it to:

- treat them as constraints and review criteria, not merely inspiration;
- explain any deliberate deviation before implementing it;
- test dense gameplay interactions instead of shrinking the game to satisfy generic UI heuristics;
- distinguish static inspection, scripted tests, input fuzzing, physical-device verification, observed human testing, and production telemetry in its reports;
- never claim a scripted test proves human comfort or comprehension;
- capture screenshots and perform interaction audits after major UI changes;
- prioritize the player’s ability to understand and operate the game over adherence to a particular visual template.

## Suggested project workflow

| Phase | Documents to use most |
|---|---|
| Concept / systems | 1, 2, 3 + genre guide + 9 |
| First playable | 1 + genre guide + 8 + 9 |
| Onboarding | 1, 2, 3, 8, 9 |
| Progression | 2, 3 + genre guide |
| UI expansion | 1, 3, 8, 9 |
| Connected / commercial systems | 1, 2, 8, 9, 10 |
| Polish / release | 1 + genre guide + 8 + 9 |


# Mobile Game UI/UX Foundations

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Purpose

This document defines universal UI/UX principles for mobile games. It applies to menus, HUDs, gameplay surfaces, onboarding, inventories, shops, maps, settings, overlays, and direct manipulation of game objects.

The aim is not minimalism for its own sake. The aim is **high capability with low friction**.

## 2. The central distinction: UI controls versus gameplay interaction

Mobile design guidance often recommends large touch targets. That guidance is valuable, but agents frequently misuse it by treating every interactive game object as if it were an isolated settings button.

A game contains several different classes of interaction, and they should not all be designed the same way.

| Interaction class | Examples | Default treatment |
|---|---|---|
| Critical UI | purchase, delete, irreversible choice | large, separated, deliberate, often confirmed |
| Routine UI | back, inventory, pause, tab | comfortable platform-style target, consistent placement |
| Gameplay control | attack, jump, ability, virtual stick | ergonomic, forgiving, reachable, sized by frequency and attention demands |
| Direct game object | match tile, card, crop, unit, ingredient | may be visually smaller if the whole interaction surface, gesture model, snapping, or intent inference makes selection reliable |

### 2.1 Touch-target guidance is not a layout mandate

Platform touch-target recommendations are strong defaults for **discrete controls** such as Back, Pause, Buy, Delete, tabs, settings, and toolbar actions. They should not automatically determine the size of every game tile, card, map node, crop, or unit.

A match board is usually one continuous interactive surface divided into cells. An initial touch plus a directional swipe may provide enough information to infer the intended move even when each visual tile is smaller than a conventional UI button. A merge board can float the picked-up object away from the finger and preview legal destinations. A strategy map can expand invisible hit regions or snap to the nearest valid unit.

Therefore:

> **Optimize interaction reliability, not nominal target dimensions.**

A gameplay element may be visually smaller when all of the following are true:

- the player can distinguish the object or cell before touching it;
- the interaction surface has little or no meaningless dead space;
- the game can resolve intent using cell boundaries, nearest-object logic, gesture direction, snapping, hysteresis, pickup offsets, or contextual rules;
- errors are inexpensive, obvious, and quickly reversible;
- expensive or destructive actions receive stronger protection than routine gameplay actions;
- the interaction has been tested on the smallest supported physical device, not only inferred from layout math;
- an alternative interaction or assist is considered when precision would otherwise exclude players.

Do **not** reduce a strategic board from, for example, 9×9 to 7×7 solely because an agent believes each tile must independently satisfy a conventional button target. First test whether the larger grid can be operated reliably with full-cell hit testing and intent-aware input.

### 2.2 Occlusion and touch error are real variables, not automatic vetoes

Finger occlusion and systematic touch bias are well-established interaction problems. Research such as Holz and Baudisch’s *Understanding Touch* and Henze, Rukzio, and Boll’s large-scale *100,000,000 taps* study shows that touch errors are patterned rather than purely random; the latter found that a compensation function reduced observed error rate by 7.79% in a large field experiment.

This supports two simultaneous conclusions:

1. dense touch interaction deserves deliberate compensation; and
2. the existence of touch imprecision does **not** imply that every game object must become a large isolated button.

Use the least intrusive technique that makes intent legible. Options include source highlighting before commitment, source locking after a short threshold, offset rendering during drag, target previews, magnetic destination resolution, camera zoom, or — when truly necessary — magnification. A loupe is one tool, not a universal requirement.

Use the phrase **“mitigate, then validate.”** Never claim occlusion is “solved” merely because snapping exists.

## 3. Every screen needs a dominant purpose

Finish the sentence:

> “The purpose of this screen is to ______.”

If the answer requires several unrelated clauses, the screen is probably trying to do too much.

A screen may expose secondary actions, but one task or one group of closely related tasks should dominate visual hierarchy. This reduces decision friction without reducing the underlying game’s depth.

### 3.1 Primary action hierarchy

Use visual weight intentionally:

- one strongest action or focal object;
- a small number of secondary actions;
- quiet persistent information;
- advanced or infrequent utilities that appear when needed.

Avoid screens in which every button glows, pulses, carries a badge, or competes with the core activity.

## 4. The three-second comprehension test

During normal play, a returning player should usually be able to answer quickly:

1. Where am I?
2. What can I do here?
3. What should I probably do next?

This does **not** mean every screen needs an arrow, tutorial label, or quest marker. Layout, animation, state changes, affordances, and world composition should answer these questions whenever possible.

## 5. Prefer direct manipulation

When the player wants to act on a game-world object, first ask whether they can act on the object itself.

Prefer:

- tap the crop to inspect it;
- drag the carrot to the cutting board;
- swipe the tile toward its neighbor;
- drag furniture in the room;
- touch the unit on the map;

before:

- open edit mode;
- select category;
- select object;
- select action;
- confirm action.

Menus remain appropriate for abstract or global tasks, but they should not replace physical interaction merely because menus are easier to implement.

## 6. Make touch forgiving

Touch is imprecise. Design around that fact instead of demanding mouse-like accuracy.

Useful techniques include:

- invisible hit regions larger than artwork;
- nearest-valid-target selection;
- snapping to cells or sockets;
- hysteresis so selection does not flicker at boundaries;
- small motion thresholds before interpreting drag direction;
- gesture slop that allows the finger to drift outside the source object;
- magnetic placement for valid destinations;
- brief reversible previews before committing expensive actions;
- safe handling of invalid drops or swaps.

### 6.1 Error cost should influence target design

A destructive or expensive action needs more protection than a low-cost gameplay selection.

Mis-selecting a match-3 tile for a fraction of a second is not comparable to deleting a save or spending premium currency. Treating them identically makes games unnecessarily coarse.

## 7. Input should acknowledge the player immediately

The player should never wonder whether a touch registered.

Feedback can include:

- press or lift state;
- subtle scale or positional response;
- drag tether or shadow;
- sound;
- haptic feedback for meaningful events;
- target highlighting;
- particles or deformation;
- a quick invalid-action response when appropriate.

The first feedback should be fast. Longer animations may follow, but the initial acknowledgement should feel immediate.

## 8. Animation communicates state, not merely decoration

Use animation to explain:

- where an object came from;
- where it went;
- why a value changed;
- which object caused an effect;
- whether an action succeeded, failed, or is waiting;
- what changed after an upgrade.

Avoid transitions that delay repeated actions without adding comprehension or pleasure. Repeated utility flows should become faster with familiarity.

## 9. Navigation should be shallow and stable

Players build spatial memory quickly. Preserve it.

- Keep Back/Close behavior consistent.
- Avoid changing the location of the same action between related screens.
- Avoid deep menu trees for frequently used functions.
- Keep important state when players leave and return to a screen.
- Prefer contextual overlays or drawers to teleporting the player into unrelated menu stacks when context matters.

A useful warning sign is a routine action that requires **three or more menu transitions** before the player can act.

## 10. Preserve context

If the player asks about a tomato, show information near the tomato or within the garden when practical. If they upgrade a tower, keep the tower visible. If they compare equipment, preserve the comparison state.

Context reduces memory burden and makes the game feel spatially coherent.

## 11. Responsive layout: adapt composition, not merely scale

Do not create one interface and scale the whole thing proportionally across devices. This can make controls too large on some devices and too small or unreachable on others.

Instead:

- anchor related control groups to meaningful edges or corners;
- preserve physical comfort for high-frequency controls;
- let gameplay camera framing absorb aspect-ratio differences when possible;
- use safe areas for controls that must remain unobscured;
- allow environment art to extend beyond safe areas;
- test narrow, tall, wide, and tablet layouts separately.

Apple’s game guidance specifically recommends using safe areas for critical UI while still taking advantage of the full screen for the game world.

## 12. Thumb reach and action frequency

For games commonly held in two hands:

- put frequent actions near natural thumb zones;
- place less frequent controls toward the top or center edges;
- avoid requiring the same thumb to hold one control while accurately triggering another nearby control;
- consider simultaneous-input requirements, not only individual reach.

For portrait games, explicitly test one-handed use if the genre plausibly invites it.

## 13. Text and iconography

Text should explain what visuals cannot.

- Prefer verbs for actions: “Plant,” “Cook,” “Upgrade.”
- Prefer numbers with meaning over unexplained symbols.
- Do not rely on color alone to communicate critical state.
- Use icons consistently; if an icon’s meaning changes by context, update it visibly.
- Avoid paragraphs during active play.
- Localize layouts, not only strings; translated text can be longer.

## 14. Progressive disclosure belongs in the interface

Do not show expert controls merely because they exist.

Show:

- what the player needs now;
- what they use frequently;
- what helps them understand current choices.

Reveal advanced systems as the player reaches them. Nielsen Norman Group’s progressive-disclosure guidance is useful here: prioritize common actions and defer specialized options while making the path to those options discoverable.

## 15. Recognition beats recall

Players should not need to remember information from another screen to make a current decision.

Examples:

- show an upgrade’s current value beside the prospective value;
- show recipe ingredients while the player gathers them;
- show equipment comparisons side-by-side;
- show what a blocker does near the first level where it appears;
- show the source of a resource when the player taps its icon.

## 16. Accessibility is part of game design

Accessibility is broader than contrast and color-blind differentiation. A robust mobile game asks whether important information can be **perceived**, whether required actions can be **performed**, whether timing and cognitive demands can be **adapted**, and whether the player can personalize the experience without losing the game’s intended identity.

Consider:

- text size and legibility;
- contrast and non-color state cues;
- captions and visual alternatives for meaningful audio;
- audio or haptic alternatives for information communicated visually where appropriate;
- reduced motion, reduced flashes, and screen-shake controls;
- remapping, alternate control schemes, hold-versus-toggle options, and handedness;
- adjustable sensitivity, timing windows, game speed, or assist modes when these do not erase the intended mastery dimension;
- pause support where the game permits it;
- screen-reader semantics and logical focus order for menus and non-gameplay UI;
- alternatives for precision gestures when practical.

Apple’s accessibility guidance emphasizes that information should not rely on a single sensory channel and specifically recommends visual alternatives for important audio cues, haptic reinforcement, adequately sized ordinary controls, and game difficulty accommodations. Microsoft’s Xbox Accessibility Guidelines similarly emphasize alternative inputs, remapping, control assistance, timing accommodations, and configurable difficulty.

Accessibility should expand the set of viable interaction methods rather than forcing every game into one oversized visual template. See **Document 9: Mobile Game Accessibility & Adaptive Play** for the full standard.

## 17. Do not make the player administer the game

Watch for ritualized friction:

- claim reward;
- dismiss popup;
- clear badge;
- open mission tab;
- claim three missions;
- open event tab;
- acknowledge another reward;
- finally play.

Administrative actions should exist only when they create understanding, choice, anticipation, or pleasure.

## 18. Failure and recovery states are UX

Networking architecture, synchronization algorithms, and payment backends belong in engineering standards. **What the player experiences when those systems fail belongs in UX.**

For latency, disconnects, interrupted transactions, cloud conflicts, or service outages, the player should be able to answer:

- What is happening?
- Is my progress safe?
- Did my purchase or action complete?
- Can I continue offline?
- Should I retry, wait, or choose between versions?
- Will retrying create a duplicate action?

Prefer preserving the player’s current context and clearly labeling pending, offline, retrying, restored, or failed states. Do not convert a temporary service problem into apparent progress loss or ambiguous double-spend risk.

Detailed purchase, live-service, and connected-system guidance belongs in **Document 10: Commercial, Live-Service & Connected UX**, which is intentionally versioned more frequently than this foundation.

## 19. Performance is UX

Dropped frames, delayed input, stutters, long blocking loads, and hitches during feedback all damage perceived responsiveness.

Prioritize stable interaction performance over ornamental effects. If necessary, degrade particles, post-processing, or background animation before allowing input latency to become inconsistent.

## 20. Agent implementation rules

An implementation agent must not:

- impose a fixed maximum grid size solely from generic touch-target guidance;
- enlarge every element until the game loses useful density;
- route direct interactions through menus because menus are simpler to code;
- hide core actions in hamburger menus merely to make the screen visually clean;
- add tutorial text before attempting to teach through interaction;
- use confirmation dialogs for harmless routine actions;
- make every reward, notification, and secondary system compete visually at once.

An agent should instead:

- test the intended interaction at the desired density;
- improve hit testing and gesture interpretation before sacrificing game structure;
- use screenshot review and physical-device testing;
- document any place where a smaller or denser interaction is deliberate and how reliability is maintained;
- label evidence accurately: scripted success is not the same thing as observed human usability;
- design understandable pending/offline/retry states whenever the feature depends on a network or transaction.

## 21. Foundation review checklist

Before accepting a screen or interaction, verify:

- [ ] The screen has a clear dominant purpose.
- [ ] The player can identify the next likely action without reading a manual.
- [ ] Frequent actions are easy to reach.
- [ ] Critical actions are protected from accidental activation.
- [ ] Gameplay objects use forgiving hit testing where appropriate.
- [ ] Dense gameplay has been tested rather than rejected by rule of thumb.
- [ ] Touch receives immediate feedback.
- [ ] Navigation is shallow and predictable.
- [ ] Important state remains visible when choices depend on it.
- [ ] The layout works on the smallest supported device.
- [ ] Safe areas protect controls without unnecessarily shrinking the game world.
- [ ] Color is not the sole carrier of critical information.
- [ ] The player is not forced through avoidable administrative steps.
- [ ] Failure, offline, pending, or retry states are understandable when relevant.
- [ ] Repeated flows become faster, not slower, with familiarity.

## Selected references

- Holz & Baudisch, **Understanding Touch (CHI 2011)**: https://hpi.de/baudisch/projects/understanding-touch.html
- Henze, Rukzio & Boll, **100,000,000 taps: analysis and improvement of touch performance in the large**: https://research.lancaster-university.uk/en/publications/100000000-taps-analysis-and-improvement-of-touch-performance-in-t/
- Apple Human Interface Guidelines, **Accessibility**: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Microsoft, **Xbox Accessibility Guideline 107: Input**: https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107

- Apple, **Design advanced games for Apple platforms (WWDC24)** — mobile game control sizing, layout, safe areas, thumb placement: https://developer.apple.com/videos/play/wwdc2024/10085/
- Apple, **Make your game great with touch (WWDC26)** — touch-first layouts, direct interaction, contextual controls, feedback: https://developer.apple.com/videos/play/wwdc2026/358/
- Apple Human Interface Guidelines, **Menus**: https://developer.apple.com/design/human-interface-guidelines/menus
- Apple Human Interface Guidelines, **Gestures**: https://developer.apple.com/design/human-interface-guidelines/gestures
- Android Developers, **Make apps more accessible** — 48 dp focusable touch target guidance for UI elements: https://developer.android.com/guide/topics/ui/accessibility/apps
- Nielsen Norman Group, **Progressive Disclosure**: https://www.nngroup.com/articles/progressive-disclosure/
- Nielsen Norman Group, **Recognition Rather Than Recall**: https://www.nngroup.com/articles/recognition-and-recall/


# Engagement, Progression & Memorable Experience Design

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Purpose

This document addresses a different question from basic usability:

> Once a player can use the game comfortably, why do they care enough to keep playing — and what will they remember afterward?

Engagement should be treated as a product of **desire, curiosity, mastery, expression, anticipation, social meaning, and satisfying progress**. Retention metrics matter, but the goal is not to maximize compulsive checking at the expense of the experience.

## 2. A useful engagement model

A strong mobile game usually gives the player several overlapping reasons to continue:

- **Immediate pleasure:** the next action feels good.
- **Short-term goal:** the next few minutes have a clear purpose.
- **Medium-term aspiration:** the player can imagine what they are building toward.
- **Long-term identity or mastery:** the game increasingly reflects their skill, choices, collection, world, or personal expression.
- **Curiosity:** something unresolved remains interesting.

Do not rely on only one layer. A game with good long-term progression but dull moment-to-moment play becomes a chore. A game with satisfying taps but no aspiration can feel disposable.

## 3. The core loop must earn the progression system

Progression cannot permanently compensate for a weak primary activity.

Before adding missions, streaks, battle passes, daily gifts, collections, or prestige, ask:

- Would this action still be satisfying if no reward popup followed it?
- Does the player make a meaningful choice, express skill, enjoy tactile feedback, or witness an interesting transformation?
- Does repetition produce variation, mastery, or discovery?

If the answer is no, fix the loop before adding more reward scaffolding.

## 4. Progression should change the player’s possibilities

The weakest progression is purely numerical:

- +3% production;
- +5 damage;
- +100 coins;
- another bar filling slightly faster.

Numbers are useful, but memorable progression periodically creates **qualitative change**:

- a new area opens;
- a new interaction becomes possible;
- a character arrives;
- the player’s home visibly changes;
- a new special-piece interaction appears;
- automation removes an old burden;
- a new build archetype becomes viable;
- two systems begin affecting one another.

A practical progression rhythm alternates **power growth** with **possibility growth**.

## 5. Let the world remember what the player did

Persistent visual change is one of the strongest ways to make progress feel real.

Prefer visible consequences:

- the garden expands;
- shelves fill with collected objects;
- the market becomes busier;
- the tower gains visible attachments;
- the kitchen gets better tools;
- a repaired bridge stays repaired;
- NPCs react to prior events.

A progress bar says the player advanced. A changed world demonstrates it.

## 6. Create memory landmarks

Players tend to remember **distinctive events**, not a uniform stream of rewards.

Design periodic landmarks such as:

- the first surprising combo;
- a dramatic boss entrance;
- an absurdly large object;
- a character with a specific recurring behavior;
- a location that changes in a memorable way;
- a new mechanic introduced through an event rather than a menu;
- a visual or audio payoff that occurs only after meaningful buildup.

Ask during design reviews:

> “What will someone describe to a friend about this part of the game?”

If the answer is only numbers, the experience may lack identity.

## 7. Anticipation is often stronger than obligation

A healthy return hook sounds like:

- “I want to see what grows.”
- “I’m close to opening that room.”
- “I want one more run with this build.”
- “I wonder what that character was hinting at.”
- “I almost solved that level.”

A weaker return hook sounds like:

- “I’ll lose my streak.”
- “My energy will cap.”
- “The game is threatening to take something away.”

Timers and schedules can be useful, especially in idle and life-sim games, but they should create rhythm rather than anxiety wherever possible.

## 8. Design satisfying session endings

Mobile play is interrupted. A session should be easy to stop without feeling punished.

Good stopping points include:

- after a level;
- after harvesting a set of crops;
- after completing a recipe;
- after a run;
- after making one meaningful upgrade decision;
- after resolving a small story beat.

At the stopping point, give the player one clear future desire — not a wall of chores.

## 9. Use layered goals

At any time, a player may benefit from three horizons:

### Immediate
“Make this match.” “Chop this ingredient.” “Survive this wave.”

### Near-term
“Finish the level.” “Complete the dish.” “Reach the next checkpoint.”

### Aspirational
“Restore the greenhouse.” “Complete the set.” “Unlock the subclass.”

The interface should emphasize the horizon relevant to the current moment. Do not place all horizons at equal visual weight.

## 10. Reward choice, not just compliance

Rewards become more engaging when they produce a decision:

- choose one of three upgrades;
- decide where to place a new building;
- pick which crop to plant;
- select which booster to carry forward;
- choose between speed now and capacity later.

The choice does not need to be complicated. Even simple agency helps a reward feel owned rather than dispensed.

## 11. Randomness should create stories, not helplessness

Random rewards and procedural events can create surprise, but players should usually understand the boundaries.

Use randomness to create:

- varied opportunities;
- unexpected combinations;
- different run shapes;
- collectible moments;
- reasons to adapt.

Avoid letting randomness repeatedly erase long-term intent. Provide pity systems, rerolls, alternate acquisition paths, deterministic milestones, or conversion systems when a rare random outcome matters substantially.

## 12. Escalation needs contrast

If everything is spectacular, nothing feels spectacular.

Use quiet periods so peaks register. A dramatic booster combination is more exciting if ordinary moves are restrained. A major home renovation matters more if smaller changes came first. A boss arrival benefits from a calmer lead-in.

Engagement is partly rhythm.

## 13. Mastery needs readable causality

Players remain engaged when they can improve.

They need to understand:

- what they did;
- what happened;
- why it happened;
- what they might do differently next time.

If success feels random or failure feels opaque, mastery stalls.

For every important system, make cause and effect visible through animation, numbers, state changes, logs, comparison views, or consistent rules.

## 14. Avoid choreification while preserving meaningful ritual

Repetition is not automatically bad UX. In cozy, farming, crafting, and idle games, familiar cycles can become a source of comfort, rhythm, mastery, and fantasy fulfillment. Research on cozy farming games has explicitly described sowing, waiting, and harvesting as satisfying repeated activity and as a form of “ritual time.”

The distinction is not **repetition versus no repetition**. It is **meaningful ritual versus administrative obligation**.

A repeated action still earns its place when it provides one or more of:

- tactile or sensory pleasure;
- a meaningful choice;
- mastery or timing;
- fantasy fulfillment;
- emotional comfort;
- useful strategic information;
- visible transformation.

Warning signs of choreification include:

- too many daily claims;
- repetitive collection taps with no sensory or decision value;
- mandatory low-level tasks that have stopped being interesting;
- inventories that require constant cleanup;
- repeated confirmations;
- too many simultaneous quest tracks;
- reward bureaucracy such as “claim → dismiss → clear badge → open another tab → claim again” before play resumes;
- events that depend primarily on attendance pressure rather than interesting activity.

Engagement-reward research has found that daily and repeatable rewards can be experienced as motivating **or** as FOMO, obligation, and chores. Treat these systems as design choices, not universally beneficial retention tools.

Automation and batch actions can retire low-value friction, but do not automatically remove a mastered activity merely because the player has repeated it. If the ritual itself remains pleasurable, make automation optional or let the player choose when to skip it.

A useful test is:

> **If the reward were temporarily removed, would performing this activity still feel satisfying, expressive, calming, informative, or skillful?**

If yes, preserve the activity. If no, consider compression, batching, or automation.

## 15. Cross-system rewards should create pleasant surprise

In multi-mode games, occasional rewards from one mode can enrich another. The strongest version feels like the game’s world is connected rather than like every activity is a compulsory funnel.

Good cross-system rewards are:

- understandable;
- thematically sensible;
- useful without being mandatory every session;
- varied enough to remain surprising;
- easy to inspect later.

If a player wants to spend an hour in one subgame, let that be valid. Cross-rewards should make the hour feel connected to the wider game, not punish specialization.

## 16. Do not confuse retention with quality

Retention is a diagnostic metric, not a moral score.

GameAnalytics’ 2025 benchmark report, updated in 2026, notes substantial drop-off across mobile titles and associates weak longer-term retention with issues such as content pacing and progression. Use metrics to locate friction, but investigate **why** behavior occurs.

Examples:

- Low tutorial completion may indicate confusion, boredom, technical failure, or a poor first fantasy.
- High session count can indicate delight — or tedious timers.
- Long sessions can indicate immersion — or inability to find a stopping point.

Pair analytics with observation and qualitative playtest notes.

## 17. Ethical engagement rules

Prefer systems that make players feel:

- curious;
- competent;
- expressive;
- surprised;
- connected;
- proud of what they built.

Be cautious with systems whose primary emotional mechanism is:

- fear of loss;
- guilt;
- artificial scarcity unrelated to the game fantasy;
- constant interruption;
- confusing currencies designed to obscure value;
- pressure to maintain a streak;
- punishment for taking a break.

## 18. Memorable-experience checklist

For each major chapter, feature, or progression band, identify:

- [ ] one new possibility;
- [ ] one visual/world change;
- [ ] one moment of surprise or contrast;
- [ ] one choice that can feel personal;
- [ ] one reason to anticipate the next session;
- [ ] one mastery lesson the player can internalize;
- [ ] one old friction that can be reduced or retired.

## 19. Agent implementation rules

An agent building engagement systems should:

- preserve uninterrupted access to the core fun;
- avoid turning every subsystem into a daily obligation;
- prioritize visible world change over invisible numerical inflation when possible;
- create periodic qualitative unlocks;
- ensure reward screens do not become longer than the play that earned them;
- distinguish comforting or skillful repetition from administrative repetition before automating it;
- surface one future goal at a stopping point rather than five competing demands;
- instrument major progression steps so pacing can be evaluated later.

## Selected references

- Mazurkiewicz, **Farming games in the cozy aesthetic: a fantasy of dreams of a simple life** — ritual time and satisfaction through repeated farm cycles: https://czasopisma.uni.lodz.pl/Replay/article/view/18423
- Frommel & Mandryk, **Daily Quests or Daily Pests? The Benefits and Pitfalls of Engagement Rewards in Games**: https://research-portal.uu.nl/en/publications/daily-quests-or-daily-pests-the-benefits-and-pitfalls-of-engageme/

- GameAnalytics, **2025 Mobile Gaming Benchmarks** (updated August 2026): https://www.gameanalytics.com/reports/2025-mobile-gaming-benchmarks
- Apple Human Interface Guidelines, **Inclusion** — approachable experiences and paths toward deeper understanding: https://developer.apple.com/design/human-interface-guidelines/inclusion
- Nielsen Norman Group, **Recognition Rather Than Recall**: https://www.nngroup.com/articles/recognition-and-recall/


# Managing Depth Without Overwhelming the Player

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Purpose

This guide addresses a common false choice in game design:

> “Either the game is simple enough for mobile, or it is deep enough to be interesting.”

That is not the real tradeoff. Deep games become approachable when complexity is **structured, timed, contextual, and compressible**.

The design target is:

> **Few concepts visible at once; many meaningful interactions available over time.**

## 2. Distinguish depth from interface complexity

Depth comes from relationships between rules, resources, timing, positioning, risk, and strategy.

Interface complexity comes from the number of controls, labels, screens, currencies, tabs, exceptions, and pieces of information a player must process.

A game can have enormous depth with a compact interface. Conversely, a shallow game can have a very complicated interface.

Whenever complexity increases, ask whether it creates **new decisions** or merely **new administration**.

## 3. Maintain a complexity budget

Every screen and progression phase has a limited attention budget.

Spend that budget on the most important current decisions.

A practical review question is:

> “If I add this element, what becomes less noticeable?”

Nothing is truly free. A new badge, currency, objective, icon, meter, and tooltip all compete for attention.

## 4. Use progressive disclosure intentionally

Progressive disclosure means presenting common and immediately relevant options first while keeping specialized or advanced functionality available when needed.

For games, disclosure can happen through:

- progression unlocks;
- contextual menus;
- expandable details;
- advanced tabs;
- long-press information;
- inspection screens;
- optional comparison panels;
- expert settings;
- delayed introduction of systems.

The goal is not to hide useful information. The goal is to ensure the player sees the **right information at the right time**.

## 5. Teach through staged capability

A robust onboarding sequence often follows:

**See → touch → succeed → vary → combine → optimize.**

Example for gardening:

1. Plant one crop.
2. Water it.
3. Harvest it.
4. Introduce multiple crop choices.
5. Introduce fertilizer.
6. Introduce adjacency or seasonal effects.
7. Let advanced players optimize layouts.

Do not explain companion planting in the first minute simply because the feature exists in the final game.

## 6. Introduce one conceptual burden at a time

A “feature” can contain several concepts. Introducing a new building that also introduces a new currency, timer, upgrade tree, crafting category, and NPC quest line is not one new thing — it is six.

When possible, reuse known concepts:

- a new crop can use the existing plant/water/harvest model;
- a new blocker can build on an existing interaction;
- a new unit can use a familiar targeting rule;
- a new resource can enter through an already-known collection flow.

Novelty becomes easier to absorb when only one dimension changes at a time.

## 7. Unlocks should answer a felt need

A powerful way to introduce complexity is to let the player first experience the limitation the new feature solves.

Examples:

- inventory expansion appears after space begins to feel tight;
- automation unlocks after repeated manual production has become familiar;
- sorting appears after the collection becomes large enough to need it;
- a new booster appears after the player understands the base obstacle;
- loadout presets appear once multiple viable builds exist.

This makes the new system self-explanatory: the player already understands why it matters.

## 8. Avoid simultaneous novelty

Do not introduce a major new system during another cognitively demanding event unless the combination is the point.

Bad timing:

- first boss + first crafting screen + first equipment comparison;
- first market customer + first barter rules + first premium currency;
- first new blocker + first new booster + first timed objective.

Give new concepts enough room to become familiar before layering another unfamiliar concept over them.

## 9. Preserve expert depth without exposing it constantly

Experts often want:

- detailed stats;
- sorting and filtering;
- precise comparison;
- batch operations;
- build presets;
- advanced settings;
- historical data;
- probability details.

Provide those capabilities without forcing every player to read them every time.

A good pattern is **simple surface, deep inspection**:

- concise card by default;
- tap or long-press for details;
- comparison mode for deliberate decisions;
- optional advanced analytics screen.

## 10. Limit active currencies

Currencies are cognitively expensive because each requires the player to remember:

- where it comes from;
- what it buys;
- whether it is scarce;
- whether spending it now is wise;
- how it relates to other currencies.

Before adding a currency, ask whether the same design goal can be achieved with:

- a direct unlock;
- an existing resource;
- progress on a track;
- a physical item;
- a cooldown;
- a one-time requirement.

If several currencies exist, keep only the currently relevant ones prominent.

## 11. Inventories need information architecture, not just more slots

As inventories grow, add tools proportionally:

- grouping;
- sorting;
- filtering;
- favorites;
- search where scale justifies it;
- “new” state that clears predictably;
- comparison;
- batch actions;
- sensible default ordering.

Do not solve inventory complexity merely by making cards enormous or forcing endless scrolling.

## 12. Upgrade trees should expose decisions, not wallpaper

A tree becomes overwhelming when the player sees dozens of nodes that are irrelevant, locked, unexplained, or too distant.

Prefer:

- emphasize the currently reachable frontier;
- visually mute distant branches;
- preview meaningful consequences;
- compare paths clearly;
- keep the player’s current build identity visible;
- allow respec when experimentation is part of the fantasy;
- avoid tiny nodes if precision really matters, but do not inflate nodes so far that structure is lost.

## 13. Information density can be high when structure is strong

High density is not inherently bad. Dense strategy and management games work because information is grouped, aligned, consistent, and scannable.

Useful compression techniques:

- columns with stable semantics;
- consistent icon positions;
- meaningful whitespace between groups rather than between every item;
- sparklines or compact bars;
- abbreviations after concepts are learned;
- color plus shape/status icons;
- expandable detail;
- row-level actions rather than repeated giant buttons.

The goal is not “large everything.” It is **legible structure**.

## 14. Keep state visible during decisions

Do not force the player to remember a value from a previous screen.

When choosing an upgrade, show current and resulting values. When choosing a recipe, show ingredient ownership. When assigning workers, show the affected production. When equipping an item, show the before/after comparison.

This reduces cognitive load without reducing complexity.

## 15. Avoid hidden rule accumulation

Deep games often become confusing because exceptions pile up invisibly.

If a rule has exceptions:

- make them discoverable in context;
- use consistent language;
- show the effect before commitment where practical;
- avoid having similar-looking objects obey unrelated rules without a visual cue.

Complexity is easier to learn when rules compose cleanly.

## 16. Design for re-entry

A player may return after hours, days, or weeks.

Help them recover with:

- visible current goals;
- persistent state in the world;
- a concise “what changed” summary for idle systems;
- a recent activity log when meaningful;
- clear build identity;
- one suggested next action rather than a full tutorial replay.

## 17. Complexity warning signs

Investigate if playtests show:

- players repeatedly asking what a currency does;
- opening several screens before making one decision;
- hesitation caused by fear of irreversible mistakes;
- players ignoring systems because they cannot tell when they matter;
- constant badge-clearing behavior;
- players forgetting where a function lives;
- tutorials longer than the interaction they explain;
- advanced players wanting more data while novices already feel overloaded.

These are usually architecture problems, not requests for larger buttons.

## 18. Agent implementation rules

An agent should:

- add complexity in layers rather than all at once;
- keep advanced detail accessible without making it the default surface;
- treat screen space as an attention budget;
- prefer system reuse over creating a new interaction grammar for every feature;
- use direct comparisons to reduce memory load;
- add sorting/filtering as data volume grows;
- avoid introducing a new currency unless it has a distinct job;
- never solve overwhelm solely by increasing element size and reducing information density.

## 19. Depth-without-overwhelm review checklist

- [ ] Can a novice use the current feature without understanding future systems?
- [ ] Are advanced options available without dominating the default view?
- [ ] Does each active currency have a distinct purpose?
- [ ] Are new systems introduced after the player has a reason to care?
- [ ] Are current and resulting states shown together for important choices?
- [ ] Is dense information grouped and aligned rather than simply enlarged?
- [ ] Can a returning player recover their context quickly?
- [ ] Are there fewer simultaneous alerts than simultaneous systems?
- [ ] Does each new concept create a meaningful decision?

## Selected references

- Nielsen Norman Group, **Progressive Disclosure**: https://www.nngroup.com/articles/progressive-disclosure/
- Nielsen Norman Group, **Recognition Rather Than Recall**: https://www.nngroup.com/articles/recognition-and-recall/
- Apple Human Interface Guidelines, **Inclusion** — approachable experiences with a path to deeper understanding: https://developer.apple.com/design/human-interface-guidelines/inclusion


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


# Idle, Incremental & Management Games UX Guide

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Scope

This guide covers idle games, incremental games, tycoons, production chains, economy sims, management games, and hybrids such as idle tower defense.

These games can contain enormous numerical and systemic depth. Their primary UX risk is not lack of information — it is **poor information hierarchy**.

## 2. The player should understand the bottleneck

At any moment, a management player should be able to form a theory about what limits progress.

The interface should help answer:

- What am I producing?
- What is limiting production?
- What can I change?
- What will the change cost?
- What will it improve?
- How long until the next meaningful milestone?

If the answer requires opening five screens and remembering several values, the UX is failing.

## 3. Use dashboards for questions, not for data dumping

A dashboard should prioritize decisions.

A useful hierarchy is:

1. current output / survival / goal state;
2. current bottleneck or threat;
3. affordable meaningful actions;
4. supporting detail;
5. historical or expert analytics.

Do not put every metric at equal visual weight merely because it exists.

## 4. Large numbers need semantic formatting

As values grow:

- use consistent suffixes or scientific notation settings;
- show enough significant digits to support decisions, not decorative precision;
- keep a consistent unit system;
- allow detail inspection for exact values;
- use rate notation clearly, such as /s, /m, or per wave;
- make multipliers visually distinct from flat additions.

A player should never need to ask whether 1.2M means current storage, lifetime production, or production per second.

## 5. Upgrades should answer “why this?”

An upgrade card should usually show:

- current level or state;
- cost;
- resulting change;
- whether the player can afford it;
- why it matters to the active system.

For simple repeated upgrades, compact rows are better than giant cards. Reserve large treatment for major choices or qualitative unlocks.

## 6. Show before/after state

Instead of:

> Damage +15%

Prefer:

> Damage 120 → 138 (+15%)

when space permits.

This reduces arithmetic burden and makes the value of a choice immediately legible.

## 7. Automation should retire friction, not meaningful ritual

Idle and management games are well suited to progression that reduces repetitive work, but **mastery alone is not proof that an action should disappear**.

Good candidates for automation or batching are tasks that have become mechanically repetitive and no longer provide meaningful choice, sensory satisfaction, useful information, or strategic timing.

Examples:

- auto-collect after manual collection has taught the resource and the collection gesture no longer matters;
- production queues after individual crafting is understood;
- purchase-max controls after repeated one-level buying becomes tedious;
- rule-based automation for expert players later;
- automated targeting when targeting is not an intended skill dimension.

Keep or make optional the repeated actions that remain part of the fantasy or pleasure of play. A player may genuinely enjoy tapping a harvest, opening a production line, arranging stock, or manually triggering a dramatic ability even after they understand it perfectly.

Use this test before automating:

> **Does the repeated action still provide pleasure, information, expression, or a meaningful decision?**

If yes, preserve manual play and make automation optional. If no, batch or automate it as earned power.

Automation should feel like agency, not like paying or grinding to stop playing.

## 8. Offline progress should be understandable

On return, show a concise summary:

- time away;
- resources gained;
- important caps or constraints reached;
- meaningful events that happened;
- one clear next action.

Avoid making the player tap through several claim screens. If there is no meaningful choice, collect automatically and explain the result.

## 9. Prestige must justify the reset

A prestige/reset system should clearly communicate:

- what will reset;
- what will persist;
- what permanent advantage is gained;
- why the next run will play differently or faster;
- whether waiting longer materially improves the reset value.

The reset is more satisfying when it creates a changed strategy, new branch, or new capability rather than only a larger multiplier.

## 10. Use hierarchy for multiple timescales

Management games often have:

- per-second changes;
- per-wave changes;
- session goals;
- prestige cycles;
- long-term meta progression.

Do not show all timescales equally everywhere.

The current play screen should emphasize the immediate timescale. The meta screen can emphasize longer horizons.

## 11. Alerts should identify actionable exceptions

An alert deserves attention when the player can act on it.

Good alerts:

- production stopped because storage is full;
- a worker is idle;
- a boss wave is ready;
- a researched upgrade can now be chosen;
- a resource cap is blocking growth.

Bad alerts:

- every routine income tick;
- every completed trivial task;
- badges that simply restate information already visible.

## 12. Avoid spreadsheet fatigue

Depth does not require the player to constantly compare raw tables.

Use:

- meaningful grouping;
- trends;
- deltas;
- bottleneck indicators;
- compact charts;
- recommended comparisons;
- contextual explanations;
- drill-down for advanced detail.

The default view should support the next decision. Expert analysis can live one layer deeper.

## 13. Purchase controls should match the rhythm

Early game may need individual purchase buttons because each purchase matters.

Later, provide:

- x10;
- x25;
- Max;
- Buy to next breakpoint;
- press-and-hold repeat;

if those actions reduce mechanical repetition without erasing meaningful choice.

## 14. Resources need distinct jobs

If gold, gems, gears, energy, research points, prestige shards, and event tokens all coexist, the player must understand why each exists.

Use separate currencies only when they support genuinely different economies or pacing roles. Hide currencies outside their relevant context when possible.

## 15. Progress should have visible milestones

Incremental growth benefits from landmarks:

- tower changes form;
- factory gets a new line;
- new enemy type appears;
- automation unit arrives;
- prestige unlocks a new mechanic;
- production moves to a new region.

Without landmarks, exponential numbers can become emotionally flat.

## 16. Mobile layout guidance

High-density management games can work on phones when structure is strong.

Prefer:

- compact rows;
- stable columns;
- expandable sections;
- sticky totals;
- horizontal detail only when deliberately scrollable;
- bottom sheets for contextual actions;
- tabs for major conceptual areas, not every minor category.

Do not make every row a 100-point-tall card simply to satisfy a generic “mobile-friendly” aesthetic.

## 17. Idle/management engagement

A good session often follows:

1. return and understand what changed;
2. identify the new bottleneck;
3. make one or more meaningful allocation/upgrade choices;
4. witness accelerated progress;
5. approach a milestone;
6. leave with a clear future payoff in motion.

## 18. Agent implementation rules

An agent should:

- show deltas and before/after values;
- surface bottlenecks instead of only raw metrics;
- retire low-value repetitive actions with progression while preserving enjoyable ritual or manual override;
- make offline summaries concise;
- explain prestige resets clearly;
- use compact information-dense layouts where the genre benefits from them;
- add batch controls as repetition grows;
- keep alerts actionable.

An agent must not:

- increase card size until only two upgrades fit on screen;
- create one tab per resource;
- require repeated manual claiming without a gameplay reason;
- hide reset consequences;
- use badge counts as a substitute for prioritization.

## 19. Review checklist

- [ ] Can the player identify the current bottleneck?
- [ ] Are important rates and units unambiguous?
- [ ] Do upgrade choices show resulting values?
- [ ] Has low-value mastered repetition been automated or batched without removing pleasurable ritual?
- [ ] Is the offline summary concise and actionable?
- [ ] Are prestige consequences explicit?
- [ ] Are alerts reserved for actionable states?
- [ ] Does the screen support dense information without giant cards?
- [ ] Are long-term milestones visible in the world or presentation?


## Selected references

- Frommel & Mandryk, **Daily Quests or Daily Pests? The Benefits and Pitfalls of Engagement Rewards in Games**: https://research-portal.uu.nl/en/publications/daily-quests-or-daily-pests-the-benefits-and-pitfalls-of-engageme/
- Android Developers, **Build an offline-first app**: https://developer.android.com/topic/architecture/data-layer/offline-first


# Cozy, Life-Sim & Collection Games UX Guide

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Scope

This guide covers cozy life games, gardening, farming, cooking, decorating, collection games, gentle market/merchant systems, home customization, and interconnected “small game” structures.

The main design goal is not merely low difficulty. It is **low friction with meaningful agency**.

## 2. Let the world be the interface

Cozy games benefit enormously from direct manipulation because the player’s relationship with the space is part of the fantasy.

Prefer:

- touch the plant;
- pour into the pot;
- drag the furniture;
- pick up the ingredient;
- place an item on a shelf;
- tap a customer;

rather than requiring a mode switch for every action.

Menus should support the world, not replace it.

## 3. Physicality creates comfort

A cozy interaction can contain small stages:

**anticipation → contact → movement → consequence → settling.**

Examples:

- a broth carton lifts slightly when picked up;
- it tilts as the player drags;
- a visible stream pours into the pot;
- the soup level rises;
- the carton lightens or empties;
- the pot settles with a small sound.

These details create a sense that the player is doing something rather than selecting a command.

## 4. Multi-step activities can be more engaging when each step has identity

More steps do not automatically mean more fun. They work when each step changes the interaction or sensory experience.

A cooking recipe might intentionally move through:

1. stove view — pour broth;
2. cutting board — chop carrots and onion;
3. stove view — scrape prepared food into pot;
4. add herbs directly to pot;
5. add spices directly to pot;
6. stir;
7. service view.

This is stronger than seven taps on a recipe checklist because the player performs varied, understandable actions in context.

The rule is:

> **Add steps when they create tactile variety, anticipation, transformation, or expression. Remove steps that only add administration.**

### 4.1 Repetition can be the comforting ritual

Do not assume that a familiar action becomes bad because it is no longer cognitively demanding. In cozy games, low-stakes repetition can be the fantasy.

Planting a row, watering, chopping ingredients, stirring a pot, placing items on a shelf, or greeting familiar customers can remain satisfying because of rhythm, sensory feedback, ownership, and emotional familiarity. Research on cozy farming games describes repeated sowing, waiting, and harvesting as a source of satisfaction in itself and relates that cyclicality to “ritual time.”

The target for removal is **administrative friction**, not calm repetition.

A useful distinction:

- **ritual:** the player is doing the fantasy;
- **bureaucracy:** the player is processing the game’s interface so they can get back to the fantasy.

When an activity is mastered, ask whether it still feels good before replacing it with automation. If automation is valuable, consider making it an optional earned convenience rather than a forced replacement.

## 5. Keep pressure soft unless the fantasy calls for it

Cozy does not mean nothing can go wrong. It means mistakes should rarely threaten the player’s broader investment.

Possible soft failure:

- slightly lower quality;
- funny visual outcome;
- lost bonus;
- customer offers less;
- retry without resource punishment;
- imperfect but usable item.

Avoid making a small interaction error destroy rare resources unless the player knowingly opted into that risk.

## 6. Make spaces legible without covering them in UI

Use environmental cues:

- sparkle on harvestable crops;
- a gently steaming pot;
- customer body language;
- a highlighted empty planting bed;
- a room corner subtly indicating an available furniture slot;
- an NPC waiting near the relevant object.

The world can answer “what can I do?” without floating labels everywhere.

## 7. Expansion should feel spatial

When a garden, home, shop, or estate grows, let the player see the boundary change.

Good expansion:

- new planting plots physically appear;
- a gate opens;
- a room is restored;
- a path extends;
- an unused corner becomes active;
- market stalls become occupied.

Avoid reducing world expansion to a menu number if the game’s fantasy is ownership of a place.

## 8. Decoration needs freedom plus guardrails

Decoration UX should support experimentation.

Useful features:

- drag-and-drop placement;
- rotation with a clear gesture or button;
- snapping that can be overridden when appropriate;
- valid-placement preview;
- undo/redo;
- store/return without destructive confirmation;
- filtering and favorites once the catalog grows;
- recently acquired category;
- optional grid visibility.

Do not force players through multi-step edit modes for simple moves unless direct manipulation conflicts with normal play.

## 9. Collection should create recognition, not inventory anxiety

Collections work well when they become visible stories:

- recipe book fills in;
- shelves display keepsakes;
- garden journal records unusual plants;
- furniture catalog shows discovered sets;
- customer book remembers characters.

The collection screen should celebrate what exists, not feel like a warehouse-management problem.

## 10. Cross-system rewards make the estate feel connected

A match game can occasionally award garden tools. Gardening can produce ingredients for cooking. Cooking can improve market relationships. Market play can yield furniture or seeds.

Key rule:

> **Cross-rewards should enrich freedom, not convert every activity into an obligation.**

A player should be able to spend a long session in one favorite mode and still feel that time mattered to the broader game.

## 11. Onboarding should move through places, not feature checklists

For a multi-mode cozy game, onboarding can form a gentle journey:

- begin with the simplest, most immediately playable mode;
- earn enough to reveal the garden;
- learn plant/water/harvest;
- take produce to the market;
- meet characters through trade;
- encounter a chef who introduces cooking;
- eventually use proceeds to personalize the home.

Each new system should appear because the world has given the player a reason to go there.

## 12. Characters should anchor systems emotionally

A mechanic becomes more memorable when tied to a person or place.

Instead of “Cooking System Unlocked,” a chef asks for help. Instead of “Market Reputation 2,” a regular customer remembers what the player sold last time.

Characters can explain new mechanics through need, preference, humor, and recurring relationships.

## 13. Menus should stay calm

Avoid a home screen with twelve equally prominent icons for every subgame and system.

Prefer:

- spatial navigation through the estate;
- a small number of major destinations;
- contextual buttons that appear where they matter;
- a simple persistent navigation layer only for genuinely global tasks.

The player should feel like they are visiting places, not operating a dashboard.

## 14. Gentle goals, not constant commands

Use optional goals to provide direction without turning the game into a task manager.

A strong cozy goal says:

- “The chef would love two carrots.”
- “There’s room for one more garden bed.”
- “Someone at the market mentioned a blue vase.”

A weaker implementation turns the same content into ten stacked red-badge quests.

## 15. Time should create anticipation, not punishment

Growth timers, shop refreshes, and character schedules can create rhythm. Avoid making absence feel like failure.

Prefer:

- crops waiting safely;
- capped gains explained clearly;
- generous windows;
- return summaries;
- alternate activities while waiting.

## 16. Sound and haptics are disproportionately important

Cozy games benefit from small sensory rewards:

- knife on board;
- liquid pouring;
- soil patting;
- basket rustle;
- register bell;
- subtle completion haptic;
- room ambience changing with decoration.

These should reinforce the material fantasy rather than compete for attention.

## 17. Cozy does not require oversized UI

Calm visual design can still be information-dense.

Use modest, readable controls and let the environment occupy most of the screen. Dense object layouts are acceptable when direct manipulation is forgiving and the player can zoom, pan, or rely on snapping where needed.

Do not solve comfort by making every card, crop, object, and button enormous.

## 18. Agent implementation rules

An agent should:

- prefer world interaction to menu commands;
- give physical actions visible stages;
- allow long play in a favorite subgame without punishment;
- use cross-rewards as pleasant connections;
- let spaces visibly transform;
- keep the number of simultaneous prompts low;
- introduce systems through places and characters;
- preserve forgiving direct manipulation;
- preserve pleasurable ritual even after mastery, unless players choose to automate it.

An agent must not:

- turn every system into a red-badge destination;
- add steps that have no sensory or decision value;
- punish the player for leaving crops or timers unattended;
- replace spatial play with dashboard navigation for implementation convenience;
- require giant UI that obscures the game world.

## 19. Review checklist

- [ ] Can the player act directly on important world objects?
- [ ] Do multi-step activities provide varied interaction rather than repeated taps?
- [ ] Does repeated play preserve comforting ritual while minimizing reward bureaucracy?
- [ ] Does world progression visibly change spaces?
- [ ] Are cross-system rewards helpful but not mandatory?
- [ ] Can players specialize in a favorite activity for a long session?
- [ ] Are goals gentle and understandable without a wall of notifications?
- [ ] Are mistakes cheap enough to encourage experimentation?
- [ ] Do sound and animation reinforce physicality?
- [ ] Does the UI leave room for the world to breathe?


## Selected references

- Mazurkiewicz, **Farming games in the cozy aesthetic: a fantasy of dreams of a simple life**: https://czasopisma.uni.lodz.pl/Replay/article/view/18423
- Frommel & Mandryk, **Daily Quests or Daily Pests? The Benefits and Pitfalls of Engagement Rewards in Games**: https://research-portal.uu.nl/en/publications/daily-quests-or-daily-pests-the-benefits-and-pitfalls-of-engageme/
- Apple Human Interface Guidelines, **Playing haptics**: https://developer.apple.com/design/human-interface-guidelines/playing-haptics


# Action, Arcade, Runner & Roguelike Mobile UX Guide

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Scope

This guide covers action games, runners, shooters, bullet-heaven games, arena combat, platformers, and run-based roguelikes on touch devices.

These games have a special constraint: the player often makes decisions while attention is already occupied by movement, enemies, timing, and spatial threat.

## 2. Attention is the scarce resource

During action, UI competes directly with survival.

Therefore:

- hide information that is not currently actionable;
- keep persistent HUD elements stable;
- avoid text-heavy notifications in combat;
- move complex choices into pauses, level-up moments, safe rooms, or between runs;
- communicate threats in the playfield itself whenever possible.

## 3. Controls should be designed around hands, not controller diagrams

Do not simply copy console controls onto translucent circles.

Touch-first control design asks:

- What must be continuous?
- What can be automatic?
- What can be contextual?
- Which actions must happen simultaneously?
- Can a gesture replace a button?
- Can the whole side of the screen become a touch region?

Apple’s 2026 touch-game guidance explicitly encourages contextual controls, direct touch interactions, and layouts that respect where thumbs and camera/movement input need to occur.

## 4. Separate continuous and discrete actions

Continuous actions include:

- movement;
- aiming;
- camera control;
- charge strength.

Discrete actions include:

- jump;
- dodge;
- ability activation;
- item use;
- interact.

Give continuous actions large forgiving regions. Discrete buttons can be more localized, but high-frequency ones should stay near natural thumb positions.

## 5. Virtual sticks should forgive imprecision

Useful patterns:

- floating origin within a broad touch region;
- large invisible collider around the stick;
- dead zone tuned to prevent jitter;
- acceleration curve that preserves fine movement near center;
- sprint or secondary state based on tilt magnitude when appropriate;
- recentering behavior that does not force the player to find a tiny fixed circle.

## 6. Preserve intentional execution difficulty; remove accidental input difficulty

The right question is not “should mobile games automate aiming?” It is:

> **Which execution demands are part of the intended mastery curve, and which exist only because a flat touchscreen lacks the tactile affordances of a physical controller?**

If aiming, timing, or directional precision **is the game**, preserve it. A precision shooter, twin-stick shooter, rhythm-action game, artillery game, or skill-shot mechanic may legitimately derive mastery from accurate manual input.

When precision is **not** the intended decision, compensate aggressively for touchscreen friction. Useful options include:

- auto-fire while the player controls positioning;
- target assistance with manual priority override;
- generous projectile or interaction cones;
- contextual interaction;
- automatic proximity weapon selection;
- aim assist with manual directional influence;
- configurable stick sensitivity, dead zones, and acceleration.

When precision **is** intended, improve the interface without deleting the skill:

- let players calibrate sensitivity;
- use predictable response curves;
- provide clear reticles and target feedback;
- keep input regions stable and reachable;
- offer optional assists or difficulty accommodations rather than silently changing everyone’s control model.

Microsoft’s Xbox Accessibility Guidelines explicitly recognize auto-target lock and other precision assists as legitimate accommodations. Treat them as tools in the design space, not as universal defaults.

The governing rule is:

> **Preserve intentional execution difficulty. Remove accidental hardware friction.**

## 7. HUD restraint improves combat readability

Persistent HUD should answer immediate combat questions:

- health/survivability;
- current resource or cooldowns;
- important objective;
- critical status effects.

Move secondary stats to pauses or inspection. Do not cover edge regions used to see approaching threats.

## 8. Telegraphs must survive visual chaos

Enemy attacks should have consistent cues through some combination of:

- shape;
- motion;
- timing;
- sound;
- floor indicator;
- color;
- silhouette;
- animation wind-up.

Do not rely on color alone. Test telegraphs under the busiest realistic combat state, not in an empty arena.

## 9. Feedback must distinguish source, hit, and result

A satisfying combat event often has layers:

1. action starts;
2. projectile/weapon travels;
3. impact registers;
4. target reacts;
5. damage/status consequence appears;
6. death or stagger resolves.

If everything flashes at once, causality disappears.

## 10. Level-up choices should interrupt at the right time

Run-based games often pause for upgrades. This is useful because it moves complex reading out of live combat.

Keep upgrade selection:

- concise;
- visually comparable;
- limited to a manageable number of choices;
- tied to the current build identity;
- explicit about what changes.

If advanced detail matters, make it inspectable rather than always visible.

## 11. Death-to-retry should be fast

For games built around repeated attempts:

- show enough information to understand what happened;
- summarize meaningful run progress;
- allow fast retry;
- keep meta-upgrade opportunities accessible but not compulsory after every death;
- avoid long defeat animations after they stop being emotionally useful.

The shorter the run, the faster the retry flow should generally be.

## 12. Pause and interruption matter on phones

Mobile players are interrupted.

Where the genre permits:

- pause when the app backgrounds;
- preserve run state safely;
- resume with a brief orientation moment if action is intense;
- avoid placing the player directly into unavoidable damage on return.

## 13. Screen edges are gameplay space

Avoid filling the lower corners with huge controls if threats need to enter from those areas. Transparency alone does not solve occlusion because the finger itself covers content.

Design enemy approach, camera framing, and control zones together.

## 14. One-handed and accessibility variants

When plausible, consider:

- left/right-handed layouts;
- adjustable control positions;
- optional auto-aim or target-assist strength when compatible with the game’s intended mastery;
- hold-versus-toggle options;
- adjustable aim sensitivity;
- larger telegraphs;
- reduced screen shake;
- reduced flashes;
- slower game-speed accessibility mode;
- haptic strength toggle.

## 15. Performance is input design

Combat feel deteriorates sharply when frame pacing and input latency vary.

Set a performance budget early. If a device cannot sustain the intended frame rate under peak effects, reduce nonessential visuals before allowing core movement and hit feedback to become inconsistent.

## 16. Agent implementation rules

An agent should:

- identify the intended execution-skill dimensions before choosing automation or assists;
- design controls around simultaneous actions and thumb positions;
- use broad forgiving regions for continuous input;
- remove unavailable controls instead of leaving dead buttons visible;
- test HUD readability under peak combat density;
- keep upgrade decisions out of live action unless that tension is intentional;
- make death/retry fast;
- preserve state across mobile interruption where feasible.

An agent must not:

- copy a gamepad layout literally without touch adaptation;
- place giant controls over important threat-entry regions;
- show every stat during combat;
- use particle spectacle that hides telegraphs;
- require precise fixed-stick acquisition when a floating region would work better;
- automate aiming, timing, or steering by default when that precision is itself a core skill.

## 17. Review checklist

- [ ] Can frequent actions be reached without hand repositioning?
- [ ] Are simultaneous inputs physically possible?
- [ ] Are continuous controls forgiving?
- [ ] Has the team explicitly identified which execution demands are intended skill versus touchscreen friction?
- [ ] Do optional assists preserve manual mastery for players who want it?
- [ ] Does the HUD show only actionable information during combat?
- [ ] Are enemy telegraphs readable at peak density?
- [ ] Can the player understand why they were hit or died?
- [ ] Is retry fast enough for the run length?
- [ ] Does returning from background avoid unfair damage?
- [ ] Can control layout or accessibility options accommodate different players?

## Selected references

- Microsoft, **Xbox Accessibility Guideline 107: Input**: https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107
- Microsoft, **Xbox Accessibility Guideline 108: Game difficulty** — includes auto target lock and precision assists as potential accommodations: https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/108
- Apple Human Interface Guidelines, **Game controls**: https://developer.apple.com/design/human-interface-guidelines/game-controls

- Apple, **Make your game great with touch (WWDC26)**: https://developer.apple.com/videos/play/wwdc2026/358/
- Apple, **Design advanced games for Apple platforms (WWDC24)**: https://developer.apple.com/videos/play/wwdc2024/10085/
- Apple Human Interface Guidelines, **Gestures**: https://developer.apple.com/design/human-interface-guidelines/gestures


# Mobile Game UX Evaluation & Playtest Handbook

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable design and implementation standard for mobile games. These documents are intended for designers, developers, AI coding agents, and playtest reviewers.

---


## 1. Purpose

This document turns the rest of the handbook into a repeatable quality process.

A UX principle that is never tested becomes an opinion. The goal is to evaluate **what players actually understand and can actually do** on real devices.

## 2. Review continuously, not only before release

Run lightweight UX review after:

- a new screen is introduced;
- navigation changes;
- a new gameplay interaction appears;
- board density changes;
- a new currency or progression system is added;
- major art changes affect readability;
- a tutorial step is added;
- a new device class is supported.

Small reviews prevent architectural problems from becoming expensive.

### 2.1 Use an evidence ladder and name the evidence honestly

Different tests answer different questions. Do not collapse them into the word “validated.”

| Evidence level | What it can establish | What it cannot establish by itself |
|---|---|---|
| Static inspection | geometry, hierarchy, safe areas, obvious overlap, state coverage | human comfort, comprehension, real touch error |
| Scripted interaction | whether defined paths and state transitions function | whether a human can discover or comfortably perform them |
| Input perturbation / fuzzing | sensitivity to noisy touch origins, angles, speeds, boundaries | actual human preference or grip behavior |
| Physical-device verification | real rendering, performance, haptics, device ergonomics | population-level usability |
| Observed human playtest | comprehension, hesitation, error patterns, comfort, unexpected behavior | production-scale frequency |
| Production telemetry | real-world rates, funnels, retries, abandonment, device distribution | player intent without qualitative context |

Use precise language in reports:

- “passes scripted interaction tests”;
- “survives ±N px input perturbation”;
- “verified on physical iPhone/Android hardware”;
- “observed with N human testers”;
- “production telemetry shows X.”

Reserve **human-validated** or **empirically validated for players** for evidence that actually involves players.

## 3. The screenshot audit

Capture every major state at the smallest and largest supported screen sizes.

For each screenshot, ask:

- What is the first thing the eye notices?
- Is that what should be noticed first?
- What is the dominant action?
- Are there multiple competing badges or highlights?
- Is valuable gameplay space wasted?
- Is critical game content obscured by controls?
- Does the screen contain empty bands created by over-conservative safe-area use?
- Are text and icon sizes consistent?
- Does dense content remain structured?

Screenshot review catches hierarchy problems even before interaction testing.

## 4. The three-second test

Show a normal screen briefly to a tester who understands the basic genre.

Ask:

1. Where are you?
2. What can you do?
3. What looks like the next useful action?

Record the answer without teaching first.

Do not require perfect comprehension of advanced systems. The goal is to see whether the visual hierarchy communicates the current task.

## 5. The no-help playtest

Give the game to a tester and do not explain anything unless the build is actually blocked.

Observe:

- first touch;
- hesitation;
- repeated taps;
- missed targets;
- attempts to interact with noninteractive objects;
- ignored interactive objects;
- navigation loops;
- unexpected gestures;
- places where the tester reads but still does not understand;
- moments of delight or spontaneous commentary.

Do not correct the tester. The mismatch between their expectation and the build is the data.

## 6. Test tasks, not opinions

Instead of asking “Do you like the inventory?” ask the player to:

- equip the stronger item;
- find an ingredient;
- replay a level;
- move a piece of furniture;
- upgrade production;
- combine two boosters;
- recover after failing a run.

Measure whether the task succeeds, how long it takes, and where hesitation occurs.

## 7. Dense-interaction reliability test

For match boards, maps, small cards, unit grids, or dense object fields, do not judge by dimensions alone.

Create a practical test:

- ask for 50–100 representative interactions;
- count wrong source selections;
- count wrong destination selections;
- count accidental activations;
- count gestures the game rejects despite clear player intent;
- note whether errors cluster near edges or corners;
- compare novice and experienced players.

If reliability is high, the interaction is working even if the visual objects are smaller than generic UI-target guidance.

If reliability is poor, first improve:

- hit regions;
- snapping;
- gesture thresholds;
- intent inference;
- feedback;
- camera/zoom;
- spacing;

before sacrificing board structure.

### 7.1 Add input perturbation before shrinking the game

For a dense interaction that works in a scripted ideal path, perturb:

- initial touch position around the intended cell or object;
- swipe angle and distance;
- drag speed;
- boundary proximity;
- release position;
- brief reversals or jitter.

Record whether the input system resolves the likely intent. This is an engineering stress test, not a substitute for human playtesting.

### 7.2 Distinguish source error from destination error

When a gesture fails, log where it failed:

- wrong source selected;
- correct source, wrong destination;
- correct intent rejected as invalid;
- visual feedback caused the player to cancel;
- interaction succeeded but consequence was misunderstood.

This tells the team whether to change hit testing, gesture thresholds, feedback, rules communication, or board density.

## 8. First-five-minute review

The first five minutes should answer:

- What fantasy am I in?
- What do I do with my finger?
- What happens when I succeed?
- What am I trying to accomplish?
- Why might I want to keep going?

Track how many interruptions occur before the player has experienced the core action several times.

## 9. First-session review

At the end of a first natural session, ask:

- Which systems did the player actually encounter?
- Which systems were explained but not needed?
- Was there at least one memorable moment?
- Did the player get a qualitative sense of progress?
- Is there an understandable reason to return?
- Did the session end at a natural stopping point?

## 10. Navigation audit

Map every route to frequent actions.

For each frequent task, count:

- taps/transitions;
- modal dialogs;
- context changes;
- back steps;
- screens that exist only to choose another screen.

Routine actions that require deep navigation should be redesigned unless the path itself carries meaningful context.

## 11. Attention audit

At a representative busy state, list everything asking for attention:

- pulsing buttons;
- badges;
- quest arrows;
- timers;
- notifications;
- particles;
- dialogue;
- resource changes;
- tutorial prompts.

Rank them by actual importance. If low-priority elements are visually louder than high-priority gameplay, fix the hierarchy.

## 12. Cognitive-load audit

For an important choice, write down every piece of information the player must remember from elsewhere.

Then try to eliminate memory requirements by showing:

- before/after values;
- ingredient ownership;
- current build state;
- resource sources;
- goal requirements;
- comparison context.

Recognition is usually cheaper than recall.

## 13. Device matrix

At minimum test:

- smallest supported phone;
- a common mid-size phone;
- largest phone class;
- tablet if supported;
- portrait and landscape where both are supported;
- devices with relevant cutouts/safe-area differences.

Test with actual touch when possible. Simulator screenshots do not reveal thumb reach, finger occlusion, or grip discomfort.

## 14. Accessibility pass

Check:

- text legibility;
- contrast;
- color-only communication;
- captions;
- reduced motion;
- visual/audio/haptic redundancy for critical cues;
- control remapping or alternate schemes where relevant;
- critical menu semantics for assistive technologies;
- timing sensitivity;
- left/right-hand accommodation where relevant;
- alternatives or assists for precision gestures when practical;
- accessibility settings discoverability and persistence.

Use **Document 9: Mobile Game Accessibility & Adaptive Play** for the full pass.

## 15. Performance pass

Test worst-case gameplay states.

Record:

- frame pacing;
- input latency;
- animation hitching;
- loading stalls;
- memory pressure;
- thermal degradation on representative mobile hardware.

A screen that looks perfect but responds inconsistently has failed UX review.

### 15.1 Connected-state and interruption pass

For any networked or commercial feature, test the player-facing experience of:

- slow response;
- full disconnect before an action;
- disconnect after the player commits an action;
- retry;
- duplicate retry protection;
- app backgrounding mid-transaction;
- interrupted or pending purchase;
- restoration or reconciliation;
- cloud-save conflict when applicable.

The UX test is not whether the backend algorithm is elegant. It is whether the player understands what happened and whether progress, value, and trust are preserved.

## 16. Instrumentation suggestions

Useful event categories include:

- tutorial step entered/completed/skipped;
- invalid input;
- retry;
- level fail reason;
- menu route to frequent task;
- upgrade chosen;
- currency source/sink;
- session start/end;
- return after absence;
- first use of newly unlocked system;
- abandonment from a screen;
- wrong-source versus wrong-destination dense-input errors;
- network retry/pending/reconciliation outcomes when relevant;
- undo/cancel use.

Collect only what will inform a decision.

## 17. Severity scoring

Use four levels:

### S0 — Blocker
Player cannot proceed, loses state, or repeatedly triggers the wrong action.

### S1 — Major
Player can proceed but frequently misunderstands, mis-taps, gets lost, or experiences serious friction.

### S2 — Moderate
Noticeable inefficiency, hierarchy problem, or confusion that does not usually stop progress.

### S3 — Polish
Small consistency, animation, spacing, or presentation issue.

Fix S0/S1 before adding more features to the same flow.

## 18. UX scorecard

Score each area 1–5:

| Area | 1 | 3 | 5 |
|---|---|---|---|
| Comprehension | player is lost | understandable with hesitation | immediately legible |
| Input reliability | frequent mistakes | occasional mistakes | intent resolves consistently |
| Navigation | deep/confusing | workable | shallow and predictable |
| Hierarchy | everything competes | mostly clear | attention goes exactly where intended |
| Feedback | actions feel uncertain | adequate | immediate and satisfying |
| Complexity management | systems dumped at once | some staging | layered and contextual |
| Engagement | little desire to continue | functional goals | strong curiosity/mastery/anticipation |
| Accessibility | major barriers | partial support | thoughtful alternatives and settings |
| Performance feel | inconsistent | mostly stable | consistently responsive |

A perfect average is not required. The scorecard is for identifying the weakest part of the experience.

## 19. AI-agent self-review loop

After a meaningful UI change, an agent should:

1. run the build;
2. capture representative screenshots;
3. inspect hierarchy and clipping;
4. perform the intended interaction path;
5. test failure/cancel/back behavior;
6. test the smallest supported screen;
7. compare against relevant handbook rules;
8. fix obvious regressions before reporting completion;
9. report deliberate exceptions and why they are safe.

For dense gameplay, the agent should attempt the interaction repeatedly instead of rejecting it from static size calculations. It should also perturb input around ideal coordinates.

The agent must label the evidence it actually obtained. A scripted or simulated test must not be reported as a human usability result.

## 20. Release gates

Do not call a UI feature complete until:

- [ ] no S0/S1 usability issue is known;
- [ ] screenshots are clean on supported device classes;
- [ ] touch interaction is reliable on the smallest supported phone;
- [ ] dense interactions have been stress-tested with non-ideal input before shrinking the design;
- [ ] back/cancel/retry flows work;
- [ ] the feature teaches itself or has appropriately timed help;
- [ ] performance remains stable in realistic stress states;
- [ ] important accessibility options have been considered;
- [ ] the player can resume after interruption;
- [ ] connected features have understandable pending/offline/retry states;
- [ ] any claim of human validation is backed by actual human testing;
- [ ] telemetry, if needed, exists to evaluate uncertain design assumptions.

## Selected references

- Henze, Rukzio & Boll, **100,000,000 taps: analysis and improvement of touch performance in the large**: https://research.lancaster-university.uk/en/publications/100000000-taps-analysis-and-improvement-of-touch-performance-in-t/
- Apple Human Interface Guidelines, **Accessibility**: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Android Developers, **Build an offline-first app**: https://developer.android.com/topic/architecture/data-layer/offline-first

- Apple, **Design advanced games for Apple platforms (WWDC24)**: https://developer.apple.com/videos/play/wwdc2024/10085/
- Apple, **Make your game great with touch (WWDC26)**: https://developer.apple.com/videos/play/wwdc2026/358/
- Nielsen Norman Group, **10 Usability Heuristics**: https://www.nngroup.com/articles/ten-usability-heuristics/
- GameAnalytics, **2025 Mobile Gaming Benchmarks**: https://www.gameanalytics.com/reports/2025-mobile-gaming-benchmarks


# Mobile Game Accessibility & Adaptive Play

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Purpose:** A reusable accessibility and adaptive-play standard for mobile games. It is intended for designers, developers, AI coding agents, and playtest reviewers.

---

## 1. Purpose

Accessibility is not a single “large UI” mode. It is the practice of giving more players a viable way to **perceive**, **understand**, and **operate** the game while preserving its intended identity wherever possible.

This document focuses on enduring player-experience principles. Platform APIs and certification requirements should be checked against current documentation during implementation.

## 2. Design for multiple ways of perceiving important information

Do not make a critical state depend on only one sensory channel.

Examples:

- pair important audio cues with visual direction or state indicators;
- pair important visual success/error events with optional audio or haptics;
- do not use color as the sole distinction between states;
- caption meaningful speech and non-speech audio when it carries gameplay information;
- make off-screen threats perceivable without requiring stereo hearing alone.

Redundancy is not noise when each channel reinforces the same meaning.

## 3. Ordinary controls and gameplay objects are different accessibility problems

For menus, purchases, settings, pause, back, and other discrete controls, follow platform guidance for comfortable control sizes, focus order, semantics, and spacing.

Gameplay may legitimately be denser. A tile, unit, card, or object can be visually smaller when the game provides reliable full-cell hit regions, snapping, intent inference, zoom, alternate selection, or other accommodations.

The accessibility question is:

> **Can the player reliably perform the required action using at least one supported method?**

Do not solve every barrier by enlarging the entire game until depth or board structure is lost.

## 4. Provide control alternatives where the interaction permits

Useful options can include:

- remappable actions;
- left/right-handed layouts;
- floating versus fixed sticks;
- hold versus toggle;
- tap versus drag alternatives;
- adjustable sensitivity, dead zones, and acceleration;
- larger interaction regions without larger artwork;
- automatic target selection or precision assist;
- one-button contextual interaction;
- external controller support where appropriate.

Not every game can support every input mode. Prioritize the barriers most likely to block the intended audience.

## 5. Preserve intentional skill while offering accommodations

Accessibility does not require removing the core mechanic.

If precise aiming, timing, or movement is central to mastery, keep the manual version while considering optional assistance such as:

- wider timing windows;
- aim assist or target lock;
- slower game speed;
- larger telegraphs;
- reduced enemy aggression;
- simplified simultaneous-input requirements;
- skip or checkpoint options for non-core barriers.

Microsoft’s accessibility guidance explicitly treats auto-target lock and precision assists as valid ways to grade difficulty. The goal is to let more players reach the intended decisions and experiences.

## 6. Timing and cognitive load are accessibility variables

Consider whether players can:

- pause where the genre permits it;
- reread tutorial or dialogue information;
- extend timed decisions;
- slow gameplay or reaction windows;
- inspect a choice before committing;
- reduce simultaneous objectives;
- rely on recognition instead of remembering information from another screen.

Difficulty and accessibility overlap but are not identical. Expose the variables that create barriers rather than relying only on one “Easy” preset.

## 7. Motion, flashing, and camera effects need controls

Provide options to reduce or disable, where practical:

- screen shake;
- rapid camera motion;
- motion blur;
- parallax;
- large zoom pulses;
- repeated flashes;
- nonessential particle density.

Never make motion the only carrier of critical information. Apple’s Human Interface Guidelines recommend making motion optional and supplementing it with other feedback.

## 8. Audio must not be a single point of failure

For meaningful audio:

- caption dialogue;
- visualize directional threats when hearing them is important;
- provide independent music, effects, and voice volume when practical;
- use haptics as reinforcement, not as the only alternative;
- ensure the game remains playable with the device muted when the genre allows it.

Haptics should be optional and consistent in meaning.

## 9. Menus and non-gameplay UI should support assistive technologies

Where platform frameworks permit:

- provide semantic labels for controls;
- use logical focus order;
- expose selected/disabled/current states;
- do not hide essential actions behind unlabeled icons;
- keep modal focus contained and return focus sensibly on dismiss;
- ensure text scaling does not clip or overlap;
- preserve settings between sessions.

Highly visual gameplay may require custom accommodations, but menus should not create unnecessary barriers.

## 10. Make accessibility settings easy to find

Do not hide accessibility behind five layers of general settings.

Useful organization:

- Controls;
- Visual;
- Audio & captions;
- Motion;
- Difficulty / assists;
- Interface / text.

Allow important settings before or during onboarding when possible. A player should not need to complete an inaccessible tutorial to reach the setting that makes the tutorial accessible.

## 11. Accessibility presets can help, but expose components

A preset such as “Reduced Motion” or “Simplified Controls” can be useful, but let players customize individual settings where feasible.

Avoid assuming one disability maps to one preferred configuration. People’s needs and preferences vary.

## 12. Accessibility testing must include the actual interaction

Static screenshots cannot prove accessibility.

Test:

- with sound muted;
- with color information removed or simulated color-vision differences;
- with reduced motion enabled;
- with one hand when supported;
- with remapped or alternate inputs;
- with larger text settings;
- with the most demanding timing sequence;
- with assistive technologies for menus when supported;
- with players who use the accommodations whenever possible.

## 13. Agent implementation rules

An agent should:

- preserve platform-appropriate semantics and target comfort for ordinary controls;
- distinguish gameplay density from menu-control accessibility;
- provide redundant cues for critical information;
- expose assists as configurable tools when they would remove barriers without erasing the intended game;
- keep accessibility settings persistent and discoverable;
- report which accessibility checks were actually performed.

An agent must not:

- declare a feature accessible solely because color contrast passes;
- enlarge all gameplay objects until the game’s intended density collapses;
- use audio, color, haptics, or motion as the only carrier of essential state;
- force players through inaccessible onboarding before settings can be changed;
- describe a theoretical accommodation as tested if it has not been exercised.

## 14. Accessibility review checklist

- [ ] Critical information has more than one perceivable channel where practical.
- [ ] Menus use clear labels, states, focus order, and comfortable discrete controls.
- [ ] Dense gameplay has a reliable interaction method without requiring oversized art.
- [ ] Color is not the only critical distinction.
- [ ] Meaningful audio has a visual/text alternative.
- [ ] Motion and flashing can be reduced when they are not essential mechanics.
- [ ] Control sensitivity/layout/hold-toggle options are considered.
- [ ] Intentional precision skill is distinguished from touchscreen friction.
- [ ] Timing or difficulty accommodations are considered for major barriers.
- [ ] Accessibility settings are reachable early and persist.
- [ ] The game has been tested in the relevant accommodated states.

## Selected references

- Apple Human Interface Guidelines, **Accessibility**: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple Human Interface Guidelines, **Designing for games**: https://developer.apple.com/design/human-interface-guidelines/designing-for-games/
- Apple Human Interface Guidelines, **Motion**: https://developer.apple.com/design/human-interface-guidelines/motion
- Apple Human Interface Guidelines, **Playing haptics**: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Microsoft, **Xbox Accessibility Guideline 107: Input**: https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/107
- Microsoft, **Xbox Accessibility Guideline 108: Game difficulty**: https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/108


# Commercial, Live-Service & Connected UX

> **Series:** Mobile Game UX & Player Experience Handbook  
> **Version:** v1.1 — October 2026  
> **Status:** **Versioned companion.** Platform rules, storefront policies, laws, and commercial conventions change. Re-check current requirements before implementation or release.  
> **Purpose:** Player-facing UX standards for purchases, premium economies, network dependency, cloud state, live events, and transaction recovery. This is not legal advice and not a backend architecture specification.

---

## 1. Purpose

Commercial and connected systems are not outside UX merely because their implementation lives in payments, services, or networking.

The handbook separates them because the **player-experience principles are enduring while many policy details are transient**.

The UX responsibility is to preserve:

- clarity;
- informed consent;
- continuity;
- recoverability;
- value transparency;
- player trust.

## 2. Let the player understand normal play before selling acceleration or convenience

When a purchase affects gameplay, players should understand the underlying activity and the value of the item before being asked to spend.

Apple’s game-onboarding guidance recommends introducing in-app purchases after players have experienced normal gameplay and showing what the purchasable item does.

Avoid making the first minutes primarily a storefront tour.

## 3. Commercial surfaces should not dominate the game’s visual hierarchy

A store may be important without becoming the loudest thing on every screen.

Avoid:

- purchase prompts that interrupt unrelated play repeatedly;
- premium badges that visually outrank current gameplay objectives;
- multiple simultaneous offers competing for attention;
- closing flows that immediately open another offer.

A commercial prompt should have a reason to appear at that moment.

## 4. Currency and price should remain understandable

If virtual currencies exist:

- keep their jobs distinct;
- show price and quantity clearly;
- avoid unnecessary currency chains whose primary effect is obscuring value;
- show remaining balance after a purchase when helpful;
- protect unusually expensive actions from accidental activation;
- do not rely on visual similarity between free and paid currency.

If real money is involved, the platform purchase sheet and current storefront requirements are authoritative.

## 5. Randomized paid rewards require exceptional clarity

Randomized virtual items create both UX and policy obligations.

As of October 2026, Google Play policy requires games that sell mechanisms for randomized virtual items to disclose the odds in advance of and in close and timely proximity to the purchase. Other platforms and jurisdictions may impose different requirements.

Do not hide probability, duplicate behavior, pity rules, conversion values, or expiry rules behind deep help pages when those details materially affect a purchase decision.

Re-check current platform and legal requirements at release time.

## 6. Time pressure should serve the game before it serves conversion

Live events, refreshes, and limited offers can create excitement, but avoid designing the primary emotional mechanism around panic or fear of loss.

Prefer:

- generous event windows;
- clear end times with timezone handling;
- visible progress toward event goals;
- graceful handling when the player joins late;
- reminders proportional to player interest;
- rewards that do not make ordinary play feel worthless.

Keep the ethical-engagement principles from Document 2 in force.

## 7. A transaction is a state machine from the player’s point of view

The player needs understandable states such as:

- ready;
- processing;
- pending external action;
- completed;
- failed;
- cancelled;
- restored;
- refunded or entitlement changed, when relevant.

Never leave a purchase button looking tappable while the same transaction is already processing unless duplicate submission is safe and intentional.

Apple’s StoreKit testing guidance explicitly supports testing interrupted purchases and later resolution. Treat interrupted, pending, and restored states as normal cases, not exotic exceptions.

## 8. Network loss must degrade into an understandable state

Networking algorithms belong in engineering; **network failure presentation belongs in UX**.

When connectivity changes, answer:

- what still works;
- what is unavailable;
- whether the player’s local progress is safe;
- whether an action is queued;
- whether a retry is needed;
- whether leaving the screen is safe.

Android’s offline-first guidance recommends remaining usable without a reliable connection and presenting local data immediately where the product supports that architecture.

Do not show a blocking generic “Network Error” when a specific part of the game can continue safely.

## 9. Retry must not threaten duplication

For purchases, rewards, cloud writes, and other valuable actions:

- make retry idempotent at the system level where possible;
- communicate whether the prior action completed;
- avoid granting or charging twice because the player tapped Retry;
- reconcile ambiguous states before asking for another irreversible action.

From the player’s perspective, “I don’t know whether it worked” is a trust failure even if the server is technically consistent.

## 10. Cloud saves need conflict UX, not silent guessing

If multiple versions of a save can exist:

- prefer automatic reconciliation when it is provably safe;
- otherwise show understandable differences such as timestamp, progression, playtime, or key milestones;
- avoid presenting raw device IDs or opaque version numbers as the primary choice;
- never silently overwrite a clearly more advanced save because of a timestamp anomaly;
- preserve a recovery path when feasible.

The goal is confidence that progress is not fragile.

## 11. App interruption and resume are connected UX concerns too

Test backgrounding during:

- matchmaking;
- reward claims;
- purchase flow;
- cloud save;
- live-event transition;
- multiplayer session handoff.

On return, orient the player. Do not require them to infer whether the action completed.

## 12. Live-service changes should respect learned behavior

When a server-side update changes rules, economy, event structure, or content:

- explain player-visible changes that alter decisions;
- avoid silently moving familiar controls;
- preserve old inventory meaning or clearly communicate conversion;
- avoid invalidating a player’s prior choice without explanation;
- give the player a route to current event rules and timers.

Live operation is still interaction design.

## 13. Commercial and connected notifications need restraint

Push notifications, inbox messages, event badges, and store markers should be prioritized.

A useful notification tells the player about something they plausibly care about and can act on. A constant stream trains players to ignore the system.

Let players control categories where practical.

## 14. Agent implementation rules

An agent should:

- separate purchase state from button presentation;
- implement explicit pending, interrupted, completed, failed, and restored states where relevant;
- preserve local context through retry and reconnect;
- make price, currency, probability, and event timing understandable;
- verify current storefront/platform requirements rather than relying on this document’s dated examples;
- test slow, offline, backgrounded, duplicate-retry, and reconciliation paths;
- keep commercial prompts subordinate to the play experience unless the screen is intentionally a store.

An agent must not:

- assume a 2026 policy is permanently valid;
- silently retry an irreversible action in a way that could double-charge or double-spend;
- destroy or obscure progress because a network response is late;
- use ambiguous premium-currency conversions to hide value;
- treat a purchase as complete until entitlement is actually confirmed;
- report “offline supported” merely because one cached screen renders.

## 15. Review checklist

- [ ] Players experience normal gameplay before gameplay-affecting purchase education when appropriate.
- [ ] Real-money and premium-currency value is understandable.
- [ ] Randomized paid outcomes show required probability/duplicate/pity information under current rules.
- [ ] Commercial prompts do not routinely interrupt unrelated play.
- [ ] Purchase states include pending/interrupted/recovery paths.
- [ ] Retry cannot accidentally duplicate an irreversible action.
- [ ] Offline or degraded states clearly explain what remains usable.
- [ ] Local progress is visibly protected during connectivity loss.
- [ ] Cloud conflicts have a comprehensible recovery path.
- [ ] Background/resume behavior is tested during valuable actions.
- [ ] Live-event timers and end conditions are unambiguous.
- [ ] Current platform policies and applicable laws have been checked separately.

## Selected references

- Apple, **Onboarding for Games** — includes guidance on introducing in-app purchases after normal gameplay: https://developer.apple.com/app-store/onboarding-for-games/
- Apple, **Testing In-App Purchases in Xcode** — includes interrupted-purchase scenarios: https://developer.apple.com/documentation/storekit/testing-in-app-purchases-in-xcode
- Apple, **In-App Purchase**: https://developer.apple.com/in-app-purchase/
- Android Developers, **Build an offline-first app**: https://developer.android.com/topic/architecture/data-layer/offline-first
- Google Play, **Payments policy** — randomized virtual item odds disclosure (verify current policy before release): https://support.google.com/googleplay/android-developer/answer/9858738?hl=en
- Frommel & Mandryk, **Daily Quests or Daily Pests? The Benefits and Pitfalls of Engagement Rewards in Games**: https://research-portal.uu.nl/en/publications/daily-quests-or-daily-pests-the-benefits-and-pitfalls-of-engageme/


