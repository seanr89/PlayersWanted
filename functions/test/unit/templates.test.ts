import type { NotificationEvent } from '@pw/shared';
import { describe, expect, it } from 'vitest';
import { renderNotification } from '../../src/notify/templates';

const base = { gameId: 'g1', gameLabel: 'Leisure Centre, Sat 7 Nov, 19:00' };
const APP = 'https://pw.example.com';

describe('renderNotification', () => {
  const cases: [NotificationEvent, string][] = [
    [{ ...base, type: 'player_joined', playerName: 'Sam', state: 'confirmed' }, 'Sam joined your game'],
    [{ ...base, type: 'player_joined', playerName: 'Sam', state: 'waitlisted' }, 'Sam joined the waitlist'],
    [{ ...base, type: 'player_left', playerName: 'Sam' }, 'Sam left your game'],
    [{ ...base, type: 'promoted' }, "You're in! A space opened up"],
    [{ ...base, type: 'removed' }, 'You were removed from a game'],
    [{ ...base, type: 'game_changed' }, 'Game details changed'],
    [{ ...base, type: 'game_cancelled' }, 'Game cancelled'],
    [{ ...base, type: 'reminder' }, 'Game tomorrow'],
  ];

  it.each(cases)('renders %j', (event, title) => {
    const msg = renderNotification(event, APP);
    expect(msg.title).toBe(title);
    expect(msg.body).toContain('Leisure Centre, Sat 7 Nov, 19:00');
    expect(msg.url).toBe('https://pw.example.com/games/g1');
  });
});
