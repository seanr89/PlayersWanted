import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

const fbError = (code: string, message = '') => Object.assign(new Error(message), { code });

describe('errorMessage', () => {
  it('shows the server message for precondition, validation and not-found errors', () => {
    expect(errorMessage(fbError('functions/failed-precondition', 'This game has been cancelled.'))).toBe(
      'This game has been cancelled.',
    );
    expect(errorMessage(fbError('functions/invalid-argument', 'Capacity must be an even number from 6 to 22.'))).toBe(
      'Capacity must be an even number from 6 to 22.',
    );
    expect(errorMessage(fbError('functions/not-found', 'That game no longer exists.'))).toBe('That game no longer exists.');
  });

  it('maps codes without a useful server message', () => {
    expect(errorMessage(fbError('functions/unauthenticated'))).toBe('Please sign in first.');
    expect(errorMessage(fbError('functions/permission-denied'))).toBe('Only the organiser can do that.');
    expect(errorMessage(fbError('functions/unavailable'))).toMatch(/offline/);
    expect(errorMessage(fbError('auth/invalid-action-code'))).toMatch(/expired/);
  });

  it('falls back to a generic message', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
    expect(errorMessage('weird')).toBe('Something went wrong. Please try again.');
  });
});
