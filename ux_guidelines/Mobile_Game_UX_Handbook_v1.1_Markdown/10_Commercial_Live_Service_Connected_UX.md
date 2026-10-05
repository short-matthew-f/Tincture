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
