# Bibleague: design and concepts

Status: agreed through a design interview on 2026-10-04. "Bibleague" is a working title. Terms are defined in `CONTEXT.md`.

## 1. Problem and product

Organising a weekly 5-a-side game currently happens in WhatsApp: someone asks who's in, chases dropouts, argues about teams, and asks again when somebody pulls out. Bibleague replaces that chaos with one place to run the game.

**Core user:** the organiser, who feels the pain and will bring everyone else along. Players are lightweight. They join through a link, tap "I'm in", and see their team.

**Unit:** a recurring **Group** (e.g. "Thursday 7pm Powerleague") with a standing pool of players and a series of matches. There are no leagues or tables in v1, though groups and stored results make a league a later layer.

**Feel:** casual with a sporty edge. It should feel like a mates' group chat, not a sports analytics platform. Bold condensed type, one pitch-green accent, and a huge tappable "I'm in" button.

## 2. Platform and stack

- Mobile-first PWA, with no app-store friction. The main growth loop is sharing an invite link into a WhatsApp group.
- TypeScript full-stack web app (Next.js or SvelteKit) on Supabase: Postgres, auth and realtime for live RSVP updates.
- Team generation is a small pure function (members and rules in, two teams out), tested independently of the UI.

## 3. Domain model

```
Person 1───* Membership *───1 Group
                  │              │
                  │              ├──* Venue
                  │              ├──0..1 RecurringTemplate
                  │              └──* Match
                  │                     ├──* RSVP ──1 Membership
                  │                     ├──1 Venue
                  │                     ├──0..1 Teams (draft | published)
                  │                     └──0..1 Result
                  └── rating, position tag, happy-in-goal, keep-together/apart pairs
```

Key rules:

- **Person** is global: name, optional account, optional photo. It holds no ratings.
- **Membership** is per group. It holds the rating (1–100), optional position tag, "happy in goal" flag, and keep-together/apart pairs. Each admin rates their own pool, and one Person can be in many Groups.
- **Ghost profiles:** an admin adds a player by name in seconds, so the app works before anyone else installs it. The player can claim it later through the invite link.
- **Guests:** a member adds a "+1" by name. It takes a capacity slot, is unrated (defaulting to the group average) and can be promoted by an admin.
- **Roles:** Owner and Admin. The Owner created the group and can transfer ownership. Admins can do everything except delete the group or remove the Owner.

## 4. Ratings

- Organiser-assigned integer, 1–100. A bare 1–100 is hard to apply consistently, so the UI is a slider with labelled anchor bands (e.g. 1–20 "just turns up" up to 80+ "ex-semi-pro"). New players default to 50.
- **Admin-only visibility.** A fine-grained number can sour a friendship group. Players see teams and, if the admin turns it on, a team-strength comparison (e.g. "Team A 412 vs Team B 409").
- Peer or self-rating is out. Peer rating is a social minefield, and self-rating is inflated.
- Later: head-to-head calibration flow, and Elo-style suggestions from stored results.

## 5. Match lifecycle

1. **Created** manually, or auto-created from a weekly recurring template (day, time, venue, capacity, cost, RSVP lead time).
2. **RSVPs open** a set number of days ahead. Responses are in or out only, because "maybe" means "no" in practice.
3. **Capacity** is fixed per match (default 10). Overflow goes to an automatic **waitlist** that promotes in order.
4. **Match at risk** nudge goes to admins when the in-count falls below the minimum-players threshold.
5. **Late dropouts** are recorded as a flag after the RSVP deadline, with no penalty in v1.
6. **Teams** are generated, tweaked and published (section 6).
7. **Played**, then an admin records a score-only **Result**.

Booking is scheduling only. Cost per player is displayed but not processed. There is no pitch reservation and no payments. Venue booking APIs mostly don't exist, and payments add regulation and complexity.

**Venues** are saved per group, created inline the first time they're typed (name, optional address and maps link, default cost). There is no maps API in v1, just a link that opens the maps app.

## 6. Team assignment

### Algorithm

With 10 players there are only 252 distinct splits into two teams of five, so the algorithm checks all of them and picks the best. It is exact and explainable, with no ML.

Score each candidate split by:

1. **Rating balance** (primary): minimise the difference in total rating.
2. **Soft position balancing:** spread the position tags, and give each team at least one "happy in goal" player if possible.
3. **Pair rules:** keep-together and keep-apart pairs set by the admin.

Not in v1: a variety penalty for repeating recent teams. It is cheap to add later by penalising recent pairings. Capacity can exceed 10, so the function must handle other sizes. Generation chooses the playing 10 first (or the capacity), and the waitlist is excluded.

Interface: `generateTeams(players, rules) -> ranked list of splits with balance and rule violations`.

### Organiser control

- **Generate**, then drag or tap to swap players, with a **live balance meter**.
- A **reshuffle** button returns the next-best split.
- Teams are a **draft** and private to admins until explicitly **published**. Publishing notifies everyone, and on match day it's what players open the app for.

### Dropout after publish

The most common real-world failure. The app proposes a **minimal-change fix** and an admin confirms it with one tap:

- With a waitlist: promote the first waitlisted player into the vacated slot.
- Without one: the least disruptive rebalance for the remaining players.

Nothing changes silently after publish.

## 7. Identity and access

- **Admins** sign in with Google or Apple, or an email magic link.
- **Players** join through the group invite link. No password. They pick their name from the ghost list ("which one are you?") or create one. Real accounts are optional and nudged later, only when a player wants history across groups.
- **Claims** are instant but flagged. The admin sees a one-tap "confirm / not them" prompt. Until confirmed, the player can RSVP but sees only their own team. A claimed profile can't be claimed twice. The stakes are low because ratings are hidden.

## 8. Notifications

The organiser-driven **WhatsApp share** is the primary channel. Every key moment (RSVP open, match at risk, teams published) generates a pre-filled message with a link. Web push is layered on for people who have installed the PWA, because iOS only supports it from the home screen. Email is a fallback. No SMS.

## 9. Results and history

- **Results:** score-only entry (Team A 6–4 Team B, one tap each). No scorers and no man of the match.
- **Players see** their own record (played, won, lost, attendance) and a group **attendance board**.
- There is no win-based leaderboard in v1. It invites arguments that interact badly with hidden, organiser-set ratings.
- Stored results are what later unlock Elo-style rating suggestions.

## 10. Screens and navigation

Bottom tab bar on mobile:

| Tab | Players see | Admins see |
| --- | --- | --- |
| **Next match** (default) | One huge "I'm in" button, countdown, who's in, published teams | Status panel: who's in, spots left, one clear next action (open RSVPs, nudge, generate, publish) |
| **Matches** | Upcoming and past list, with results | Same, plus create and edit |
| **Squad** | Member list, no ratings | Member list with ratings, position tags and pairs, with editing |
| **Group** | Group info, own profile | Settings, invite link, venues, recurring template, admins |

Match detail opens from Next match and Matches. For admins, the **team-assignment screen** opens from match detail. That screen is the highest-risk UI (swap interaction plus live balance meter), so it is the first one to prototype.

## 11. Privacy and data lifecycle

The app stores opinions about real people, so it is treated as GDPR-relevant from the start.

- A person can leave a group at any time. Their Membership is deleted along with their rating, and their past match appearances stay in anonymised form so results and attendance aren't corrupted.
- Deleting an account removes the Person and anonymises their history everywhere.
- Ratings are visible only to admins, which limits the exposure.

## 12. Scope

**In v1:** group creation, invite link and ghost claiming; memberships with rating, position and happy-in-goal; matches with weekly recurring templates; RSVP, capacity, waitlist and guests; team generation with swap, balance meter and draft/publish; minimal-change dropout fix; score-only results; WhatsApp share messages; saved venues; attendance board.

**Nice-to-have in v1:** web push and email notifications.

**Out of v1:** payments, venue booking, leagues and tables, Elo suggestions, peer ratings, variety penalties, scorer tracking, native apps.

## 13. Open items

- **Name and branding:** "bibleague" is a placeholder. It affects nothing in the model.
- **Defaults to confirm during build:** RSVP lead time, minimum-players threshold (e.g. 8), RSVP deadline, anchor band wording and the exact balance-meter scale.
- **Next step:** prototype the team-assignment screen with a throwaway version of `generateTeams` before building the rest.
