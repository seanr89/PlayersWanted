import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app, db } from './firebase';

type Permission = NotificationPermission | 'unsupported';

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function currentPermission(): Permission {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export function shouldPromptForPush(env: { standalone: boolean; permission: Permission; pushOn: boolean }): boolean {
  return env.standalone && env.permission === 'default' && !env.pushOn;
}

export async function enablePush(uid: string): Promise<'enabled' | 'denied' | 'unsupported'> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  await setDoc(doc(db, 'users', uid, 'pushTokens', token), {
    createdAt: serverTimestamp(),
    userAgent: navigator.userAgent.slice(0, 300),
  });
  await updateDoc(doc(db, 'users', uid), { 'notify.push': true });
  return 'enabled';
}

export async function disablePush(uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { 'notify.push': false });
}
