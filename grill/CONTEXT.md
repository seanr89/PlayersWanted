# Bibleague

A mobile-first web app that lets the organiser of a recurring 5-a-side game manage their player pool, run weekly matches with RSVPs, and generate balanced teams. "Bibleague" is a working title only.

## Language

**Group**:
A recurring game with a standing pool of players and a series of matches (e.g. "Thursday 7pm"). The top-level unit of the product.
_Avoid_: League, team, club

**Person**:
A real individual, global across the app. Has a name, an optional account and an optional photo. Holds no rating.
_Avoid_: User, player (when you mean the global identity)

**Membership**:
A Person's place in one Group. Holds the rating, position tag, "happy in goal" flag and keep-together/apart pairs. One Person can have many Memberships.
_Avoid_: Player (ambiguous), profile

**Player**:
Informal term for a Membership taking part in a Match. Prefer Membership when discussing data and Person when discussing identity.

**Ghost profile**:
A Membership created by an admin by name, before the real person has joined. Becomes a normal Membership when claimed.
_Avoid_: Placeholder, dummy, stub

**Claim**:
A joiner choosing a ghost profile as themselves via the invite link. Instant, but pending until an admin confirms it.

**Guest**:
A one-off Membership added by a member for a single Match ("+1"). Takes a capacity slot, is unrated until an admin adjusts it, and can be promoted to a full Membership.
_Avoid_: Plus-one, sub, ringer

**Owner**:
The Person who created the Group. Can transfer ownership. The only role that can delete the Group or remove the Owner.

**Admin**:
A Membership with organiser powers: rate players, run matches, generate and publish teams, confirm claims. Cannot delete the Group.
_Avoid_: Organiser (use only informally, as the user persona)

**Rating**:
An admin-assigned integer from 1 to 100 describing a Membership's ability. Visible to admins only.
_Avoid_: Skill, score, level, Elo

**Position tag**:
An optional label (GK, defender, attacker) on a Membership. A soft input to team generation.

**Happy in goal**:
A flag on a Membership meaning the player is willing to play goalkeeper. The algorithm tries to give each team at least one.

**Keep-together / keep-apart pair**:
An admin-set rule between two Memberships about whether team generation should put them on the same side or on opposite sides.

**Match**:
A single scheduled game in a Group, with date, time, Venue, capacity, cost per player and a status.
_Avoid_: Fixture, game, session

**Recurring template**:
A weekly definition (day, time, Venue, capacity, cost, RSVP lead time) that auto-creates the next Match.

**Venue**:
A saved place for a Group, with name, optional address and maps link, and default cost.
_Avoid_: Pitch, location

**RSVP**:
A Membership's response to a Match: in or out. There is no "maybe".

**Capacity**:
The maximum number of in-RSVPs for a Match. Defaults to 10.

**Waitlist**:
The ordered queue of in-RSVPs beyond Capacity. Promotes automatically when a slot opens.

**Match at risk**:
A Match whose in-count is below the minimum-players threshold. Triggers a nudge to admins.

**Late dropout**:
A flag recorded when an RSVP changes from in to out after the RSVP deadline. It has no penalty in v1.

**Teams**:
The two sides generated for a Match. Teams are either a **draft** (visible to admins only) or **published** (visible to everyone).
_Avoid_: Lineup, squad (squad means the Group's member list)

**Draft / Published**:
The two states of a Match's Teams. Publishing notifies everyone. Nothing changes after publishing without admin confirmation.

**Balance**:
The difference between the two Teams' total Ratings. Shown to admins as a live meter, and optionally to players as a team-strength comparison.

**Minimal-change fix**:
The proposed adjustment after a dropout on published Teams. It promotes the first waitlisted player, or if there is none, moves the fewest players needed to rebalance. An admin must confirm it.

**Result**:
The score of a Match, recorded as one number per side. Nothing else is recorded in v1.

**Attendance board**:
A Group-wide list of how many Matches each Membership has played.

## Relationships

- A **Person** has many **Memberships**; a **Membership** belongs to exactly one **Group**
- A **Group** has many **Matches**, **Venues** and at most one **Recurring template**
- A **Match** has many **RSVPs**, one **Venue**, at most one set of **Teams** and at most one **Result**
- A **Guest** is a Membership scoped to a single Match until promoted
- **Ratings** and **Position tags** live on the **Membership**, never on the **Person**

## Example dialogue

> **Dev:** "When someone claims a **ghost profile**, do they get the **rating** that the **admin** set?"
> **Domain expert:** "They get the **Membership**, but they never see the **rating**. It stays admin-only. If they also join another **Group**, that is a different **Membership** with its own **rating**."
> **Dev:** "And if they drop out after the **teams** are **published**?"
> **Domain expert:** "The app proposes a **minimal-change fix**, usually promoting the first person on the **waitlist**. An **admin** has to confirm it. We never change published **teams** silently."

## Flagged ambiguities

- "Player" was used for the global identity, the per-group record and the person on the pitch. Resolved: **Person** is the identity, **Membership** is the per-group record, and **Player** is informal only.
- "Organiser" is the user persona, not a role in the system. Resolved: the roles are **Owner** and **Admin**.
- "Squad" could mean the Group's member list or a Match's chosen players. Resolved: **Squad** is the UI tab for the member list, and a Match's sides are **Teams**.
- "Match" vs "game" vs "fixture": use **Match** only.
