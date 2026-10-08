import { DomainError } from '@pw/shared';
import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';

export function toHttpsError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof DomainError) return new HttpsError(err.code, err.message);
  logger.error('Unexpected error in callable', err);
  return new HttpsError('internal', 'Something went wrong. Please try again.');
}
