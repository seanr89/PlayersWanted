/** Only allow same-origin, in-app return paths after sign-in. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/sign-in') || next.startsWith('/finish-sign-in')) return '/';
  return next;
}
