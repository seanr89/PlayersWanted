# Bibleague: where the build is

Written when the team-assignment screen was finished, so work can pick up from here. The product spec is
`grill/SPEC.md` (with `CONTEXT.md` for the vocabulary and `DESIGN.md` for the design interview). "Bibleague" is a working title.

## How it is built

- **Seam 1, the team generator** (`src/team-generator`): pure TypeScript, exhaustive search up to 20 players and a bounded
  search above. `generateTeams`, `scoreSplit`, and `keepCloseTo` for the minimal-change fix.
- **Seam 2, the application layer** (`src/app-layer` and `supabase/migrations`): every state change is a Postgres function that
  checks permissions; tables are read-only to signed-in users; row-level security hides Ratings, pair rules and draft Teams from
  players. TypeScript wrappers (`index.ts`), per-role read models (`views.ts`) and notifications (`notifications.ts`).
  Integration tests (`*.int.test.ts`) run against a real local Supabase.
- **Delivery worker** (`src/delivery`, `src/app/api/notifications/dispatch`): claims outbox events (service role only) and sends
  them through channels. One channel exists: email over SMTP.
- **UI** (`src/app`, `src/ui`): Next.js App Router, mobile-first, client-rendered. Not a test seam (per the spec), so it is
  checked by hand with `node e2e/smoke.mjs` and `node e2e/teams.mjs` (headless Chromium, real emailed sign-in link).

How each slice was done: tests first at the seam, build, then two independent reviews (standards plus accessibility, and spec plus
security, each by a separate agent), fix the findings, replay all migrations on an empty database and run everything, then a
stacked PR. Keep doing it that way.

## Status

Test counts at this point: 67 unit, 250 integration, 23 migrations. `npm run test:all`, `npm run typecheck` and `npx next build`
all pass.

### Pull requests (a stack: each is based on the one before it)

| PR | Branch | Contents | State |
| --- | --- | --- | --- |
| #3 to #9 | `feat/team-generator` to `feat/privacy-removal` | generator, Next.js app, local Supabase, application layer, guests and the fix, roles/match edit/results, removal and anonymisation | merged into `main` |
| #11 | `feat/venues-recurring` | venues and the weekly recurring template (migrations 015 to 017) | open, based on `main` |
| #12 | `feat/notifications` | outbox events, at-risk nudge, dispatcher, WhatsApp share messages (018 to 020) | open, based on #11 |
| #13 | `feat/delivery-worker` | the dispatch route and the email channel | open, based on #12 |
| #14 | `feat/ui-shell` | the UI: join, start a group, Next match, Matches, Squad, Group (021 to 023) | open, based on #13 |
| PR_NUMBER | `feat/team-assignment` | the team-assignment screen | open, based on #14 |

Merge in that order. `#2` (`m1-core`) is an older, unrelated PR.

### Migrations

001 groups and memberships, 002 invites and claims, 003 matches and RSVPs, 004 pair rules and Teams, 005 hardening, 006 guests,
007 minimal-change fix, 008 guest and fix hardening, 009 roles and settings, 010 match edit and cancel, 011 results and
attendance, 012 review fixes, 013 removal and anonymisation, 014 privacy fixes, 015 venues, 016 recurring template, 017 venue and
template fixes, 018 notifications, 019 notification fixes, 020 at-risk cooldown, 021 `my_membership`, 022 group id on invites,
023 require a real account to start a group.

### Spec coverage

Built and tested in the application layer: groups, settings, roles, ownership, ghost profiles and claims, Ratings (admin-only),
squad, venues, recurring template and its scheduled job, matches (create, edit, cancel), RSVPs, Capacity, derived Waitlist, late
dropouts, Guests, team generation, draft and published Teams, minimal-change fix, results, own record, Attendance board, leaving a
Group, removing a Membership, deleting an account, notifications, WhatsApp share messages.

Built in the UI: invite and claim flow, starting a group (emailed link), Next match (player and organiser), Matches (list, results,
new match, cancel), Squad (members, claims, add a player), Group (invite link, profile, "keep your place", leave), the
team-assignment screen.

## Not built yet (a good order to do it in)

1. **Rating sliders and position/keeper editing** in the UI. Today Ratings can only be set through the application layer, so
   a real group cannot set them from the app. This is the next blocker for real use.
2. **Swapping players after Teams are published** (spec: "any change to Teams ... requires an explicit Admin action", each change
   notifying players). Needs its own command, a revision bump and a `teams_changed` event. Today only the dropout fix changes
   published Teams.
3. **Story 85**: players seeing a team-strength comparison when the organiser turns it on (totals only, never Ratings; needs its own
   server-side check).
4. **UI for what exists in the application layer**: venue and recurring-template forms, group settings, promote/demote Admin and
   transfer ownership, add a Guest, removing a member, a player's own record and the Attendance board.
5. **PWA install** (manifest, icons, service worker), **web push** (which forces the "email only as a fallback" change: a channel
   must report who it reached), **realtime live in-count** (RSVPs are admin-only under row-level security, so it needs a design;
   the screen polls every 20 to 30 seconds for now).
6. **Google and Apple sign-in** (organisers use an emailed link only), **a strict script CSP** (basic security headers are set),
   **recovery for a player who lost an anonymous identity**, email opt-out, retry and persistence for failed deliveries.

## Decisions that differ from, or go beyond, the spec

- Team ranking is a weighted cost in Rating points (broken pair 100, no keeper 30, position imbalance 5 per unit), not strictly
  "balance first". There are 126 distinct splits of 10 players (the spec says 252, counting A and B as different). A `GK` tag counts as
  willing to play in goal. The minimal-change fix only prefers fewer moves within a tolerance of 10 cost points.
- A member can bring at most 3 Guests per match. "Match at risk" nudges Admins at most once per match every 10 minutes. The RSVP
  deadline defaults to 24 hours before kick-off and RSVPs open 3 days ahead.
- Removing a Membership or deleting an account anonymises ("Former player") rather than deleting, so Results and attendance stay
  correct. This is pseudonymisation: the placeholder keeps its row id. Needs a decision against the GDPR stance.
- Starting a group needs a real (non-anonymous) account; the database setting `require_account_to_create_group` is on by default and
  the integration tests switch it off while they run (vitest global setup) and back on afterwards.
- A match nobody has recorded drops out of a player's "next match" 12 hours after kick-off, but stays in front of an Admin
  until it is resolved.

## Running it

Needs Docker running and Node. One-off: `npm install`, `npx playwright install chromium`.

```
npm run db:start          # local Supabase (without Studio, see below)
cp .env.example .env.local   # the Supabase and app URL lines are enough for the UI
npm run dev               # http://localhost:3000
npm run test:all          # unit + integration (needs the database running)
node e2e/smoke.mjs        # browser check; also e2e/teams.mjs (needs the dev server and Mailpit's SMTP port)
```

Things that will trip you up:

- Docker Desktop on macOS may be refused access to `~/Documents`, which stops Supabase Studio from starting, so the stack runs with
  `-x studio`.
- Changing `supabase/config.toml` needs `npx supabase stop && npx supabase start -x studio`. `supabase db reset` can take several
  minutes because it waits for containers to become healthy; `npx supabase migration up` applies new migrations to a running database.
- Sign-in links only go to allow-listed addresses (`site_url`, `additional_redirect_urls`), and local email goes to Mailpit
  (`http://127.0.0.1:54324`).
- `next dev` writes an `AGENTS.md` into the repo. It is generated, not ours, and deliberately uncommitted.
- Any migration that re-runs the blanket `grant execute ... to authenticated` must re-revoke `claim_pending_notifications` (it also
  checks the caller's role itself, and a test guards it). New SECURITY DEFINER functions must pin `search_path = public, pg_temp`.
- The README ends with a "Before going to production" checklist (rate limits, CAPTCHA, email confirmation, redirect URLs, SMTP,
  worker secrets).
