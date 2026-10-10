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

The app is Next.js (App Router), mobile-first. It talks to Supabase from the browser with the signed-in user's token only
(no service key), through the application layer, so row-level security and the permission-checked commands apply.

- Players open an invite link (`/join/<token>`), pick their name or add themselves, and are in. They sign in anonymously
  behind the scenes: no password. Organisers sign in with an emailed link at `/start`, then name the game.
- A Group opens on **Next match**: one huge "I'm in" button, who's in and the waitlist, published Teams, and for organisers
  a strip with the single next step (open RSVPs, nudge, make teams, publish, review a dropout, record the score).
  The other tabs are **Matches** (list, results, new match), **Squad** (members, confirm or reject claims, add a player)
  and **Group** (invite link, your profile, leave).
- `/matches/<id>` is the link used in notifications; it forwards to the right Group.

Copy `.env.example` to `.env.local` (the Supabase and app URL values are enough for the UI). Sign-in links only work for
addresses on the allow-list in `supabase/config.toml` (`site_url`, `additional_redirect_urls`); add your production
address there. `/prototype/teams` is the earlier throwaway team-assignment screen on sample data; the real one is still to
build.

The UI is not a test seam in this project (see the spec), so it is checked by hand. `node e2e/smoke.mjs` drives the real flow
in headless Chromium at phone size (organiser signs in with a real emailed link, makes a Group and a match, opens RSVPs; a
player joins from the invite link and taps "I'm in") and saves screenshots to `e2e/shots/`. It needs the local stack, the dev
server on :3000, and `npx playwright install chromium` once.

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

Notifications (`src/app-layer/notifications.ts`): commands write events to an outbox table in the same transaction as
the change (RSVPs opened, Match at risk, Teams published, Teams changed after a fix, Match cancelled). "At risk" fires
once per genuine drop below the Group's minimum-players threshold (after it was reached) and goes to Admins only;
changing the minimum starts that bookkeeping afresh. A delivery worker calls `dispatchNotifications(serviceClient,
channels)`: it claims pending events (service role only, checked inside the function as well as by grants; at most once
each, so a crash mid-batch can lose events) and hands every channel a `Notification` with its recipients. Notification
bodies never list the Teams or any Rating. Web push and email are meant to be channels implementing `NotificationChannel`;
none is built yet, so nothing is sent until one is registered. `getShareMessage` gives an Admin a prefilled WhatsApp message
and `wa.me` link for RSVPs open, at risk and Teams published (no WhatsApp API); names are flattened to plain text so a
member cannot forge lines or links in it. Times use the recurring template's time zone, else the Group's (`timeZone`).
Set `NEXT_PUBLIC_APP_URL` in production: links refuse to fall back to localhost there.
Functions that only the service role may call must be re-restricted after any migration that re-runs the blanket
`grant execute ... to authenticated`; a test guards this.

### Delivering notifications

`POST /api/notifications/dispatch` (`src/delivery`, a Next.js route) delivers whatever is pending. A scheduler that can
send a POST (a GitHub Action, `cron-job.org`, or `pg_cron` + `pg_net`; not Vercel Cron, which sends GET) should call it
every minute or so with `Authorization: Bearer $CRON_SECRET`. It answers 200 when everything was delivered and 502 if
any delivery failed, so the scheduler can alert. Each run stops claiming new events after about 45 seconds. It fails closed: with no `CRON_SECRET` it answers 503, and it also refuses to run
unless the service credentials and a delivery channel are configured (it would otherwise claim events and lose them). It
answers with counts only; details go to the server log. Set the variables in `.env.example` (server-side only).

The only channel so far is email over SMTP (`SMTP_URL`, `EMAIL_FROM`). Each recipient gets their own email with nobody
else's name or address in it, no Teams and no Ratings. Addresses come from the account and only **confirmed** ones are
used, so players who joined anonymously (no email) are not reached; only people who signed in with a confirmed email
address are. Local Supabase has email confirmation off (`enable_confirmations = false` in `supabase/config.toml`);
keep it **on** for a hosted project, or anyone could register someone else's address. A remote SMTP server must use TLS
(`smtp://` is upgraded with STARTTLS and refused without it; `smtps://` is implicit TLS). A member toggling their RSVP
can trigger at most one "Match at risk" email to Admins per match every ten minutes. Locally, mail goes to Mailpit
(`http://127.0.0.1:54324`). There is no unsubscribe or per-person preference yet.

Still to do: web push, email opt-out, retry for failed deliveries.

## Before going to production

The local setup is deliberately loose so it is easy to work with. Change these for a hosted project:

- **Anonymous sign-ins** let players join without an account, so keep them on, but `supabase/config.toml` sets very high rate
  limits for local testing (`anonymous_users`, `sign_in_sign_ups`). Lower them (roughly 10 to 30 per hour per IP) and turn on
  CAPTCHA. Starting a Group already needs a real (non-anonymous) account: the database rule `require_account_to_create_group`
  in `app_settings` is on by default; the integration tests switch it off while they run and back on afterwards.
- **Email:** turn email confirmation **on** (`enable_confirmations`), use a real SMTP provider (the default allows only a couple
  of emails an hour), and set `SMTP_URL` / `EMAIL_FROM` for the delivery worker.
- **Sign-in links** only go to allow-listed addresses. Add your production address to Redirect URLs (hosted dashboard:
  Authentication, URL Configuration; locally: `additional_redirect_urls`) and set the Site URL.
- **App address:** set `NEXT_PUBLIC_APP_URL` so shared links point at the real site.
- **Delivery worker:** set `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` (server-side only) and schedule a POST to
  `/api/notifications/dispatch`.
- **Security headers:** `next.config.ts` sets basic headers (no referrer, no framing). A strict script policy
  (Content-Security-Policy with nonces) is still to do.
- Players who joined anonymously can lose their identity if they clear their browser; the Group tab offers "Keep your place"
  (adds an email to the same player).
