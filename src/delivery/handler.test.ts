import { describe, expect, it } from "vitest";
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
    const response = await handleDispatchRequest(request(), env, ok);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 3, skipped: 1, failed: 1 });
  });

  it("does not run for a missing, wrong or differently sized secret", async () => {
    let ran = 0;
    const deps = { runDispatch: async () => (ran++, result) };

    for (const token of [null, "wrong", "", "s3cret-token-value-and-more"]) {
      const response = await handleDispatchRequest(request({ token }), env, deps);
      expect(response.status).toBe(401);
    }
    expect(ran).toBe(0);
  });

  it("only accepts POST", async () => {
    expect((await handleDispatchRequest(request({ method: "GET" }), env, ok)).status).toBe(405);
  });

  it("fails closed when no secret is configured, even for a request with an empty token", async () => {
    const response = await handleDispatchRequest(request({ token: "" }), { ...env, CRON_SECRET: undefined }, ok);

    expect(response.status).toBe(503);
  });

  it("refuses to run without a delivery channel, so events are not claimed and then dropped", async () => {
    let ran = false;
    const response = await handleDispatchRequest(request(), { ...env, SMTP_URL: undefined }, {
      runDispatch: async () => ((ran = true), result),
    });

    expect(response.status).toBe(503);
    expect(ran).toBe(false);
  });

  it("refuses to run without the service credentials", async () => {
    const response = await handleDispatchRequest(request(), { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, ok);

    expect(response.status).toBe(503);
  });

  it("answers with a generic error, never details, if the dispatcher throws", async () => {
    const response = await handleDispatchRequest(request(), env, {
      runDispatch: async () => {
        throw new Error("connect ECONNREFUSED key=service-key a@b.test");
      },
    });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("service-key");
    expect(text).not.toContain("a@b.test");
  });
});
