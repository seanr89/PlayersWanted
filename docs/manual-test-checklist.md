# Manual release checklist (M1)

Run on the deployed site before announcing a release.

## Install
- [ ] Android Chrome: "Install app" works; app opens standalone.
- [ ] iOS Safari 16.4+: Share → Add to Home Screen; app opens standalone.
- [ ] Airplane mode: installed app still opens and shows the last-seen games; action buttons are disabled with the offline notice.

## Sign-in and sharing
- [ ] Google sign-in works on Android and desktop.
- [ ] Email link sign-in works; opening the link on a second device asks for the email.
- [ ] Share a game link into WhatsApp; open it signed out → details show, roster hidden, "Sign in to join" → after sign-in you land back on the same game.

## Roster
- [ ] Fill a 6-player game from 7 accounts; the 7th is waitlisted; the card shows "Full · 1 waiting".
- [ ] A confirmed player leaves → waitlisted player is promoted live in another browser.
- [ ] Organiser removes a player, toggles Paid, raises capacity (promotes), tries to lower capacity below confirmed (error shown inline).

## Notifications (email and push, for each)
- [ ] Organiser: player joined / joined waitlist / left.
- [ ] Player: promoted from waitlist; removed by organiser.
- [ ] All participants: time or venue changed; game cancelled.
- [ ] Confirmed players: reminder ~24h before kick-off.
- [ ] Push prompt appears only in the installed app, after joining, never on first load.
- [ ] Turning email off in Profile stops emails.
