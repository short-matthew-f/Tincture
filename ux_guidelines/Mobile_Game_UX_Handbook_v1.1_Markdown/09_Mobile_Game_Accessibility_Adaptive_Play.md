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
