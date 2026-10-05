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
