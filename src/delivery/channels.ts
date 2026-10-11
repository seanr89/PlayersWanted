import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { NotificationChannel } from "../app-layer/notifications";
import { EmailChannel } from "./email-channel";

/** Settings the delivery worker reads from the environment. All server-side only. */
export interface WorkerEnv {
  CRON_SECRET?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_APP_URL?: string;
  /** e.g. smtp://user:pass@smtp.example.com:587 (locally, the Mailpit port from supabase/config.toml). */
  SMTP_URL?: string;
  EMAIL_FROM?: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * SMTP connection settings from an smtp:// or smtps:// address. A remote server must use TLS, so credentials are
 * never sent in the clear; plain SMTP is allowed only to the local machine (the dev mail catcher). Timeouts keep a
 * dead server from holding the worker. Errors never include the address, which carries the password.
 */
export function smtpTransportOptions(smtpUrl: string): SMTPTransport.Options {
  const invalid = new Error("SMTP_URL must be a valid smtp:// or smtps:// address");
  let url: URL;
  try {
    url = new URL(smtpUrl);
  } catch {
    throw invalid;
  }
  if ((url.protocol !== "smtp:" && url.protocol !== "smtps:") || !url.hostname) throw invalid;

  const secure = url.protocol === "smtps:";
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure && !LOOPBACK.has(url.hostname),
    ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/** The settings email needs, or null if it is not configured. The one place that decides whether email is on. */
function emailSettings(env: WorkerEnv): { smtpUrl: string; from: string } | null {
  return env.SMTP_URL && env.EMAIL_FROM ? { smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM } : null;
}

/** Email is the one channel built so far; more (web push) are added here without touching callers. */
export const hasDeliveryChannel = (env: WorkerEnv) => emailSettings(env) !== null;

/**
 * An account's address, but only if it is confirmed: otherwise anyone could register someone else's address,
 * join a Group and receive its mail. Anonymous players have no address and get null.
 */
export async function lookupConfirmedEmail(service: SupabaseClient, authUserId: string): Promise<string | null> {
  const { data, error } = await service.auth.admin.getUserById(authUserId);
  if (error) throw new Error(error.message);
  const user = data.user;
  return user?.email && user.email_confirmed_at ? user.email : null;
}

/** Looks each account up once per delivery run, however many events mention it. */
export function memoisedEmailLookup(service: SupabaseClient): (authUserId: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return (authUserId) => {
    let found = cache.get(authUserId);
    if (!found) {
      found = lookupConfirmedEmail(service, authUserId);
      cache.set(authUserId, found);
    }
    return found;
  };
}

export function createChannels(env: WorkerEnv, service: SupabaseClient): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  const email = emailSettings(env);
  if (email) {
    channels.push(
      new EmailChannel({
        mailer: nodemailer.createTransport(smtpTransportOptions(email.smtpUrl)),
        from: email.from,
        lookupEmail: memoisedEmailLookup(service),
      }),
    );
  }
  return channels;
}
