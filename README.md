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

Built so far: groups, ghost profiles, Ratings, invite and claim flow, matches, RSVPs with derived Waitlist and
late-dropout flag, draft and published Teams, pair rules. Still to do: group settings and role management (promote/demote, transfer, delete), match edit/cancel, guests, the minimal-change fix, results and
the attendance board, venues and the recurring template, leaving a Group and account deletion, and the
notification interface (at-risk nudge, share messages).
