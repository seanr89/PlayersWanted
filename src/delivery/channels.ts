import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import type { NotificationChannel } from "../app-layer/notifications";
import { EmailChannel } from "./email-channel";

/** Settings the delivery worker reads from the environment. */
export interface WorkerEnv {
  CRON_SECRET?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_APP_URL?: string;
  /** e.g. smtp://user:pass@smtp.example.com:587 (locally, the Mailpit port from supabase/config.toml). */
  SMTP_URL?: string;
  EMAIL_FROM?: string;
}

/** Email is the one channel built so far; more (web push) are added here without touching callers. */
export const hasDeliveryChannel = (env: WorkerEnv) => Boolean(env.SMTP_URL && env.EMAIL_FROM);

export function createChannels(env: WorkerEnv, service: SupabaseClient): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  if (env.SMTP_URL && env.EMAIL_FROM) {
    channels.push(
      new EmailChannel({
        mailer: nodemailer.createTransport(env.SMTP_URL),
        from: env.EMAIL_FROM,
        lookupEmail: async (authUserId) => {
          const { data, error } = await service.auth.admin.getUserById(authUserId);
          if (error) throw new Error(error.message);
          return data.user?.email ?? null;
        },
      }),
    );
  }
  return channels;
}
