import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { dispatchNotifications, type DispatchResult } from "../app-layer/notifications";
import { createChannels, hasDeliveryChannel, type WorkerEnv } from "./channels";

export type { WorkerEnv } from "./channels";

export interface HandlerDeps {
  /** Runs one delivery pass. Defaults to the real dispatcher with the channels the environment configures. */
  runDispatch?: () => Promise<DispatchResult>;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Compares secrets without leaking, through timing, how much of one matched. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The delivery worker's HTTP entry point: a scheduler POSTs here and each call delivers whatever is pending.
 * It fails closed (no secret configured means no access), answers with counts only, and refuses to run when no
 * channel is configured, because claiming events with nowhere to send them would lose them.
 */
export async function handleDispatchRequest(request: Request, env: WorkerEnv, deps: HandlerDeps = {}): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!env.CRON_SECRET) return json({ error: "the delivery worker is not configured" }, 503);

  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!sameSecret(given, env.CRON_SECRET)) return json({ error: "unauthorised" }, 401);

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !hasDeliveryChannel(env)) {
    return json({ error: "the delivery worker is not configured" }, 503);
  }

  try {
    const result = await (deps.runDispatch ?? (() => runWithEnv(env)))();
    for (const failure of result.failures) {
      console.error(`notification ${failure.eventId} failed on ${failure.channel}: ${failure.error}`);
    }
    // 502 when anything failed, so a scheduler can alert; the counts are the same either way.
    const body = { delivered: result.delivered, skipped: result.skipped, failed: result.failures.length };
    return json(body, result.failures.length > 0 ? 502 : 200);
  } catch (e) {
    // Only the message: an error object can carry the input that caused it (such as an SMTP address with a password).
    console.error("notification dispatch failed:", e instanceof Error ? e.message : "unknown error");
    return json({ error: "dispatch failed" }, 500);
  }
}

function runWithEnv(env: WorkerEnv): Promise<DispatchResult> {
  const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return dispatchNotifications(service, createChannels(env, service), { appUrl: env.NEXT_PUBLIC_APP_URL });
}
