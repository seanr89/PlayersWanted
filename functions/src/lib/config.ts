import { defineSecret, defineString } from 'firebase-functions/params';

export const REGION = 'europe-west2';
export const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
export const APP_URL = defineString('APP_URL', { default: 'http://127.0.0.1:5173' });
export const EMAIL_FROM = defineString('EMAIL_FROM', { default: 'PlayersWanted <games@example.com>' });

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}
