import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { DispatchResult } from "../app-layer/notifications";
import { handleDispatchRequest, type WorkerEnv } from "./handler";

const env: WorkerEnv = {
  CRON_SECRET: "s3cret-token-value",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SMTP_URL: "smtp://127.0.0.1:1025",
  EMAIL_FROM: "Bibleague <no-reply@bibleague.example>",
};

const result: DispatchResult = { delivered: 3, skipped: 1, failures: [{ channel: "email", eventId: 9, error: "boom for a@b.test" }] };

function request(init: { method?: string; token?: string | null } = {}) {
  const headers = new Headers();
  if (init.token !== null) headers.set("authorization", `Bearer ${init.token ?? env.CRON_SECRET}`);
  return new Request("http://localhost/api/notifications/dispatch", { method: init.method ?? "POST", headers });
}

const ok = { runDispatch: async () => result };

describe("handleDispatchRequest", () => {
  it("runs the dispatcher for a request with the right secret and reports only counts", async () => {
    const clean: DispatchResult = { delivered: 3, skipped: 1, failures: [] };

    const response = await handleDispatchRequest(request(), env, { runDispatch: async () => clean });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 3, skipped: 1, failed: 0 });
  });

  it("answers 502 when any delivery failed, so a scheduler can alert, with counts only", async () => {
    const response = await handleDispatchRequest(request(), env, ok);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ delivered: 3, skipped: 1, failed: 1 });
  });

  it("does not run for a missing, wrong or differently sized secret", async () => {
    const runDispatch = vi.fn(async () => result);

    for (const token of [null, "wrong", "", `${env.CRON_SECRET}-and-more`]) {
      const response = await handleDispatchRequest(request({ token }), env, { runDispatch });
      expect(response.status).toBe(401);
    }
    expect(runDispatch).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    expect((await handleDispatchRequest(request({ method: "GET" }), env, ok)).status).toBe(405);
  });

  it("fails closed when no secret is configured, even for a request with an empty token", async () => {
    const response = await handleDispatchRequest(request({ token: "" }), { ...env, CRON_SECRET: undefined }, ok);

    expect(response.status).toBe(503);
  });

  it("refuses to run without a delivery channel, so events are not claimed and then dropped", async () => {
    const runDispatch = vi.fn(async () => result);

    const response = await handleDispatchRequest(request(), { ...env, SMTP_URL: undefined }, { runDispatch });

    expect(response.status).toBe(503);
    expect(runDispatch).not.toHaveBeenCalled();
  });

  it("refuses to run without the service credentials", async () => {
    const response = await handleDispatchRequest(request(), { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, ok);

    expect(response.status).toBe(503);
  });

  it("answers with a generic error, never details, if the dispatcher throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleDispatchRequest(request(), env, {
      runDispatch: async () => {
        throw new Error(`connect ECONNREFUSED key=${env.SUPABASE_SERVICE_ROLE_KEY} a@b.test`);
      },
    });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY!);
    expect(text).not.toContain("a@b.test");
  });

  it("never logs the SMTP password, even when the SMTP address is malformed", async () => {
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args));
    const badEnv = { ...env, SMTP_URL: "smtp://user:s3cretpw@bad host:99999999" };

    const response = await handleDispatchRequest(request(), badEnv);

    expect(response.status).toBe(500);
    expect(inspect(logged, { depth: 6 })).not.toContain("s3cretpw");
    expect(await response.text()).not.toContain("s3cretpw");
  });
});
