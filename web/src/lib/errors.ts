const OFFLINE = "You're offline — try again when you're connected.";

const MESSAGES: Record<string, string> = {
  'functions/unauthenticated': 'Please sign in first.',
  'functions/permission-denied': 'Only the organiser can do that.',
  'functions/unavailable': OFFLINE,
  'functions/deadline-exceeded': OFFLINE,
  'functions/internal': 'Something went wrong on our side. Please try again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/invalid-action-code': 'This sign-in link has expired or was already used. Request a new one.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/network-request-failed': OFFLINE,
  'permission-denied': "You don't have permission to do that.",
  unavailable: OFFLINE,
};

const SHOW_SERVER_MESSAGE = new Set(['functions/failed-precondition', 'functions/invalid-argument', 'functions/not-found']);

export function errorMessage(err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : '';
  if (SHOW_SERVER_MESSAGE.has(code) && message) return message;
  return MESSAGES[code] ?? 'Something went wrong. Please try again.';
}
