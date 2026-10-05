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
