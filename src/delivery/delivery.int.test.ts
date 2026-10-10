import { describe, expect, it } from "vitest";
import { createGroup, createMatch, getInviteToken, joinGroup, openRsvps, updateGroup } from "../app-layer/index";
import { dispatchNotifications } from "../app-layer/notifications";
import { inAWeek, newEmailUser, newUser, serviceClient, serviceKey, sql } from "../app-layer/test-support";
import { handleDispatchRequest, type WorkerEnv } from "./handler";

const MAILPIT = "http://127.0.0.1:54324";

const env = (): WorkerEnv => ({
  CRON_SECRET: "integration-test-secret",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: serviceKey(),
  SMTP_URL: "smtp://127.0.0.1:54325",
  EMAIL_FROM: "Bibleague <no-reply@bibleague.example>",
  NEXT_PUBLIC_APP_URL: "https://bibleague.example",
});

const post = (secret = "integration-test-secret") =>
  new Request("http://localhost/api/notifications/dispatch", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Waits for Mailpit (the local mail catcher) to show mail for an address. */
async function mailFor(address: string): Promise<{ subject: string; text: string; to: string[] }[]> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const found = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)).json()) as {
      messages: MailpitMessage[];
    };
    if (found.messages.length > 0) {
      return Promise.all(
        found.messages.map(async (m) => {
          const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
          return { subject: m.Subject, text: full.Text, to: m.To.map((t) => t.Address) };
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

describe("The delivery worker, end to end", () => {
  it("emails an Admin who has an address when RSVPs open, and does not email an anonymous player", async () => {
    const owner = await newEmailUser();
    const groupId = await createGroup(owner.client, { name: "Thursday", ownerName: "Sean" });
    await updateGroup(owner.client, groupId, { timeZone: "UTC" });
    const player = await newUser();
    await joinGroup(player, await getInviteToken(owner.client, groupId), { name: "Priya" });
    const matchId = await createMatch(owner.client, groupId, { startsAt: inAWeek() });
    await openRsvps(owner.client, matchId);

    const response = await handleDispatchRequest(post(), env());

    expect(response.status).toBe(200);
    const mail = await mailFor(owner.email);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toEqual([owner.email]);
    expect(mail[0]!.subject).toMatch(/RSVPs are open/);
    expect(mail[0]!.text).toContain(`https://bibleague.example/matches/${matchId}`);
    expect(mail[0]!.text).toContain("Thursday");
    expect(mail[0]!.text).not.toContain("Priya");
  });

  it("delivers each event only once, even if the scheduler fires twice", async () => {
    const owner = await newEmailUser();
    const groupId = await createGroup(owner.client, { name: "Sunday", ownerName: "Sean" });
    const matchId = await createMatch(owner.client, groupId, { startsAt: inAWeek() });
    await openRsvps(owner.client, matchId);

    await handleDispatchRequest(post(), env());
    await handleDispatchRequest(post(), env());

    expect(await mailFor(owner.email)).toHaveLength(1);
  });

  it("rejects a request without the secret and delivers nothing", async () => {
    const owner = await newEmailUser();
    const groupId = await createGroup(owner.client, { name: "Monday", ownerName: "Sean" });
    const matchId = await createMatch(owner.client, groupId, { startsAt: inAWeek() });
    await openRsvps(owner.client, matchId);

    const response = await handleDispatchRequest(post("wrong"), env());

    expect(response.status).toBe(401);
    expect(sql(`select count(*) from notification_events where group_id = '${groupId}' and dispatched_at is null`)).toBe("1");
  });

  it("leaves events waiting, rather than losing them, when no channel is configured", async () => {
    const owner = await newEmailUser();
    const groupId = await createGroup(owner.client, { name: "Tuesday", ownerName: "Sean" });
    const matchId = await createMatch(owner.client, groupId, { startsAt: inAWeek() });
    await openRsvps(owner.client, matchId);

    await expect(dispatchNotifications(serviceClient(), [])).rejects.toThrow(/no delivery channels/);
    const noChannel = await handleDispatchRequest(post(), { ...env(), SMTP_URL: undefined });

    expect(noChannel.status).toBe(503);
    expect(sql(`select count(*) from notification_events where group_id = '${groupId}' and dispatched_at is null`)).toBe("1");
  });
});
