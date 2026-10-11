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
  checked by hand with `node e2e/smoke.mjs`, `node e2e/teams.mjs` and `node e2e/ratings.mjs` (headless Chromium, real emailed sign-in link).

How each slice was done: tests first at the seam, build, then two independent reviews (standards plus accessibility, and spec plus
security, each by a separate agent), fix the findings, replay all migrations on an empty database and run everything, then a
stacked PR. Keep doing it that way.

## Status

Test counts at this point: 71 unit, 263 integration, 25 migrations. `npm run test:all`, `npm run typecheck` and `npx next build`
all pass.

### Pull requests

#3 to #9, #11 to #15 and #17 (generator through Squad editing) are all merged into `main`. `#2` (`m1-core`) is an older,
unrelated PR. Current work: `feat/swap-after-publish` (changing published Teams, below), branched from `main`.

### Migrations

001 groups and memberships, 002 invites and claims, 003 matches and RSVPs, 004 pair rules and Teams, 005 hardening, 006 guests,
007 minimal-change fix, 008 guest and fix hardening, 009 roles and settings, 010 match edit and cancel, 011 results and
attendance, 012 review fixes, 013 removal and anonymisation, 014 privacy fixes, 015 venues, 016 recurring template, 017 venue and
template fixes, 018 notifications, 019 notification fixes, 020 at-risk cooldown, 021 `my_membership`, 022 group id on invites,
023 require a real account to start a group, 024 change published Teams, 025 `confirm_fix` locks the match.

### Spec coverage

Built and tested in the application layer: groups, settings, roles, ownership, ghost profiles and claims, Ratings (admin-only),
squad, venues, recurring template and its scheduled job, matches (create, edit, cancel), RSVPs, Capacity, derived Waitlist, late
dropouts, Guests, team generation, draft and published Teams, minimal-change fix, results, own record, Attendance board, leaving a
Group, removing a Membership, deleting an account, notifications, WhatsApp share messages.

Built in the UI: invite and claim flow, starting a group (emailed link), Next match (player and organiser), Matches (list, results,
new match, cancel), Squad (members, claims, add a player), Group (invite link, profile, "keep your place", leave), the
team-assignment screen, and editing a player's Rating (slider with labelled bands), position tag and happy-in-goal from Squad
(admins edit anyone; a player ticks their own happy-in-goal), and changing published Teams ("Change teams" on the team screen: swaps stay on the device until the admin saves and confirms, then players are told once). Check them with `node e2e/ratings.mjs` and `node e2e/teams.mjs`.

## Not built yet (a good order to do it in)

1. **Story 85**: players seeing a team-strength comparison when the organiser turns it on (totals only, never Ratings; needs its own
   server-side check).
2. **UI for what exists in the application layer**: venue and recurring-template forms, group settings, promote/demote Admin and
   transfer ownership, add a Guest, removing a member, a player's own record and the Attendance board.
3. **PWA install** (manifest, icons, service worker), **web push** (which forces the "email only as a fallback" change: a channel
   must report who it reached), **realtime live in-count** (RSVPs are admin-only under row-level security, so it needs a design;
   the screen polls every 20 to 30 seconds for now).
4. **Google and Apple sign-in** (organisers use an emailed link only), **a strict script CSP** (basic security headers are set),
   **recovery for a player who lost an anonymous identity**, email opt-out, retry and persistence for failed deliveries.

## Decisions that differ from, or go beyond, the spec

- Changing published Teams is a manual rearrangement of the same players (`change_published_teams`). The spec's "(swap, reshuffle,
  fix)" is covered by it for swaps and by `confirm_fix` for dropouts; a generator-driven "next suggestion" after publishing does
  not exist (any split can still be reached by hand). The command takes the revision the Admin was looking at and refuses with
  "the teams have changed since you opened them" if it moved, locks the match row (as `confirm_fix` now does), and refuses while
  someone on the Teams has dropped out (confirm the fix first). It does not balance-check or limit team sizes: any split of the
  same players is accepted, and swapping the two whole sides counts as a change.

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
node e2e/smoke.mjs        # browser check; also e2e/teams.mjs and e2e/ratings.mjs (needs the dev server and Mailpit's SMTP port)
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
