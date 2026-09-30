# PlayersWanted v1 — Design

**Date:** 2026-09-27
**Status:** Draft — awaiting review

## Problem

Organising a casual 5-a-side game means chasing people in group chats to fill spots, and anyone outside the chat has no way to find a game that needs players. PlayersWanted lets someone post a game that needs players, lets others in the area find it and join, and gives the organiser a live roster — replacing "who's in?" message threads.

## Goals and Constraints

Decided during brainstorming:

- **Audience:** open pickup games. v1 targets a local circle (friends-of-friends, one town, tens to low hundreds of users), but nothing in the design should block opening it to the general public later.
- **Identity:** real accounts from day one via **Firebase Auth** — email magic link and Google sign-in. No passwords. Phone/SMS sign-in is excluded (it is the only billed method).
- **Platform:** a mobile-first **PWA**, shared by link (e.g. dropped into a WhatsApp group), installable to the home screen. No native app, no app stores.
- **Cost:** stay inside free quotas at local-circle scale.

**Success looks like:** an organiser posts a game in under a minute, shares the link, and the roster fills (with a waitlist absorbing drop-outs) without the organiser sending a single chase message.

## Scope

**In v1:**

1. Post, edit and cancel a game (venue, date/time, duration, format, capacity, cost per player, notes).
2. Browse upcoming games as a list filtered by **area**.
3. Join / leave a game; organiser can remove a player.
4. **Waitlist** with automatic promotion when a confirmed player leaves.
5. **Notifications** by email and web push (events listed below), with per-user on/off preferences.
6. **Venues** as saved, reusable entities.
7. **Cost per player** display, with the organiser tracking who has paid (tracking only — no payment processing).
8. Shareable game links that show game details before sign-in.

**Extended by [Match Management Design](2026-09-27-players-wanted-match-management-design.md):** player profiles, team assignment and auto-balance, result recording, no-show tracking, Elo ratings, leaderboards, game deletion and self-serve account deletion. These are delivered as milestones M2–M4 after this core.

**Still deferred (the data model leaves room for these):** game chat, recurring games, map/distance search, in-app payments, moderation tooling beyond the minimal admin screen.

## Architecture

All-Firebase, to sit naturally alongside Firebase Auth:

```
PWA (React + Vite + TypeScript, vite-plugin-pwa)
   │  Firebase JS SDK: Auth, Firestore (reads + realtime), Functions (callable), Messaging
   ▼
Firebase
   ├─ Auth            — email link + Google
   ├─ Firestore       — users, areas, venues, games, participants
   ├─ Cloud Functions — all game/roster writes, notifications, scheduled reminders (TypeScript, 2nd gen)
   ├─ Cloud Messaging — web push
   └─ Hosting         — static PWA
Email: Resend API, called from Cloud Functions
```

**Why all-Firebase:** joining, leaving and waitlist promotion must be atomic across a game and its participants, which Firestore transactions handle directly. Firestore realtime listeners give a live roster for free. FCM is the push channel regardless of host. Choosing one platform means one console, one emulator suite for local dev, and one deploy command.

**Key rule:** clients **read** Firestore directly, but every write to games and participants goes through a **callable Cloud Function**. Security rules deny client writes to those collections. The server is then the only authority on capacity, waitlist order and permissions — the property that matters most once the app goes public.

### Repository layout

```
web/        React PWA
functions/  Cloud Functions (bundled with esbuild so shared/ code is inlined at deploy)
shared/     Domain types + pure roster logic (join/leave/promote rules), used by both
firestore.rules, firestore.indexes.json, firebase.json
```

## Data Model (Firestore)

| Path | Fields | Written by |
|---|---|---|
| `users/{uid}` | `displayName`, `email`, `photoURL?`, `homeAreaId`, `notify: { email: bool, push: bool }`, `createdAt` | Owner (rules restrict to own doc) |
| `users/{uid}/pushTokens/{token}` | `createdAt`, `userAgent` | Owner |
| `areas/{areaId}` | `name`, `order` | Admin only (seeded) |
| `venues/{venueId}` | `name`, `areaId`, `address`, `mapsUrl?`, `createdBy`, `createdAt` | Any signed-in user (rules validate shape) |
| `games/{gameId}` | `organiserUid`, `organiserName`, `venueId`, `venue: { name, address, areaId, mapsUrl? }` (snapshot), `areaId`, `startsAt` (timestamp), `durationMins`, `format` (e.g. `"5v5"`), `capacity`, `costPerPlayerPence` (int, GBP), `notes?`, `status: "scheduled" \| "cancelled"`, `confirmedCount`, `waitlistCount`, `reminderSentAt?`, `createdAt`, `updatedAt` | Functions only |
| `games/{gameId}/participants/{uid}` | `uid`, `displayName`, `gameStartsAt` (copied from game; updated if the time changes), `state: "confirmed" \| "waitlisted"`, `joinedAt`, `paid: bool`, `paidUpdatedAt?` | Functions only |

Notes:

- **Areas** are a fixed, admin-curated list (e.g. neighbourhoods or towns). Opening to the public later adds a geohash to venues and games for distance search, alongside `areaId`.
- **Venue snapshot** on the game keeps the list and detail views to a single read, and keeps past games accurate if a venue is later edited.
- **"Full"** is derived (`confirmedCount >= capacity`) and not stored. **"Past"** is derived from `startsAt`.
- **Waitlist order** is `joinedAt` ascending among `waitlisted` participants.
- Money is stored as integer pence to avoid float rounding.

### Read access (security rules)

- `games/*`: public read, so a shared link renders before sign-in.
- `games/*/participants/*`: signed-in users only. Rosters are not exposed to anonymous visitors.
- `venues/*`, `areas/*`: public read.
- `users/{uid}`: owner only. Other users see names only through the snapshots on games and participants.

### Indexes

- `games`: `areaId ASC, status ASC, startsAt ASC` (area list view).
- `participants` collection group: `uid ASC, gameStartsAt ASC` ("My games" as a player; parent games are then fetched by id).
- `games`: `organiserUid ASC, startsAt ASC` ("My games" as organiser).

## Callable Functions

All require a signed-in user. Each runs in a Firestore transaction when it touches roster state.

| Function | Who | Behaviour |
|---|---|---|
| `createGame` | Any user | Validate input, snapshot the venue, create the game with the caller as organiser. The organiser is **not** auto-added as a player (they may be organising only); the UI offers "Join as player" immediately after. |
| `updateGame` | Organiser | Edit details. Capacity cannot drop below `confirmedCount`. Raising capacity promotes waitlisted players in order. Time changes also update `gameStartsAt` on every participant doc. Time or venue changes notify all participants. |
| `cancelGame` | Organiser | Set `status: "cancelled"` and notify all participants. |
| `joinGame` | Any user | No-op if already a participant. Reject if the game is cancelled or has started. Confirm if there is a space, otherwise waitlist. Update counts. Notify the organiser. |
| `leaveGame` | Participant | Remove the participant. If they were confirmed and the waitlist is non-empty, promote the earliest waitlisted player. Update counts. Notify the organiser, and notify the promoted player. |
| `removePlayer` | Organiser | Same as `leaveGame` for a named uid. Also notifies the removed player. |
| `setPaid` | Organiser | Toggle `paid` on a confirmed participant. |

The join/leave/promote/capacity decisions live as **pure functions in `shared/`** (input: game + participants, output: the changes to apply), and the callables wrap them in a transaction. This keeps the core rules unit-testable without emulators.

**Errors** use `HttpsError` codes: `unauthenticated`, `permission-denied` (not organiser), `not-found`, `failed-precondition` (cancelled, started, capacity below confirmed), `invalid-argument` (validation). The web client maps each code to a user-facing message.

## Notifications

| Event | Recipient |
|---|---|
| Player joined / left / joined the waitlist | Organiser |
| Promoted from the waitlist | Promoted player |
| Removed by the organiser | Removed player |
| Game time or venue changed | All participants |
| Game cancelled | All participants |
| Reminder ~24h before kick-off | Confirmed players |

- **Delivery:** a `notify(uid, event)` helper reads the user's `notify` preferences, then sends web push via FCM to each of their `pushTokens` and/or email via Resend. Invalid FCM tokens are deleted on send failure.
- **Timing:** notifications are sent **after** the transaction commits, never inside it. A notification failure is logged and never fails the user's action.
- **Reminders:** a scheduled function runs every 15 minutes. It finds scheduled games starting in 23.75–24h with no `reminderSentAt`, sends the reminders, and sets `reminderSentAt`.
- **Push on iOS** only works once the PWA is installed to the home screen (iOS 16.4+). The UI prompts for push permission only after install and after a meaningful action (e.g. joining a game), never on first load. Email is the reliable default channel.
- **Defaults:** email on; push off until the user grants permission.

## Screens

1. **Sign in** — Google button, or enter an email to receive a sign-in link. On first sign-in, ask for display name and home area.
2. **Games** — upcoming scheduled games in the selected area (defaults to home area). Each card shows date/time, venue, format, cost, and "3 spaces left" / "Full · 2 waiting".
3. **Game detail** — all details, a maps link, the roster (confirmed then waitlist), and a context-aware Join / Leave / Join waitlist button. Share uses the Web Share API with a copy-link fallback. Anonymous visitors see details and "Sign in to join" and return to the game after sign-in. The organiser also sees Edit, Cancel, remove-player and paid toggles.
4. **Create / edit game** — form with a venue picker filtered by area, plus inline "Add venue".
5. **My games** — games I'm organising or playing in, split into upcoming and past.
6. **Profile** — display name, home area, email/push toggles, enable-push flow, sign out.

The roster and game detail use Firestore realtime listeners, so joins and leaves appear live.

## Offline and Errors

- The service worker caches the app shell, so the app opens offline. Firestore's offline cache shows last-seen games.
- Actions (join, create, etc.) require network. When offline, action buttons are disabled with a "You're offline" notice rather than queuing writes.
- Every callable failure shows its mapped message inline next to the action that triggered it.

## Path to Public (not built in v1, designed not to block)

- All ownership and permissions key off Firebase `uid`, and authority sits server-side in functions.
- Distance search: add geohashes to venues and games; `areaId` stays for browsing.
- Abuse controls: add a `users.disabled` flag checked by every callable, plus reporting. Organiser remove-player already exists.
- Reliability: participant docs can gain `attended`/`noShow` fields after a game without schema changes.
- Results: see the Match Management Design (`results/{gameId}`). Recurring games: add a `series` collection that generates games.

## Local Development

- **Firebase Emulator Suite** (Auth, Firestore, Functions, Hosting) for all local work. No cloud resources are touched.
- Vite dev server connects to the emulators when `import.meta.env.DEV` is set.
- A seed script loads sample areas, venues, users and games into the emulator.
- Resend and FCM calls are stubbed to console logging in the emulator.

## Testing

- **Unit (Vitest):** the roster logic in `shared/` — join when there's space, join when full, leave with and without a waitlist, capacity raise promotes in order, capacity cannot drop below confirmed, cannot join cancelled or started games.
- **Integration (Vitest + emulators):** each callable end-to-end, including a concurrent-join test (N users racing for the last space → exactly one confirmed, the rest waitlisted).
- **Security rules (`@firebase/rules-unit-testing`):** clients cannot write games or participants; anonymous users cannot read rosters; users can only write their own profile.
- **Manual checklist:** install the PWA on Android and iOS, receive push and email for each event, share link → sign in → land back on the game.

## CI/CD (GitHub Actions)

- **PR:** lint, type-check (web, functions, shared), unit tests, emulator-backed integration and rules tests.
- **Push to `main`:** the same checks, then `firebase deploy` (hosting, functions, rules, indexes) using a service-account secret.

## Cost

- **Firebase Blaze plan** (pay-as-you-go) is required to deploy Cloud Functions, but usage at this scale sits inside the free quotas:
  - Firestore: 50k reads and 20k writes per day.
  - Functions: 2M invocations per month.
  - Auth (email link, Google), FCM and Hosting: free at this scale.
- Expect **$0–1/month**, mostly small Cloud Build / Artifact Registry charges on function deploys.
- **Resend** free tier: 3,000 emails per month.
- A **$5 budget alert** is set on the project from day one.

## Alternatives Considered

- **Azure Static Web Apps + Functions + Table Storage, verifying Firebase ID tokens** — matches an existing stack. Table Storage batch transactions can cover the waitlist with partition = game, but this option has no realtime roster, still needs FCM for push, and splits the app across two clouds and two consoles.
- **Supabase (Postgres)** — strong relational model and row-level security, but it duplicates Firebase Auth, which was chosen explicitly.
- **Client-side writes guarded only by security rules** — less code, but capacity and waitlist logic in rules is fragile, and it trusts clients with roster integrity, which fails once the app is public.

## Open Items to Confirm

1. The initial list of **areas**.
2. **Format** options: 5v5 only, or also 6v6/7v7/other?
3. Currency: **GBP** assumed.
4. Reminder timing: 24h only, or also ~2h before kick-off?
