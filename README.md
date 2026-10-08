# PlayersWanted

App designed to support local 5-a-side and random football match scheduling and recording.

A mobile-first PWA on Firebase: post a game, share the link, and let the roster and waitlist fill themselves.

## Documentation

- Specs: [v1 design](docs/superpowers/specs/2026-09-27-players-wanted-v1-design.md), [match management](docs/superpowers/specs/2026-09-27-players-wanted-match-management-design.md)
- Plans: [roadmap and task list](docs/superpowers/plans/2026-09-28-players-wanted-roadmap.md) → [M1 core](docs/superpowers/plans/2026-09-28-m1-core.md), [M2 players](docs/superpowers/plans/2026-09-28-m2-players.md), [M3 teams](docs/superpowers/plans/2026-09-28-m3-teams.md), [M4 results](docs/superpowers/plans/2026-09-28-m4-results.md)
- [Deployment runbook](docs/deployment.md) · [Manual release checklist](docs/manual-test-checklist.md)

## Layout

| Folder | What |
|---|---|
| `shared/` | Pure TypeScript domain rules (roster, validation, formatting) used by web and functions |
| `functions/` | Cloud Functions: every game/roster write, notifications, reminders |
| `web/` | React + Vite PWA |
| `rules-tests/` | Firestore security-rules tests |
| `scripts/` | Seed and admin scripts |

## Local development

Needs Node 22 and Java 11+ (for the Firestore emulator).

```bash
npm install
npm run build -w functions          # or: npm run build:watch -w functions
npx firebase emulators:start --project demo-playerswanted
npm run seed                         # in a second terminal
npm run dev                          # http://127.0.0.1:5173
```

Emails and push messages are not sent locally; they appear in the `devOutbox` collection in the Emulator UI (http://127.0.0.1:4000).

## Tests

```bash
npm test                 # unit tests (shared, functions, web)
npm run test:emulators   # integration + security-rules tests against the emulators
npm run lint && npm run typecheck
```
