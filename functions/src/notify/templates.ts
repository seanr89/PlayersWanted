import type { NotificationEvent } from '@pw/shared';

export interface Message {
  title: string;
  body: string;
  url: string;
}

export function renderNotification(event: NotificationEvent, appUrl: string): Message {
  const url = `${appUrl}/games/${event.gameId}`;
  const label = event.gameLabel;
  switch (event.type) {
    case 'player_joined':
      return {
        title: event.state === 'confirmed' ? `${event.playerName} joined your game` : `${event.playerName} joined the waitlist`,
        body: label,
        url,
      };
    case 'player_left':
      return { title: `${event.playerName} left your game`, body: label, url };
    case 'promoted':
      return { title: "You're in! A space opened up", body: `You've moved off the waitlist for ${label}.`, url };
    case 'removed':
      return { title: 'You were removed from a game', body: `The organiser removed you from ${label}.`, url };
    case 'game_changed':
      return { title: 'Game details changed', body: `${label} — check the new time and venue.`, url };
    case 'game_cancelled':
      return { title: 'Game cancelled', body: `${label} has been cancelled.`, url };
    case 'reminder':
      return { title: 'Game tomorrow', body: `Reminder: you're playing at ${label}.`, url };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled notification ${JSON.stringify(unhandled)}`);
    }
  }
}
