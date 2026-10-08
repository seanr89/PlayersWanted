import { onSchedule } from 'firebase-functions/v2/scheduler';
import { cancelGameHandler, createGameHandler, updateGameHandler } from './games';
import { db } from './lib/admin';
import { callable } from './lib/callable';
import { REGION, RESEND_API_KEY } from './lib/config';
import { dispatchNotices, installDispatcher } from './notify/notify';
import { runReminders } from './reminders';
import { joinGameHandler, leaveGameHandler, removePlayerHandler, setPaidHandler } from './roster';

installDispatcher();

export const createGame = callable(createGameHandler);
export const updateGame = callable(updateGameHandler);
export const cancelGame = callable(cancelGameHandler);
export const joinGame = callable(joinGameHandler);
export const leaveGame = callable(leaveGameHandler);
export const removePlayer = callable(removePlayerHandler);
export const setPaid = callable(setPaidHandler);

export const sendReminders = onSchedule(
  { schedule: 'every 15 minutes', region: REGION, timeZone: 'Europe/London', secrets: [RESEND_API_KEY] },
  async () => {
    const notices = await runReminders(db, Date.now());
    await dispatchNotices(notices);
  },
);
