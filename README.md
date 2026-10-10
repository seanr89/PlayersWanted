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
