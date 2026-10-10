import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { lookupConfirmedEmail, smtpTransportOptions } from "./channels";

const serviceReturning = (user: unknown, error: { message: string } | null = null) =>
  ({ auth: { admin: { getUserById: async () => ({ data: { user }, error }) } } }) as unknown as SupabaseClient;

describe("lookupConfirmedEmail", () => {
  it("returns the address of a confirmed account", async () => {
    const email = await lookupConfirmedEmail(serviceReturning({ email: "a@x.test", email_confirmed_at: "2026-10-01T00:00:00Z" }), "u");

    expect(email).toBe("a@x.test");
  });

  it("ignores an address that was never confirmed, so nobody can receive a Group's mail by claiming someone else's address", async () => {
    expect(await lookupConfirmedEmail(serviceReturning({ email: "victim@x.test", email_confirmed_at: null }), "u")).toBeNull();
  });

  it("returns null for accounts with no address, such as anonymous players", async () => {
    expect(await lookupConfirmedEmail(serviceReturning({ email: "", email_confirmed_at: null }), "u")).toBeNull();
    expect(await lookupConfirmedEmail(serviceReturning(null), "u")).toBeNull();
  });

  it("fails loudly on a lookup error", async () => {
    await expect(lookupConfirmedEmail(serviceReturning(null, { message: "boom" }), "u")).rejects.toThrow("boom");
  });

  it("asks the account service once per account, however many events mention it", async () => {
    let calls = 0;
    const service = {
      auth: { admin: { getUserById: async () => (calls++, { data: { user: { email: "a@x.test", email_confirmed_at: "t" } }, error: null }) } },
    } as unknown as SupabaseClient;
    const lookup = (await import("./channels")).memoisedEmailLookup(service);

    await lookup("u");
    await lookup("u");

    expect(calls).toBe(1);
  });
});

describe("smtpTransportOptions", () => {
  it("requires TLS for a remote server, so credentials are never sent in the clear", () => {
    expect(smtpTransportOptions("smtp://user:p%40ss@mail.example.com:587")).toMatchObject({
      host: "mail.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "user", pass: "p@ss" },
    });
  });

  it("uses implicit TLS for smtps", () => {
    expect(smtpTransportOptions("smtps://mail.example.com")).toMatchObject({ secure: true, port: 465 });
  });

  it("allows plain SMTP to a loopback server, for the local mail catcher", () => {
    const options = smtpTransportOptions("smtp://127.0.0.1:54325");
    expect(options.requireTLS).toBeFalsy();
    expect(options.auth).toBeUndefined();
  });

  it("sets timeouts, so a dead server cannot hold the worker for minutes", () => {
    const options = smtpTransportOptions("smtp://mail.example.com");
    expect(options.connectionTimeout).toBeLessThanOrEqual(15_000);
    expect(options.greetingTimeout).toBeLessThanOrEqual(15_000);
    expect(options.socketTimeout).toBeLessThanOrEqual(30_000);
  });

  it("rejects anything that is not an smtp address, without echoing the input", () => {
    for (const bad of ["http://mail.example.com", "not a url", "smtp://user:s3cret@bad host:99999999", ""]) {
      let message = "";
      try {
        smtpTransportOptions(bad);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/SMTP_URL/);
      expect(message).not.toContain("s3cret");
    }
  });
});
