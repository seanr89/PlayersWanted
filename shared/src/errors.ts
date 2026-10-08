export type DomainErrorCode = 'invalid-argument' | 'failed-precondition' | 'permission-denied' | 'not-found';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
