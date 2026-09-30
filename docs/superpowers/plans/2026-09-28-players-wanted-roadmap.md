# PlayersWanted — Implementation Roadmap and Task List

**Date:** 2026-09-28
**Status:** Ready for review
**Specs:**
- [PlayersWanted v1 — Design](../specs/2026-09-27-players-wanted-v1-design.md) (the core)
- [Match Management Design](../specs/2026-09-27-players-wanted-match-management-design.md) (players, teams, results, Elo, leaderboard)

This is the entry point for building PlayersWanted. The two specs are delivered as **four milestones** (M1–M4, as defined in the match-management spec § Delivery Milestones). Each milestone has its own step-by-step plan, ships on its own, and leaves the app deployable.

| Milestone | Plan | What ships | Tasks |
|---|---|---|---|
| **M1 — v1 core** | [2026-09-28-m1-core.md](2026-09-28-m1-core.md) | Monorepo, Firebase setup, sign-in, post/browse/join games, waitlist, email + push notifications, reminders, venues, PWA, CI/CD | 20 |
| **M2 — Players & game controls** | [2026-09-28-m2-players.md](2026-09-28-m2-players.md) | Public player profiles, avatars, positions, pitch field, audit log, `addPlayer`, `deleteGame`, `deleteAccount`, "new games in my area" | 9 |
| **M3 — Teams** | [2026-09-28-m3-teams.md](2026-09-28-m3-teams.md) | Team names/colours, manual assignment, auto-balance, publish + notifications | 5 |
| **M4 — Results, Elo & leaderboard** | [2026-09-28-m4-results.md](2026-09-28-m4-results.md) | Submit / correct / void results, Elo, stats, leaderboard, player history, nudges, admin tools, `recomputeRatings` | 13 |

## How to use these plans

- Work through the milestones **in order**. Each plan lists its prerequisites, and later plans refer to names that earlier plans create (for example `performLeave`, `writeAudit`, `callable`).
- Each task follows TDD: write the failing test, watch it fail, implement, watch it pass, commit. Every task ends with a commit.
- Every plan starts with **Global Constraints** (exact limits copied from the spec) and a **Review Focus** list (edge cases that each have a test). Read both before starting a milestone.
- Tick the boxes below as tasks merge, so this file stays the single status view.
- Recommended executor: `superpowers:subagent-driven-development` (fresh implementer + reviewer per task), or `superpowers:executing-plans` to work inline.

## Architecture in one paragraph

npm-workspaces monorepo: `shared/` holds pure TypeScript domain rules with no Firebase imports. `functions/` holds 2nd-gen Cloud Functions in `europe-west2`; each callable is a plain `handler(ctx, input)` that runs a Firestore transaction and returns `{ data, notices }`, and notifications are sent after commit. `web/` is a React + Vite PWA that reads Firestore directly through realtime listeners and calls functions for every game-related write. `rules-tests/` holds security-rules tests. All local work and tests run against the Firebase Emulator Suite with project id `demo-playerswanted`.

---

## Decisions Assumed for Open Items

The specs leave these open. The plans use the defaults below. **Confirm or change them before starting the milestone shown.** Each default is isolated so changing it is a small edit.

| # | Open item (spec) | Default used in the plans | Where it lives | Needed by |
|---|---|---|---|---|
| v1-1 | Initial list of areas | Placeholder `Town Centre / North / South` | `scripts/areas.json` | M1 go-live |
| v1-2 | Formats | `5v5`, `6v6`, `7v7` | `FORMATS` in `shared/src/types.ts` | M1 Task 2 |
| v1-3 | Currency | GBP, integer pence | `formatPence`, `parsePounds` | M1 Task 2 |
| v1-4 | Reminder timing | 24h only | `functions/src/reminders.ts` | M1 Task 11 |
| MM-1 | Groups vs areas | Areas only (option a) | whole design | before M2 |
| MM-2 | Rating scope | One global rating per player | `players/{uid}.rating` | M4 |
| MM-3 | Guest (unregistered) players | Not supported | `validateResult` | M4 |
| MM-4 | K-factor | Flat 32 | `K_FACTOR` in `shared/src/elo.ts` | M4 Task 1 |
| MM-5 | Co-organisers | One organiser per game (admins can act on results) | `assertOrganiser` | M4 |
| MM-6 | Correction window | 72 hours | `CORRECTION_WINDOW_MS` | M4 Task 7 |

## Deviations and Gaps Found While Planning (please confirm)

Writing concrete tasks turned up places where the specs are silent or can't be built exactly as written. Each item below is a deliberate choice, with its reason.

1. **Reminder window is 23h–24h, not 23.75h–24h** (M1 Task 11). A late 15-minute scheduler run could otherwise skip a game entirely. `reminderSentAt` still guarantees one reminder per game. Moving a game's time resets `reminderSentAt`, which the spec didn't mention.
2. **Unpublished teams are hidden in the UI only** (M3). Firestore rules cannot hide one field (`teamId`) on participant docs that every signed-in user can read. The alternative is an organiser-only draft doc copied onto participants at publish time, which is more code. Recommendation: accept UI-only hiding (team drafts aren't sensitive).
3. **`setPaid` stays allowed on completed games** (M4). The spec locks completed games completely, but collecting money after the match is the common case.
4. **`players.calibrated` boolean added** (M4). The leaderboard then uses an equality filter plus `orderBy(rating)`, a query Firestore can index. The spec's `ratedGames ASC, rating DESC` index implies a range filter it can't serve with that order.
5. **Account deletion also rewrites the deleted user's name snapshots** on participant docs and `organiserName` to "Former player" (M2 Task 7). Without it, the real name would stay on past rosters, which undercuts the anonymisation the spec asks for.
6. **Delete / Cancel game buttons live on the game detail page**, not on the edit form (M2 Task 9). The detail page already has the live roster needed to decide which one to show.
7. **Integration tests call handlers directly** against the Firestore emulator instead of going through the Functions emulator. This is faster and gives the same transactional behaviour. It's a test-strategy detail, not a product change.
8. **Result nudges skip games with fewer than 2 confirmed players** and look back at most 14 days (M4 Task 8), so a deploy never nudges organisers about ancient or empty games.

## Before You Start

Local development needs only Node 20, Java 11+ (Firestore emulator) and `npm install`. Nothing touches the cloud until deploy.

The one-off cloud setup is written up as `docs/deployment.md` in **M1 Task 20**. It covers the Firebase Blaze project, the **$5 budget alert**, Firestore in `europe-west2`, Auth providers, the VAPID key, a verified Resend domain and API key, the GitHub variables and service-account secret, and seeding real areas. Do it before the first push to `main`.

---

## Master Task List

### M1 — v1 core ([plan](2026-09-28-m1-core.md))

- [ ] T1 Monorepo and tooling scaffold
- [ ] T2 Shared domain types, errors, serialisation and London-time formatting
- [ ] T3 Game input validation (incl. editing after kick-off)
- [ ] T4 Roster logic — join (waitlist, idempotent re-join)
- [ ] T5 Roster logic — leave and capacity change (ordered promotion)
- [ ] T6 Firestore security rules, indexes and rules tests
- [ ] T7 Functions package and callable infrastructure (+ integration harness)
- [ ] T8 Notifications — templates, email/push channels, emulator outbox, dispatch
- [ ] T9 `createGame`, `updateGame`, `cancelGame`
- [ ] T10 `joinGame`, `leaveGame`, `removePlayer`, `setPaid` (+ concurrent-join test)
- [ ] T11 Scheduled 24h reminders
- [ ] T12 Wire deployed functions; emulator seed script
- [ ] T13 Web scaffold (Vite PWA, service worker, Firebase, layout, error messages)
- [ ] T14 Auth — Google + email link, onboarding, safe return path
- [ ] T15 Games list by area
- [ ] T16 Game detail — live roster, join/leave, share, organiser controls
- [ ] T17 Create / edit game form with venue picker
- [ ] T18 My games
- [ ] T19 Profile and push notifications
- [ ] T20 CI/CD, deployment runbook, manual checklist, README

### M2 — Players & game controls ([plan](2026-09-28-m2-players.md))

- [ ] T1 Shared player model, pitch, and M1 type extensions
- [ ] T2 Security rules for players, audit, profile fields and avatars (+ Storage rules tests)
- [ ] T3 `onUserWrite` trigger mirrors profiles into `players` (+ backfill script)
- [ ] T4 Audit log, pitch on games, "new game in my area" notices
- [ ] T5 `addPlayer`
- [ ] T6 `deleteGame`
- [ ] T7 `deleteAccount` (anonymise, cancel organised, leave joined)
- [ ] T8 Web — avatar, position, new-game toggle, delete account
- [ ] T9 Web — player page, add-player search, delete game, pitch

### M3 — Teams ([plan](2026-09-28-m3-teams.md))

- [ ] T1 Shared team model, assignment validation, publish rules
- [ ] T2 `balanceTeams` (exhaustive ≤ 16, snake draft above)
- [ ] T3 Roster effects and team notifications
- [ ] T4 Team callables (`updateTeamDetails`, `assignTeams`, `autoBalanceTeams`, `publishTeams`, `clearTeams`)
- [ ] T5 Web — Teams tab and published teams view

### M4 — Results, Elo & leaderboard ([plan](2026-09-28-m4-results.md))

- [ ] T1 Elo maths
- [ ] T2 Result input parsing and submission rules
- [ ] T3 Build / apply / reverse / replay results (pure)
- [ ] T4 Completed-game lock, new fields, result notifications
- [ ] T5 Rules and indexes for results and leaderboards
- [ ] T6 `submitResult` (+ concurrent-submit test)
- [ ] T7 `correctResult` and `voidResult` (72h + chain guard)
- [ ] T8 Awaiting-result nudges
- [ ] T9 Admin — `recomputeRatings` (callable + script), admin-claim script
- [ ] T10 Web — submit / correct result screen
- [ ] T11 Web — result panel, awaiting-result prompts, player history
- [ ] T12 Web — leaderboard
- [ ] T13 Web — minimal admin page; admin docs

---

## Spec Coverage Map

| Spec requirement | Milestone / task |
|---|---|
| Post / edit / cancel game | M1 T9, T17 |
| Browse by area | M1 T15 |
| Join / leave / organiser remove | M1 T10, T16 |
| Waitlist with auto-promotion | M1 T4, T5, T10 |
| Email + web push, per-user prefs | M1 T8, T19 |
| Venues as reusable entities | M1 T6 (rules), T17 |
| Cost per player + paid tracking | M1 T2, T10, T16 |
| Shareable links before sign-in | M1 T6 (public game read), T14, T16 |
| 24h reminders | M1 T11 |
| Offline shell, disabled actions offline | M1 T13, T16, T17 |
| Security rules + rules tests | M1 T6, M2 T2, M4 T5 |
| CI on PR, deploy on main | M1 T20 |
| Player profiles, avatar, position | M2 T1–T3, T8, T9 |
| Pitch number | M2 T1, T4, T9 |
| `addPlayer`, `deleteGame`, `deleteAccount` | M2 T5–T7 |
| Audit log | M2 T4 (+ used in M3/M4) |
| New games in my area (opt-in) | M2 T4, T8 |
| Teams: details, assign, auto-balance, publish, clear | M3 T1–T5 |
| Result submit / correct / void | M4 T2, T3, T6, T7, T10, T11 |
| Elo with goal-difference multiplier, calibration | M4 T1, T3 |
| Leaderboard (area) | M4 T12 |
| Awaiting-result nudge | M4 T8 |
| Admin tools + `recomputeRatings` | M4 T9, T13 |

## Out of Scope (per both specs)

Game chat, recurring games, map/distance search, in-app payments, private groups (see MM-1), guest players, player-claimed goals / MOTM, native apps, Apple sign-in (can be added later through Firebase Auth without schema changes).
