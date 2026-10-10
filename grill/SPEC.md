# Bibleague v1: spec

Status: synthesised on 2026-10-09 from `CONTEXT.md` (domain glossary) and `DESIGN.md` (design interview, 2026-10-04). Terms in **bold** are defined in `CONTEXT.md`. "Bibleague" is a working title.

## Problem Statement

I organise a weekly 5-a-side game, and running it happens in a WhatsApp group. Every week I post "who's in?", count replies by hand, chase people who haven't answered, and work out who gets the last spot when too many say yes. Then I pick teams, and someone always says they're unfair. When somebody pulls out on the day, I have to find a replacement and redo the teams while everyone argues in the chat.

None of this is hard, but it's tedious, it's all on me, and it happens every single week. The players don't want a new app with passwords and profiles. They want to say they're in and find out which team they're on.

## Solution

Bibleague is a mobile-first web app (PWA) that gives the organiser one place to run a recurring game, and makes taking part a single tap for players.

The organiser creates a **Group**, adds the regulars by name as **ghost profiles**, and shares one invite link into the existing WhatsApp group. Players open the link, pick their name and tap "I'm in". Each week a **Match** is created automatically from a **Recurring template**. RSVPs open on schedule, **Capacity** and the **Waitlist** are handled automatically, and the organiser is nudged if the Match is **at risk**.

When it's time, the app generates balanced **Teams** from the admin's private **Ratings**, using position tags, **happy in goal** and keep-together/apart pairs. The organiser can swap players with a live **Balance** meter, then publish. If someone drops out after publishing, the app proposes a **minimal-change fix** that an admin confirms with one tap. After the game, the admin records a score-only **Result**, and everyone can see their own record and the **Attendance board**.

Key moments generate a pre-filled WhatsApp message with a link, so the app fits into the group chat instead of replacing it.

## User Stories

### Group setup and roles

1. As an organiser, I want to create a Group with a name (e.g. "Thursday 7pm Powerleague"), so that my recurring game has one home.
2. As an organiser, I want to become the **Owner** of the Group I create, so that nobody else can delete it.
3. As an Owner, I want to promote a Membership to **Admin**, so that someone else can run the game when I'm away.
4. As an Owner, I want to demote an Admin back to a normal Membership, so that I control who has organiser powers.
5. As an Owner, I want to transfer ownership to another Admin, so that the Group survives if I stop organising.
6. As an Owner, I want to be the only one who can delete the Group, so that an Admin can't destroy it by accident.
7. As an Admin, I want to be prevented from removing the Owner, so that the Group's ownership is never lost.
8. As an Admin, I want to sign in with Google, Apple or an email magic link, so that my organiser powers are tied to a real account without a password.
9. As an Admin, I want to edit the Group's name and settings, so that the Group reflects how we actually play.
10. As an Admin, I want to set the Group's minimum-players threshold, so that the at-risk nudge fires at the right in-count.
11. As an Admin, I want to choose whether players can see a team-strength comparison, so that I decide how much rating information leaks.

### Invites, ghost profiles and claims

12. As an Admin, I want to add a player by name in a few seconds, creating a ghost profile, so that the app is useful before anyone else has joined.
13. As an Admin, I want to copy or share the Group's invite link, so that I can post it into our WhatsApp group.
14. As an Admin, I want to regenerate the invite link, so that I can stop a leaked link from working.
15. As a player, I want to open the invite link and see "which one are you?" with the list of unclaimed ghost profiles, so that I can join as myself without typing anything.
16. As a player, I want to create a new Membership with my name if I'm not on the ghost list, so that I can still join.
17. As a player, I want to join without a password or account, so that joining takes seconds.
18. As a player, I want my claim to work instantly, so that I can RSVP straight away.
19. As an Admin, I want to see a one-tap "confirm / not them" prompt for each pending claim, so that I can catch someone claiming the wrong profile.
20. As an Admin, I want to reject a claim and return the ghost profile to the unclaimed list, so that the right person can claim it.
21. As a player with an unconfirmed claim, I want to RSVP but see only my own Team, so that I can take part while the admin checks me.
22. As a player, I want a ghost profile that someone has already claimed to be unavailable, so that nobody else can take my place.
23. As a player, I want to be nudged to create a real account only when I'd benefit (e.g. history across Groups), so that I'm not pushed into sign-up on day one.
24. As a player, I want my one Person to hold Memberships in several Groups, so that I can play in more than one weekly game.

### Squad and memberships

25. As an Admin, I want to see the Squad with every Membership's Rating, position tag, happy-in-goal flag and pairs, so that I can manage the pool in one place.
26. As a player, I want to see the Squad without anyone's Rating, so that I know who's in the Group without seeing judgements of my mates.
27. As an Admin, I want to set a Rating from 1 to 100 using a slider with labelled anchor bands, so that I rate people consistently.
28. As an Admin, I want new Memberships to default to a Rating of 50, so that unrated players don't wreck team balance.
29. As an Admin, I want to set an optional position tag (GK, defender, attacker), so that team generation can spread positions.
30. As an Admin or player, I want to set the happy-in-goal flag, so that team generation can put a willing keeper on each side.
31. As an Admin, I want to set keep-together and keep-apart pairs between two Memberships, so that team generation respects real-world needs (e.g. brothers who share a lift, two players who shouldn't mark each other).
32. As an Admin, I want to remove a pair rule, so that outdated rules stop affecting teams.
33. As a player, I want my Rating to be invisible to me and to other players, so that a number can't sour the friendship group.
34. As a player, I want the Rating in one Group to have no effect on my Membership in another Group, so that each organiser rates their own pool.
35. As an Admin, I want to remove a Membership from the Group, so that the Squad stays current.

### Venues and recurring template

36. As an Admin, I want to create a Venue inline the first time I type it, so that I don't have to set Venues up in advance.
37. As an Admin, I want a Venue to hold a name, an optional address, an optional maps link and a default cost, so that Matches pick up sensible defaults.
38. As a player, I want to tap the Venue's maps link and open my maps app, so that I can find the pitch.
39. As an Admin, I want to edit and reuse saved Venues, so that I'm not re-entering the same pitch every week.
40. As an Admin, I want to define one weekly Recurring template (day, time, Venue, Capacity, cost, RSVP lead time), so that next week's Match creates itself.
41. As an Admin, I want the next Match to be created automatically from the template, so that I never forget to set it up.
42. As an Admin, I want to edit or pause the Recurring template, so that I can handle a change of night or a summer break.

### Matches

43. As an Admin, I want to create a one-off Match manually with date, time, Venue, Capacity and cost per player, so that I can schedule games outside the weekly pattern.
44. As an Admin, I want to edit a single Match without changing the template, so that a one-off change of time doesn't affect future weeks.
45. As an Admin, I want to cancel a Match, so that everyone knows it isn't happening.
46. As a player, I want to see the cost per player for a Match, so that I know what to bring, even though the app doesn't take payment.
47. As a player, I want to see upcoming and past Matches with their Results, so that I can look back at the season.
48. As a player, I want a countdown to the next Match on the Next match tab, so that I know how long is left.

### RSVPs, Capacity and Waitlist

49. As an Admin, I want RSVPs to open automatically a set number of days before the Match, so that I don't have to start the conversation every week.
50. As an Admin, I want to open RSVPs early by hand, so that I can start organising a one-off Match.
51. As a player, I want one huge "I'm in" button, so that responding takes a single tap.
52. As a player, I want to RSVP "out", so that the organiser knows not to wait for me.
53. As a player, I want there to be no "maybe" option, so that everyone gives a clear answer.
54. As a player, I want to change my RSVP, so that I can respond when my plans change.
55. As a player, I want to see who's in and how many spots are left, updating live, so that I know whether the game is on.
56. As a player, I want to be put on the Waitlist when the Match is at Capacity, so that I still have a chance to play.
57. As a player on the Waitlist, I want to see my position, so that I know how likely I am to get a spot.
58. As a waitlisted player, I want to be promoted automatically when someone drops out, so that I don't have to keep checking.
59. As an Admin, I want Capacity to default to 10 and be editable per Match, so that we can play bigger games when more turn up.
60. As an Admin, I want an RSVP deadline per Match, so that the app can tell late dropouts from early ones.
61. As an Admin, I want a dropout after the RSVP deadline to be recorded as a Late dropout flag, so that I can see who pulls out late, without any automatic penalty.
62. As an Admin, I want a "Match at risk" nudge when the in-count falls below the minimum-players threshold, so that I can recruit before it's too late.
63. As an Admin, I want to RSVP on behalf of a Membership, so that I can handle players who reply in WhatsApp instead of the app.

### Guests

64. As a member, I want to add a Guest by name for a single Match, so that I can bring a mate when we're short.
65. As a member, I want my Guest to take a Capacity slot like any other in-RSVP, so that the numbers stay honest.
66. As a member, I want a Guest added at Capacity to join the Waitlist, so that Guests don't jump the queue.
67. As an Admin, I want a Guest's Rating to default to the Group average until I adjust it, so that unknown players don't skew the teams.
68. As an Admin, I want to set a Guest's Rating, so that team generation is accurate when I know the player.
69. As an Admin, I want to promote a Guest to a full Membership, so that a regular +1 can join the Squad.
70. As a member, I want to remove a Guest I added, so that I can fix a mistake or a change of plans.

### Team generation and the team-assignment screen

71. As an Admin, I want to generate Teams for a Match from the in-RSVPs, so that I don't have to pick sides by hand.
72. As an Admin, I want generation to use the playing players only (up to Capacity) and exclude the Waitlist, so that Teams reflect who will actually play.
73. As an Admin, I want generation to minimise the difference in total Rating between the Teams, so that games are close.
74. As an Admin, I want generation to spread position tags and give each Team at least one happy-in-goal player where possible, so that both sides are playable.
75. As an Admin, I want generation to respect keep-together and keep-apart pairs, so that my rules are honoured.
76. As an Admin, I want to see which rules a split breaks, if any, so that I understand any compromise the algorithm made.
77. As an Admin, I want generation to be exact (checking every split) rather than random, so that the result is the best possible and I can explain it.
78. As an Admin, I want generation to work for Capacities other than 10, including odd numbers, so that bigger or uneven games still get balanced Teams.
79. As an Admin, I want to drag or tap to swap players between Teams, so that I can apply knowledge the algorithm doesn't have.
80. As an Admin, I want a live Balance meter that updates as I swap, so that I can see the effect of each change.
81. As an Admin, I want a reshuffle button that shows the next-best split, so that I can see an alternative without starting over.
82. As an Admin, I want Teams to stay a private draft until I publish them, so that I can tweak without players watching.
83. As an Admin, I want publishing to notify everyone, so that players know which Team they're on.
84. As a player, I want to see the published Teams on the Next match tab, so that I know my side on match day.
85. As a player, I want to see a team-strength comparison (e.g. "Team A 412 vs Team B 409") if my Admin has turned it on, so that I can trust the Teams are fair.
86. As a player, I want never to see draft Teams or individual Ratings, so that I'm not exposed to the organiser's private working.

### Dropout after publishing

87. As an Admin, I want the app to propose a minimal-change fix when a player drops out of published Teams, so that I can repair the Teams in one tap.
88. As an Admin, I want the fix to promote the first waitlisted player into the vacated slot when there is a Waitlist, so that the Teams change as little as possible.
89. As an Admin, I want the fix to move the fewest players needed to rebalance when there is no Waitlist, so that the Teams people already know barely change.
90. As an Admin, I want to confirm or dismiss the proposed fix, so that nothing changes without my say.
91. As a player, I want published Teams never to change silently, so that I can trust what I last saw.
92. As a player, I want to be notified when published Teams change after a confirmed fix, so that I know about my new side.

### Results, history and attendance

93. As an Admin, I want to record a Result as one score per Team with one tap each, so that logging the game takes seconds.
94. As an Admin, I want to correct a Result, so that a mistyped score can be fixed.
95. As a player, I want to see my own record (played, won, lost, attendance), so that I can follow how I'm doing.
96. As a player, I want to see the Group's Attendance board, so that I can see who turns up most.
97. As a player, I want no win-based leaderboard, so that results don't start arguments about hidden ratings.

### Notifications and sharing

98. As an Admin, I want a pre-filled WhatsApp message with a link when RSVPs open, so that I can share it into the group chat in one tap.
99. As an Admin, I want a pre-filled WhatsApp message when a Match is at risk, so that I can rally players quickly.
100. As an Admin, I want a pre-filled WhatsApp message when Teams are published, so that everyone sees the Teams in the chat they already use.
101. As a player who has installed the PWA, I want web push notifications for key moments, so that I don't miss them (nice-to-have).
102. As a player without push, I want email as a fallback, so that I still hear about key moments (nice-to-have).

### Navigation and feel

103. As a player, I want the app to open on the Next match tab, so that the thing I need is the first thing I see.
104. As an Admin, I want the Next match tab to show a status panel with who's in, spots left and one clear next action (open RSVPs, nudge, generate, publish), so that I always know what to do next.
105. As any user, I want a bottom tab bar with Next match, Matches, Squad and Group, so that I can reach everything with my thumb.
106. As a player, I want the Group tab to show Group info and my own profile, so that I can manage how I appear.
107. As an Admin, I want the Group tab to hold settings, the invite link, Venues, the Recurring template and Admins, so that all configuration lives in one place.
108. As a player, I want to install the app to my home screen without an app store, so that it feels like an app with no friction.

### Privacy and data lifecycle

109. As a player, I want to leave a Group at any time, so that I'm in control of my data.
110. As a player who leaves, I want my Membership and Rating deleted, so that the organiser's opinion of me doesn't outlive my membership.
111. As a Group, I want a departed player's past match appearances kept in anonymised form, so that Results and attendance stay correct.
112. As a Person, I want to delete my account and have my history anonymised everywhere, so that I can exercise my data rights.
113. As a Person, I want Ratings to be readable only by Admins of the Group they belong to, at the data layer and not just in the UI, so that they can't leak through the API.

## Implementation Decisions

### Platform

- Mobile-first PWA in a TypeScript full-stack web framework (Next.js or SvelteKit; to be picked at the start of the build). No native apps.
- Supabase provides Postgres, auth (Google, Apple, email magic link) and realtime. Realtime powers the live in-count and who's-in list.
- Permissions are enforced in the database with row-level security, as well as in the application layer. Rating visibility, draft Team visibility and unconfirmed-claim visibility must hold even for a direct API call.

### Modules

The build is organised around two deep modules with small interfaces, and a thin UI on top.

**1. Team generator (pure).** Takes the playing players and the rules, and returns a ranked list of splits. It has no I/O and knows nothing about Matches, RSVPs or the database.

- Interface (from the design): `generateTeams(players, rules) -> ranked list of splits with balance and rule violations`.
- A player input carries: Membership identity, Rating, optional position tag, happy-in-goal flag.
- Rules carry: keep-together pairs and keep-apart pairs.
- Each split in the output carries: the two Teams, the Balance (difference in total Rating), and the list of rule violations (broken pairs, a Team with no happy-in-goal player, position imbalance).
- Algorithm: exhaustive search over distinct two-team splits (252 for 10 players), not a heuristic or ML. Score is lexicographic-ish: Rating balance is primary, then soft position spreading and happy-in-goal coverage, then pair rules. The exact weights are tuned during the team-assignment prototype.
- Must handle sizes other than 10, including odd counts (Team sizes differ by one). For large Capacities where exhaustive search becomes expensive, fall back to a bounded search. The threshold is decided during the build.
- "Reshuffle" is the next entry in the ranked list. "Live Balance meter" recomputes Balance and violations for a hand-edited split, so the module also exposes scoring of an arbitrary split.
- The minimal-change fix without a Waitlist reuses this module: candidate splits are ranked by fewest players moved from the published Teams, then by Balance.

**2. Group application layer (server-side commands and queries).** The single entry point for every state change and every read the UI makes. The UI never writes to the database directly. It owns permissions, Match lifecycle and side effects (realtime events, share messages, notifications).

Commands (illustrative, not final names):

- Group: create Group, update settings, promote/demote Admin, transfer ownership, delete Group, regenerate invite link.
- Membership: add ghost profile, claim ghost profile, create Membership on join, confirm claim, reject claim, set Rating, set position tag, set happy-in-goal, add/remove pair rule, remove Membership, leave Group.
- Venue: create (including inline), update.
- Recurring template: create, update, pause; plus a scheduled job that creates the next Match and opens RSVPs at the lead time.
- Match: create, update, cancel, open RSVPs.
- RSVP: set in/out (self or on behalf), add Guest, remove Guest, promote Guest.
- Teams: generate draft, swap players, reshuffle, publish.
- Dropout: propose minimal-change fix, confirm fix, dismiss fix.
- Result: record, correct.
- Person: delete account.

Queries (each shaped per role so admin-only fields never reach players): next-match view (player and admin variants), Match list, Match detail, Squad (with or without Ratings), team-assignment view, own record, Attendance board, pending claims.

### Match lifecycle rules

- Match status moves through: scheduled → RSVPs open → (Teams draft) → Teams published → played (Result recorded); or cancelled from any state before played.
- RSVP is in or out only. Changing in→out after the RSVP deadline sets the Late dropout flag on that RSVP. No penalty.
- In-RSVPs are ordered by response time. The first Capacity of them are playing; the rest form the Waitlist. When a playing in-RSVP goes out, the first waitlisted RSVP is promoted automatically, **unless Teams are published**, in which case promotion happens only through a confirmed minimal-change fix.
- A Guest is a Membership scoped to one Match, linked to the member who added it. It takes a slot (or a Waitlist place) like any in-RSVP. Its Rating defaults to the Group average at generation time until an Admin sets one. Promotion turns it into a normal Membership of the Group.
- "Match at risk" fires when the in-count drops below the Group's minimum-players threshold while RSVPs are open. It notifies Admins once per crossing, not on every change.
- Draft Teams are visible to Admins only. Publishing makes them visible to everyone and emits a notification. A player with an unconfirmed claim sees only their own Team.
- After publishing, any change to Teams (swap, reshuffle, fix) requires an explicit Admin action. Each confirmed change notifies players.

### Schema shape

Entities follow the domain model in `DESIGN.md`:

- **Person**: name, optional account link, optional photo. No rating fields.
- **Membership**: Person (nullable for unclaimed ghosts), Group, display name, role (owner/admin/member), Rating (1–100, default 50), position tag, happy-in-goal, claim state (ghost / claimed-pending / confirmed), Guest marker with its Match and sponsoring Membership.
- **Pair rule**: Group, two Memberships, kind (together/apart).
- **Group**: name, invite token, minimum-players threshold, show-team-strength flag.
- **Venue**: Group, name, optional address, optional maps link, default cost.
- **Recurring template**: Group (at most one), day, time, Venue, Capacity, cost, RSVP lead time, paused flag.
- **Match**: Group, Venue, date/time, Capacity (default 10), cost per player, RSVP deadline, status.
- **RSVP**: Match, Membership, response (in/out), responded-at (for ordering), Late dropout flag.
- **Teams**: Match, state (draft/published), the two sides as Membership lists.
- **Result**: Match, score per side.
- Past appearances (Team membership and RSVP history) survive Membership deletion in anonymised form, so the history references must tolerate a removed Membership.

### Sharing and notifications

- WhatsApp sharing is a pre-filled message plus deep link, opened via the platform share sheet or a WhatsApp URL. No WhatsApp API integration.
- Share messages exist for: RSVPs open, Match at risk, Teams published.
- Web push (installed PWA only) and email fallback are nice-to-have and sit behind the same notification interface in the application layer, so they can be added without touching callers.

### UI

- Bottom tab bar: Next match (default), Matches, Squad, Group. Per-role content as in the `DESIGN.md` screens table.
- Visual feel: casual with a sporty edge. Bold condensed type, one pitch-green accent, a huge "I'm in" button.
- The team-assignment screen (swap interaction plus live Balance meter) is the highest-risk UI and is prototyped first with a throwaway team generator, before the rest is built.

### Defaults to confirm during the build

RSVP lead time, minimum-players threshold (around 8), RSVP deadline, Rating anchor band wording, and the Balance meter's scale.

## Testing Decisions

### What a good test looks like

- Tests exercise external behaviour through a module's public interface: given these inputs or commands, this is what callers can observe. They do not assert on internal helpers, intermediate data structures, SQL, or which function called which.
- Tests read as domain scenarios in the `CONTEXT.md` vocabulary ("an 11th in-RSVP goes on the Waitlist", "a dropout after publishing proposes promoting the first waitlisted player").
- Tests should survive a refactor of the module's internals unchanged.

### Seams

There are exactly two test seams.

**Seam 1: the team generator.** Pure unit tests against `generateTeams` and split scoring. No database, no UI. Covers:

- Balance is optimal for known inputs (compare against a brute-force oracle on small cases).
- Each Team gets a happy-in-goal player when one exists for each side.
- Keep-together and keep-apart pairs are honoured when possible, and reported as violations when they can't be.
- Ranked order is stable and deterministic, so reshuffle is predictable.
- Odd and non-10 sizes produce valid splits.
- Edge cases: all equal Ratings, one very strong player, contradictory pair rules, fewer players than a full game.
- Property-style checks are a good fit here (e.g. every player appears exactly once across the two Teams).

**Seam 2: the Group application layer.** Integration tests that call commands and queries against a real local Supabase Postgres, with row-level security on. No UI and no mocked database. Covers:

- Match lifecycle: RSVPs open, Capacity, Waitlist ordering and automatic promotion, Late dropout flagging, at-risk nudges firing once per crossing.
- Guests: slot usage, default Rating, promotion.
- Ghost profiles and claims: instant claim, pending visibility, confirm/reject, no double claim.
- Roles: Owner-only actions, Admin vs member permissions, ownership transfer.
- Teams: draft privacy, publish visibility, no silent change after publishing, minimal-change fix with and without a Waitlist.
- Privacy: players can never read Ratings or draft Teams, including by querying tables directly as a player; leaving a Group deletes the Membership and anonymises history without breaking Results or the Attendance board; account deletion anonymises everywhere.
- Results, own record and the Attendance board.

Side effects (realtime events, share messages, notifications) are observed at this seam through the notification interface, by asserting on what was emitted rather than on how.

The UI is not a test seam in v1. It is kept thin enough that the two seams above cover the behaviour. The team-assignment prototype is validated by hand.

### Prior art

None: the codebase is greenfield. The first tests written at each seam set the pattern for the rest.

## Out of Scope

- Payments of any kind. Cost per player is displayed only.
- Venue or pitch booking, and maps APIs (only a maps link).
- Leagues, tables and win-based leaderboards.
- Elo-style rating suggestions and head-to-head calibration.
- Peer rating and self rating.
- Variety penalty for repeating recent Teams.
- Scorer tracking, man of the match, or any Result detail beyond the score per side.
- Penalties for Late dropouts.
- "Maybe" RSVPs.
- Native iOS and Android apps.
- SMS notifications and WhatsApp API integration.
- Final product name and branding.

## Further Notes

- The main growth loop is the invite link shared into an existing WhatsApp group. Joining must never require a password.
- Push notifications on iOS only work for PWAs installed to the home screen, which is why WhatsApp sharing is primary and push is layered on top.
- Groups and stored Results are deliberately the foundation for later features: leagues, Elo suggestions and variety penalties can be added without remodelling.
- The app stores opinions about real people, so it is treated as GDPR-relevant from the start. Admin-only Rating visibility is both a product decision and a data-minimisation measure.
- Recommended build order: prototype the team-assignment screen with a throwaway generator, then build the team generator properly behind Seam 1, then the application layer behind Seam 2, then the UI.
