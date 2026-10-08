import { DomainError } from '@pw/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { toHttpsError } from '../../src/lib/errors';

describe('toHttpsError', () => {
  it('maps a DomainError to the same code and message', () => {
    const err = toHttpsError(new DomainError('failed-precondition', 'This game has been cancelled.'));
    expect(err).toBeInstanceOf(HttpsError);
    expect(err.code).toBe('failed-precondition');
    expect(err.message).toBe('This game has been cancelled.');
  });

  it('passes an HttpsError through', () => {
    const original = new HttpsError('unauthenticated', 'Sign in first.');
    expect(toHttpsError(original)).toBe(original);
  });

  it('hides unexpected errors behind internal', () => {
    const err = toHttpsError(new Error('database exploded'));
    expect(err.code).toBe('internal');
    expect(err.message).not.toContain('exploded');
  });
});
