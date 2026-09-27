# PlayersWanted — Match Management Design (Games, Players, Teams, Results)

**Date:** 2026-09-27
**Status:** Draft — awaiting review
**Extends:** [PlayersWanted v1 — Design](2026-09-27-players-wanted-v1-design.md)
**Source requirements:** *Product Requirements Document: 5-a-Side Match Tracker* (repo root, `.docx`)

## Purpose

The v1 design covers posting, finding and joining games. It defers teams, results and stats. The PRD marks **Match Resolution**, **Leaderboard** and the **Elo rating system** as P1 and **Team Generation** as P2, so they belong in the first release.

This document adds complete create/read/update/delete (CRUD) controls for the four core entities (**Game**, **Player**, **Team** and **Result**) and the rating and leaderboard features built on them. It follows the v1 architecture rules: clients read Firestore directly, every write to game-related data goes through a callable Cloud Function, and pure domain logic lives in `shared/`.

**Terminology:** the PRD says "Match" and the v1 design says "Game". They mean the same thing. Code, collections and function names use `game`. The UI can say "match" where it reads better (for example "Match result").

## PRD Reconciliation

How each PRD requirement maps onto the design, and where the design deliberately differs.

| PRD item | Priority | Where it is covered | Notes / deviation |
|---|---|---|---|
| Authentication | P1 | v1 design | Email magic link + Google. PRD also lists email/password and Apple. Passwords are excluded on purpose. **Apple** can be added later through Firebase Auth without schema changes. |
| Profile management | P1 | This doc, [Player](#player) | Adds profile picture and preferred position to the v1 profile. |
| Group management | P1 | **Not covered** | v1 uses public **areas** in place of private groups. See [Open Items](#open-items) #1. |
| Match scheduling | P1 | v1 design + [Game](#game) | Adds the PRD's **pitch number** field. |
| RSVP (In/Out) + waitlist | P1 | v1 design | Join = "In", Leave = "Out". PRD also wants "notifications of new matches". Added as an opt-in `newGamesInArea` notification. |
| Team generation (manual + auto-balance) | P2 | This doc, [Team](#team) | |
| Match resolution | P1 | This doc, [Result](#result) | |
| Leaderboard | P1 | This doc, [Leaderboard](#leaderboard) | Per **area** rather than per group (see Open Items #1). |
| Elo rating system | — | This doc, [Ratings](#ratings-elo) | |
| Tech stack (Next.js, Node/Python, PostgreSQL) | — | v1 design | The v1 design chose React + Vite + Firebase. That decision stands: atomic roster transactions, realtime rosters and web push come from one platform inside free quotas. The relational chain in the PRD (Users → Groups → Matches → Teams → Scores) maps onto the collections below. |
| Out of scope: payments, granular stats, public matchmaking, native apps | — | — | Same as the PRD. Goals per player are an **optional organiser-entered** field here, since the leaderboard shows goals "if tracked". Player-claimed goals and MOTM stay out of scope. |

## Roles

| Role | Who | How it is determined |
|---|---|---|
| **Anonymous** | Not signed in | No Firebase Auth user |
| **Player** | Any signed-in user | Firebase Auth user whose `players/{uid}.status` is `active` |
| **Participant** | A player on a game's roster (confirmed or waitlisted) | `games/{gameId}/participants/{uid}` exists |
| **Organiser** | The creator of a game | `games/{gameId}.organiserUid == uid` |
| **Admin** | App operators | Firebase custom claim `admin: true`, set by script |

Every callable checks the caller's role on the server. Security rules enforce the same limits on direct reads and writes.

## Entity Lifecycles

### Game

```
             createGame
                 │
                 ▼
  ┌──────── scheduled ────────┐
  │ cancelGame    │ kick-off  │ deleteGame (only if no
  ▼               ▼ passes    ▼  other participants and
cancelled   awaiting result  (removed)  never resulted)
            (derived: scheduled
             + startsAt in past)
                  │ submitResult
                  ▼
              completed ◄──── correctResult (within the correction window)
                  │ voidResult
                  ▼
           awaiting result
```

- `status` stores `scheduled | cancelled | completed`. "Awaiting result" and "past" are **derived** from `status == scheduled` and `startsAt < now`, following the v1 pattern for derived states.
- A **cancelled** game is read-only. It cannot be uncancelled; the organiser posts a new game instead, which gives everyone a clean notification.
- A **completed** game is **locked**. Roster, teams and details cannot change. Only `correctResult` and `voidResult` can touch it.

### Result

`submitted → corrected (0..n times) → voided` (optional). A voided result reverses its rating changes and puts the game back to "awaiting result", so a fresh result can be submitted.

## Data Model Changes (Firestore)

New collections and new fields on v1 collections. Fields not listed here are unchanged from the v1 design.

| Path | Fields | Written by |
|---|---|---|
| `users/{uid}` *(changed)* | + `preferredPosition?: "GK" \| "DEF" \| "MID" \| "FWD" \| "ANY"`, + `photoURL?` (now user-settable), + `notify.newGamesInArea: bool` (default `false`) | Owner |
| `players/{uid}` **(new, public profile)** | `displayName`, `displayNameLower` (for prefix search), `photoURL?`, `preferredPosition?`, `homeAreaId`, `status: "active" \| "deleted"`, `rating` (int, starts 1200), `ratedGames`, `wins`, `draws`, `losses`, `goals`, `gamesPlayed`, `noShows`, `lastResultAt?`, `createdAt`, `updatedAt` | Functions only (mirrored from `users` by trigger; stats by result functions) |
| `games/{gameId}` *(changed)* | + `pitch?` (string, e.g. `"3"`), `status` gains `"completed"`, + `teams: { A: { name, colour }, B: { name, colour } }`, + `teamsPublishedAt?`, + `resultSummary?: { scoreA, scoreB, rated, submittedAt }` (snapshot for list views) | Functions only |
| `games/{gameId}/participants/{uid}` *(changed)* | + `teamId?: "A" \| "B"`, + `attendance?: "played" \| "no_show"` (set at resolution), + `addedByOrganiser: bool` | Functions only |
| `results/{gameId}` **(new)** | `gameId`, `areaId`, `startsAt`, `scoreA`, `scoreB`, `lineups: { A: uid[], B: uid[] }`, `playerUids: uid[]` (A ∪ B, for queries), `noShows: uid[]`, `goals?: { [uid]: int }`, `rated: bool`, `ratingChanges: { [uid]: { before, delta } }`, `version` (int, +1 per correction), `status: "final" \| "voided"`, `submittedBy`, `submittedAt`, `correctedAt?`, `voidedAt?`, `voidReason?` | Functions only |
| `games/{gameId}/audit/{autoId}` **(new)** | `actorUid`, `action` (e.g. `removePlayer`, `assignTeams`, `submitResult`, `correctResult`), `details` (small map), `at` | Functions only |

**Why a separate public `players` collection:** `users/{uid}` holds email and notification settings and stays owner-only. Leaderboards, player pages, team lists and result lineups need public data about other players. A Firestore trigger (`onUserWrite`) copies the public fields into `players/{uid}`, so the client still edits its own `users` doc directly, as in v1, and nothing private leaks.

**Why `results` is top-level:** a player's match history is a single query (`playerUids array-contains uid`, ordered by `startsAt`). The same query on a subcollection would need a collection-group index over every game.

**Profile pictures:** Google sign-in supplies `photoURL`. Uploads go to **Cloud Storage** at `avatars/{uid}.jpg` (free tier: 5 GB). The client resizes to 256×256 before upload. Storage rules allow only the owner to write, with images only, ≤ 1 MB.

### Read access (additions to v1 rules)

- `players/*`: readable by signed-in users. Anonymous visitors cannot browse players.
- `results/*`: public read, so a shared completed-game link shows the score before sign-in. Lineups show display names only, looked up from `players` after sign-in.
- `games/*/audit/*`: organiser of that game and admins only.
- No client writes to `players`, `results` or `audit`.

### New indexes

- `results`: `playerUids ARRAY_CONTAINS, startsAt DESC` (player match history).
- `results`: `areaId ASC, startsAt DESC` (recent results in an area).
- `players`: `homeAreaId ASC, status ASC, ratedGames ASC, rating DESC` (area leaderboard, calibrated players only).
- `players`: `status ASC, displayNameLower ASC` (organiser "add player" search).
- `games`: `organiserUid ASC, status ASC, startsAt ASC` (organiser's "awaiting result" list).

## CRUD Controls

Every operation below is a **callable Cloud Function** unless marked *client* (direct Firestore/Storage write allowed by rules) or *trigger*. Error codes follow the v1 convention: `unauthenticated`, `permission-denied`, `not-found`, `failed-precondition`, `invalid-argument`.

### Game

| Op | Function | Who | Rules |
|---|---|---|---|
| Create | `createGame` *(v1)* | Player | Adds optional `pitch` (≤ 10 chars). Initialises `teams` to `{A: {name: "Bibs", colour: "orange"}, B: {name: "Non-bibs", colour: "white"}}`. If `startsAt` is ≥ 2h away, notifies players whose `homeAreaId` matches and who opted in to `newGamesInArea`. |
| Read | *client* | Anyone | v1 list, detail and "My games". "My games" gains an **Awaiting result** section for organisers. |
| Update | `updateGame` *(v1)* | Organiser | v1 rules, plus: rejected once `status` is `completed` or `cancelled`. `startsAt` cannot move into the past. Editing is allowed after kick-off (e.g. fixing the venue) until a result is submitted. |
| Cancel | `cancelGame` *(v1)* | Organiser | Rejected if `completed`. Notifies participants. |
| Delete | `deleteGame` **(new)** | Organiser, Admin | Allowed only when the game has **no participants other than the organiser** and has **never had a result**. Deletes the game and its subcollections. This is for "created by mistake". Anything else must be **cancelled** so participants are told. Admins can delete any game, for moderation. |

**Validation (create/update):** `startsAt` between now and 90 days ahead; `durationMins` 30–180; `capacity` 6–22 and even; `costPerPlayerPence` 0–5000; `notes` ≤ 500 chars; `format` from the allowed list (Open Items, v1 #2).

### Player

| Op | Function | Who | Rules |
|---|---|---|---|
| Create | *trigger* `onUserWrite` | System | On first sign-in the client creates `users/{uid}` (v1 onboarding). The trigger creates `players/{uid}` with `rating: 1200` and zeroed stats. |
| Read | *client* | Signed-in | Player page: public profile, calibrated rating (or "Calibrating 1/3"), W/D/L, win %, goals, recent results. |
| Update (profile) | *client* on `users/{uid}` → *trigger* mirrors | Owner | `displayName` 2–30 chars, trimmed; `preferredPosition` from the enum; `homeAreaId` must exist. Renames do **not** rewrite old snapshots on games and participants; those stay as they were at the time. |
| Update (avatar) | *client* upload to Storage, then set `users.photoURL` | Owner | Rules above. |
| Update (stats/rating) | Result functions only | System | Never writable by clients or through the profile. |
| Add to a game roster | `addPlayer` **(new)** | Organiser | Adds an existing player (found by name search) to a game, e.g. someone who turned up on the night. Uses the same capacity/waitlist logic as `joinGame`, with `addedByOrganiser: true`. Allowed before and after kick-off, but not once the game is completed. Notifies the added player. |
| Remove from a game roster | `removePlayer` *(v1)* | Organiser | Also clears the player's `teamId`. |
| Delete (account) | `deleteAccount` **(new)** | Owner, Admin | Replaces the v1 "manual on request" process. **Anonymises** rather than hard-deletes, so past results and other players' ratings stay intact: `players/{uid}` becomes `displayName: "Former player"`, `photoURL` removed, `status: "deleted"`. The `users/{uid}` doc, push tokens, avatar file and Auth user are deleted. Upcoming games the user **organises** are cancelled (with notifications). The user **leaves** any upcoming games they joined, which triggers waitlist promotion. Asks for confirmation in the UI by typing the display name. |

Deleted players are excluded from leaderboards and name search, and cannot be added to games.

### Team

Teams exist only as the pair **A** and **B** on a game. The game doc stores team **details** (name, bib colour). Each participant doc stores its own **membership** in `teamId`, so a player's team is changed with a single-document write and is never duplicated. Only **confirmed** participants can be on a team.

| Op | Function | Who | Rules |
|---|---|---|---|
| Create | Implicit with `createGame` | — | Default names and colours (above). |
| Read | *client* | Participants; Anyone once published | Before publishing, only the organiser sees assignments. After `teamsPublishedAt` is set, everyone who can see the roster sees the teams. |
| Update details | `updateTeamDetails` **(new)** | Organiser | `name` 1–20 chars, `colour` from a fixed palette of 8. |
| Update membership | `assignTeams` **(new)** | Organiser | Input: `{ [uid]: "A" \| "B" \| null }` for any subset of confirmed participants. Applied in one transaction. Rejects uids that are not confirmed. Allowed until the game is completed. If teams are already published and the change is after publishing, the affected players are notified. |
| Auto-balance | `autoBalanceTeams` **(new)** | Organiser | Proposes assignments for **all** confirmed players using [Auto-balance](#auto-balance) and returns them **without saving**. The UI shows the proposal; the organiser can tweak it and then confirm with `assignTeams`. |
| Publish / unpublish | `publishTeams` **(new)** | Organiser | Publishing requires every confirmed player to be assigned and team sizes to differ by ≤ 1. It sets `teamsPublishedAt` and notifies confirmed players ("You're in Bibs"). Unpublish clears it without notifying. |
| Delete (clear) | `clearTeams` **(new)** | Organiser | Sets `teamId` to null for all participants and unpublishes. |

**Automatic roster effects:**

- A confirmed player who **leaves** or is **removed** loses their `teamId`. If teams were published, the organiser is notified that the teams are now uneven.
- A player **promoted** from the waitlist starts with no team, and the organiser is prompted to assign them.
- **Lowering capacity** can't remove confirmed players (v1 rule), so it has no effect on teams.

#### Auto-balance

Pure function in `shared/`: `balanceTeams(players: {uid, rating, preferredPosition}[]) → {A: uid[], B: uid[]}`.

1. For *n* confirmed players, list every split into sizes ⌊n/2⌋ and ⌈n/2⌉. For 10 players that is C(10,5)/2 = 126 splits; at the maximum capacity of 22 it is ~350k, which is still fast enough in a function. Above 16 players, fall back to a greedy snake draft sorted by rating.
2. Pick the split with the smallest |avg(A) − avg(B)|.
3. Tie-break: prefer the split that puts one `GK`-preferring player on each side, then the split with the smallest rating spread difference.
4. Uncalibrated players use their current rating (1200 for new players).

### Result

A result records the **final score**, the **final lineups** (who actually played, on which side), **no-shows**, and optionally **goals** per player. Submitting a result locks the game and applies rating changes.

| Op | Function | Who | Rules |
|---|---|---|---|
| Create | `submitResult` **(new)** | Organiser | See [Submission rules](#submission-rules). Creates `results/{gameId}`, sets game `status: "completed"` and `resultSummary`, sets `attendance` on each participant, updates `players` ratings and stats, writes an audit entry, and after commit notifies every player in the lineups of the score and their rating change. |
| Read | *client* | Anyone (score); signed-in (names) | Game detail shows the result panel. Player pages list results. Area page lists recent results. |
| Update | `correctResult` **(new)** | Organiser (within window), Admin (any time) | Same input as submit. See [Corrections](#corrections-and-voids). Increments `version` and notifies affected players if their rating change differs. |
| Delete | `voidResult` **(new)** | Organiser (within window), Admin | Requires a `reason` (≤ 200 chars). Reverses all stat and rating changes, sets result `status: "voided"`, clears `resultSummary` and `attendance`, and returns the game to `scheduled` (so it shows as awaiting result). The voided result doc is kept for audit. The next `submitResult` overwrites it with `version` continuing. |

#### Submission rules

- The game is `scheduled` (not cancelled or completed) and `startsAt + durationMins` has passed. Submitting at kick-off time is not allowed.
- `scoreA` and `scoreB` are integers 0–99.
- `lineups.A` and `lineups.B` are disjoint. Every uid is a participant of the game (confirmed or waitlisted: a waitlisted player may have played when someone didn't show) or was added with `addPlayer`. Deleted players are rejected.
- Lineups default in the UI to the published teams. The organiser adjusts them for last-minute changes.
- `noShows` must be **confirmed** participants who are not in either lineup. Confirmed players left out of both lineups and `noShows` are rejected. The organiser must decide on each one, which is what the PRD means by "confirms the final list of attendees".
- `goals` is optional. Every key is in a lineup, and the goals for each side cannot exceed that side's score. Goals can be under-reported (not every goal attributed).
- **Rated vs unrated:** the result is `rated` only if each lineup has **≥ 3 players** and the sizes differ by **≤ 1**. Unrated results still count toward games played, W/D/L and goals, but not rating. The UI warns before submitting an unrated result.

#### Corrections and voids

Ratings chain from one game to the next, so changing an old result would make every later rating change for those players wrong. To keep ratings exact:

- The organiser can correct or void a result **within 72 hours** of first submission, **and** only while **no player in either the old or new lineups has a later result**. Otherwise the function returns `failed-precondition` with "Ask an admin to correct this result".
- A correction first reverses the stored `ratingChanges` and stat increments exactly, then applies the new result as if it were being submitted fresh. This all happens in one transaction.
- **Admins** can correct or void any result. When the chain condition fails, the admin tool runs **`recomputeRatings`**, a script that resets all players to 1200 and zeroed stats and replays every `final` result in `startsAt` order. The same script is the repair tool for any rating drift.

## Ratings (Elo)

Pure function in `shared/`: `rateGame(lineups, ratings, scoreA, scoreB) → { [uid]: delta }`.

1. **Team averages:** R_A = mean rating of lineup A; R_B = mean rating of lineup B.
2. **Expected score for A:** E_A = 1 / (1 + 10^((R_B − R_A) / 400)).
3. **Actual score for A:** S_A = 1 for a win, 0.5 for a draw, 0 for a loss.
4. **Goal-difference multiplier:** with gd = |scoreA − scoreB|, G = 1 when gd ≤ 1, otherwise G = min(2, 1 + ln(gd) / 2). A 2-goal margin gives about ×1.35, 5 goals ×1.80, and 8+ goals is capped at ×2. The cap stops a 15–3 thrashing from swinging ratings wildly, since 5-a-side scores run higher than 11-a-side.
5. **Change:** Δ = round(K × G × (S_A − E_A)) with **K = 32**.
6. **Distribution:** every player in lineup A gets **+Δ**, every player in lineup B gets **−Δ**, as in the PRD. No-shows are not rated.

**Calibration:** `players.ratedGames < 3` means the rating is **hidden**. The UI shows "Calibrating (1/3)", and the player is left out of leaderboards. It is still used internally for auto-balance and Elo. The PRD's base of 1200 applies to all new players.

**Stored with each result:** `ratingChanges[uid] = { before, delta }`, which makes corrections exactly reversible and lets the UI show "+14" next to each player.

**Unit tests:** equal teams + win → +16 × G; draw between equal teams → 0; heavy favourite wins by 1 → small positive Δ; underdog wins → large Δ; G values at gd 0, 1, 2, 5, 20 (capped); rounding; zero-sum between sides when lineups are the same size.

## Leaderboard

- **Area leaderboard** (the PRD's per-group leaderboard, adapted to areas): calibrated, active players whose `homeAreaId` is the area, sorted by rating. Columns: rank, player, rating, games played, W/D/L, win %, goals.
- Other sort options (games played, win %, goals) are sorted **on the client** over the loaded top 200. At local-circle scale that avoids an index per column.
- **Win %** = wins / (wins + draws + losses), shown once `gamesPlayed ≥ 3`.
- Players who have not played in **90 days** are hidden by default ("Show inactive" toggle), which stops the board filling with people who have left.

## Notifications (additions to v1)

| Event | Recipient | Default |
|---|---|---|
| New game in my area | Opted-in players in the area | Off |
| Teams published | Confirmed players | On |
| My team changed after publishing | Affected player | On |
| Added to a game by the organiser | Added player | On |
| Result submitted (score + my rating change) | Players in the lineups | On |
| Result corrected or voided | Players in the old or new lineups | On |
| Game awaiting result for 24h | Organiser (one nudge) | On |

Same delivery rules as v1: sent after commit, failures are logged and never fail the action. The "awaiting result" nudge is added to the existing 15-minute scheduled function, using a new `resultNudgeSentAt` field on the game.

## Screens (additions to v1)

1. **Game detail:** new **Teams** tab for the organiser (tap a player to move them between A/B; Auto-balance button showing the proposal with average ratings for each side; Publish). Once published, participants see two columns in team colours. After the game, the organiser sees a **Submit result** banner. When completed, a **Result panel** shows the score, lineups, goals and ± rating per player.
2. **Submit / correct result:** score steppers for each team; lineups pre-filled from the teams, with drag between A / B / Didn't play; optional goals stepper per player; "Unrated" warning when the rules aren't met; confirmation step summarising rating changes before submit.
3. **Player page:** avatar, name, position, rating (or calibrating), stats, recent results. Reached from any name on a roster, lineup or leaderboard.
4. **Leaderboard:** area picker (defaults to home area), sortable columns, "Show inactive" toggle.
5. **Profile (v1 screen):** adds avatar upload, preferred position, the "new games in my area" toggle, and a **Delete account** section.
6. **Create / edit game (v1 screen):** adds the pitch field. The Delete action only appears when deletion is allowed, and Cancel is shown otherwise.
7. **My games (v1 screen):** adds an **Awaiting result** section at the top for organisers.
8. **Admin (minimal, admin claim only):** find game → correct / void result; find player → delete account; run `recomputeRatings`. It can be a hidden route rather than a full console.

## Repository Additions

```
shared/
  roster.ts        (v1)  join/leave/promote/capacity rules
  teams.ts         new   balanceTeams, team publish validation
  results.ts       new   validateResult, applyResult / reverseResult (stat deltas)
  elo.ts           new   rateGame, goal-difference multiplier
functions/
  games.ts         + deleteGame, addPlayer
  teams.ts         new   assignTeams, updateTeamDetails, autoBalanceTeams, publishTeams, clearTeams
  results.ts       new   submitResult, correctResult, voidResult
  players.ts       new   onUserWrite trigger, deleteAccount
  admin/recomputeRatings.ts   new (script run with the Admin SDK)
storage.rules      new
```

## Testing (additions to v1)

- **Unit (`shared/`):** Elo cases above; `balanceTeams` (optimal split on known inputs, GK tie-break, odd counts, greedy fallback above 16); `validateResult` (every rejection rule, including goals exceeding the score and confirmed players left unaccounted for); `applyResult` then `reverseResult` gives back exactly the starting stats.
- **Integration (emulators):** submit → correct → void round-trip leaves players exactly as before; correction is blocked when a player has a later result; leaving a game clears `teamId`; `deleteGame` is refused once another player has joined; `deleteAccount` cancels organised games, promotes waitlists and anonymises the player while their results still render; concurrent `submitResult` calls → exactly one succeeds.
- **Rules:** clients cannot write `players`, `results` or `audit`; anonymous users can read `results` but not `players`; only the owner can write their avatar; only the organiser can read the audit log.
- **`recomputeRatings`:** replaying a seeded history gives the same ratings as the incremental path.

## Delivery Milestones

Delivered in order within v1. Each one ships on its own.

1. **M1 — v1 core** (existing design): games, roster, waitlist, notifications, venues.
2. **M2 — Players & game controls:** `players` collection + trigger, avatars, preferred position, player page, `deleteGame`, `addPlayer`, `deleteAccount`, pitch field, audit log.
3. **M3 — Teams:** team details, manual assignment, auto-balance, publish, notifications.
4. **M4 — Results, Elo & leaderboard:** submit / correct / void, ratings, stats, leaderboard, awaiting-result nudges, admin tools and `recomputeRatings`.

## Open Items

1. **Groups vs areas.** The PRD centres on **private groups** with invite links. The v1 design chose **open games browsed by area**. Options: (a) keep areas only (this doc's assumption); (b) add groups as an optional layer: a `groups` collection with members and an invite token, games can be posted to a group (visible to members only) or publicly to an area, and leaderboards per group as well as per area. Option (b) fits the data model without breaking changes and is the recommended follow-up if the target users are regular fixed groups.
2. **Rating scope.** One global rating per player (assumed), or a separate rating per group/area?
3. **Guest players** (not registered) in lineups: not supported. Should organisers be able to add named guests who are excluded from rating?
4. **K-factor:** a flat 32 is assumed. Should calibration games use a higher K (e.g. 48) so new players settle faster?
5. **Co-organisers:** one organiser per game is assumed. Should an organiser be able to delegate result submission?
6. **Correction window:** 72 hours assumed.
