# Deployment runbook

One-time setup for a new Firebase project.

1. Create a Firebase project and upgrade it to the **Blaze** plan. In Google Cloud Billing, add a **$5 budget alert**.
2. Create the Firestore database in **europe-west2** (London).
3. Authentication → Sign-in method: enable **Email link (passwordless)** and **Google**. Add the Hosting domain to Authorised domains.
4. Project settings → Cloud Messaging → Web Push certificates: generate a key pair. This is `VITE_FIREBASE_VAPID_KEY`.
5. Project settings → Your apps: add a Web app. Copy its config into the GitHub repository **variables** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, plus `FIREBASE_PROJECT_ID`, `APP_URL` (e.g. `https://<project>.web.app`) and `EMAIL_FROM` (e.g. `PlayersWanted <games@yourdomain>`).
6. Resend: verify the sending domain, create an API key, then run `npx firebase functions:secrets:set RESEND_API_KEY --project <project>`.
7. Create a service account with the **Firebase Admin** and **Cloud Functions Admin**, **Service Account User**, **Secret Manager Secret Accessor** roles. Store its JSON key as the GitHub **secret** `FIREBASE_SERVICE_ACCOUNT`, and create a GitHub environment named `production`.
8. Seed the real areas: edit `scripts/areas.json`, then `npm run seed -- --areas-only --project <project>` (needs `gcloud auth application-default login`).
9. Push to `main`. The `deploy` job runs `firebase deploy` (hosting, functions, rules, indexes).
