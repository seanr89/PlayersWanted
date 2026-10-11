# PlayersWanted
App designed to support local 5 a-side and random football match scheduling and recording

## Development

Specs live in `grill/` (`SPEC.md`, `CONTEXT.md`, `DESIGN.md`).

```
npm install
npm run dev        # Next.js app; try /prototype/teams
npm run typecheck
npm test
```

Built so far: the pure team generator (`src/team-generator`, Seam 1 in the spec). It exposes
`generateTeams(players, rules, options)` (ranked splits with balance and rule violations, plus the
minimal-change fix via `keepCloseTo`) and `scoreSplit` (live Balance meter for a hand-edited split).

The app is Next.js (App Router). `/prototype/teams` is the team-assignment prototype: it runs the real generator on a sample squad with tap-to-swap, a live Balance meter and reshuffle. It is validated by hand, not by tests (the UI is not a test seam in v1).

## Local database (Supabase)

Needs Docker running.

```
npm run db:start    # starts Postgres, auth, REST and realtime without Studio
npm run db:status   # URLs and keys
npm run db:reset    # re-apply migrations and seed
npm run db:stop
```

Copy `.env.example` to `.env.local`. Postgres is on `127.0.0.1:54322`, the API on `127.0.0.1:54321`, and
auth emails land in Mailpit at http://127.0.0.1:54324.

Studio is excluded (`-x studio`) because Docker Desktop on macOS may be denied access to `~/Documents`
when it bind-mounts `supabase/snippets`. To use Studio, allow Docker Desktop access to that folder
(System Settings → Privacy & Security → Files and Folders / Full Disk Access) and run `npx supabase start`.

## Application layer (Seam 2)

`src/app-layer` is the only way the UI changes state or reads Group data. Commands are Postgres functions
(`supabase/migrations`) that check permissions; tables are read-only to signed-in users and row-level security
hides Ratings, pair rules and draft Teams from players, even from direct queries. Team generation runs the pure
generator on the database's playing players.

```
npm run db:start && npm run test:int   # integration tests against local Supabase
npm run test:all                       # unit + integration
```

Built so far: groups and settings, roles (promote/demote Admin, transfer ownership, delete Group), ghost profiles,
Ratings, invite and claim flow, matches (create, edit, cancel), RSVPs with a derived Waitlist and late-dropout flag,
draft and published Teams, pair rules, Guests, the minimal-change fix after a dropout, score-only Results, a player's
own record and the Attendance board.

Removing a Membership, leaving a Group and deleting an account anonymise rather than delete: the member's name,
Rating, position and pair rules go, their upcoming RSVPs and team slots are cleared, and past appearances stay as a
"Former player" so Results and attendance remain correct. Every Group always has an Owner (enforced by a deferred
trigger). Note this is pseudonymisation of past appearances: the placeholder keeps its row id.

Venues are saved per Group (created inline the first time they are typed, with an address, a maps link and a default
cost). A Group can have one weekly Recurring template (weekday, time and time zone, venue, capacity, cost, RSVP lead
time and deadline). A job inside Postgres (`pg_cron`, every 15 minutes) calls `private.run_recurring_templates`: it
makes the next Match from each template and opens RSVPs at the lead time. It is idempotent per occurrence, keeps the
local time across daylight-saving changes, and one template failing does not stop the others. Saving a template makes
next week's Match straight away. Edits to a single Match never change the template, and a template edit only changes
Matches made afterwards (except that an unseen, unmoved next Match is replaced when the night or time changes).

Still to do: the notification interface (at-risk nudge, share messages, push and email).
