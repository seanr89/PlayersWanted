# PlayersWanted
App designed to support local 5 a-side and random football match scheduling and recording

## Development

Specs live in `grill/` (`SPEC.md`, `CONTEXT.md`, `DESIGN.md`).

```
npm install
npm run typecheck
npm test
```

Built so far: the pure team generator (`src/team-generator`, Seam 1 in the spec). It exposes
`generateTeams(players, rules, options)` (ranked splits with balance and rule violations, plus the
minimal-change fix via `keepCloseTo`) and `scoreSplit` (live Balance meter for a hand-edited split).
