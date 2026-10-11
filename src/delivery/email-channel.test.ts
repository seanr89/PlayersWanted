import { describe, expect, it } from "vitest";
import type { Notification, Recipient } from "../app-layer/notifications";
import { EmailChannel, type Mailer } from "./email-channel";

const recipient = (n: number, overrides: Partial<Recipient> = {}): Recipient => ({
  personId: `person-${n}`,
  membershipId: `membership-${n}`,
  displayName: `Player ${n}`,
  authUserId: `user-${n}`,
  isAdmin: false,
  ...overrides,
});

const notification = (recipients: Recipient[], overrides: Partial<Notification> = {}): Notification => ({
  kind: "rsvps_opened",
  groupId: "g",
  groupName: "Thursday",
  matchId: "m",
  title: "RSVPs are open for Thu 15 Oct, 19:00",
  body: "Thursday: Thu 15 Oct, 19:00.\nTap to say you're in.",
  url: "https://bibleague.example/matches/m",
  payload: {},
  recipients,
  ...overrides,
});

function fixture(emails: Record<string, string | null>, failFor: string[] = []) {
  const sent: { from: string; to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = {
    async sendMail(message) {
      if (failFor.includes(message.to)) throw new Error(`rejected ${message.to}`);
      sent.push(message);
    },
  };
  const looked: string[] = [];
  const channel = new EmailChannel({
    mailer,
    from: "Bibleague <no-reply@bibleague.example>",
    lookupEmail: async (id) => {
      looked.push(id);
      return emails[id] ?? null;
    },
  });
  return { channel, sent, looked };
}

describe("EmailChannel", () => {
  it("sends each recipient their own email, with the title as subject and the link in the body", async () => {
    const { channel, sent } = fixture({ "user-1": "one@x.test", "user-2": "two@x.test" });

    await channel.send(notification([recipient(1), recipient(2)]));

    expect(sent.map((m) => m.to).sort()).toEqual(["one@x.test", "two@x.test"]);
    for (const mail of sent) {
      expect(mail.subject).toBe("RSVPs are open for Thu 15 Oct, 19:00");
      expect(mail.text).toContain("Tap to say you're in.");
      expect(mail.text).toContain("https://bibleague.example/matches/m");
      expect(mail.text).toContain("Thursday");
      expect(mail.from).toBe("Bibleague <no-reply@bibleague.example>");
    }
  });

  it("never reveals other recipients: one address per email, and no names of others", async () => {
    const { channel, sent } = fixture({ "user-1": "one@x.test", "user-2": "two@x.test" });

    await channel.send(notification([recipient(1), recipient(2)]));

    for (const mail of sent) {
      expect(mail.to).not.toMatch(/[,;]/);
      expect(mail.text).not.toContain("Player 1");
      expect(mail.text).not.toContain("Player 2");
      expect(mail.text).not.toContain("x.test");
    }
  });

  it("skips people without an email address, such as players who joined anonymously", async () => {
    const { channel, sent } = fixture({ "user-1": "one@x.test", "user-2": null });

    await channel.send(notification([recipient(1), recipient(2), recipient(3, { authUserId: null })]));

    expect(sent.map((m) => m.to)).toEqual(["one@x.test"]);
  });

  it("does nothing, quietly, when nobody has an address", async () => {
    const { channel, sent } = fixture({});

    await channel.send(notification([recipient(1)]));

    expect(sent).toEqual([]);
  });

  it("keeps going when one address is rejected, then reports how many failed without naming addresses", async () => {
    const { channel, sent } = fixture(
      { "user-1": "one@x.test", "user-2": "bad@x.test", "user-3": "three@x.test" },
      ["bad@x.test"],
    );

    const sending = channel.send(notification([recipient(1), recipient(2), recipient(3)]));

    await expect(sending).rejects.toThrow(/^1 of 3 emails failed$/); // a count, never an address
    expect(sent.map((m) => m.to).sort()).toEqual(["one@x.test", "three@x.test"]);
  });

  it("sends to one address only: a value that would parse as several is not sent", async () => {
    const { channel, sent } = fixture({ "user-1": "victim@x.test, attacker@evil.test", "user-2": "ok@x.test" });

    await expect(channel.send(notification([recipient(1), recipient(2)]))).rejects.toThrow(/1 of 2 emails failed/);

    expect(sent.map((m) => m.to)).toEqual(["ok@x.test"]);
  });

  it("looks each account up once, even if listed twice", async () => {
    const { channel, looked } = fixture({ "user-1": "one@x.test" });

    await channel.send(notification([recipient(1), recipient(1, { membershipId: "other" })]));

    expect(looked).toEqual(["user-1"]);
  });

  it("keeps newlines out of the subject, so a title cannot add headers", async () => {
    const { channel, sent } = fixture({ "user-1": "one@x.test" });

    await channel.send(notification([recipient(1)], { title: "Hello\r\nBcc: attacker@evil.test" }));

    expect(sent[0]!.subject).not.toMatch(/[\r\n]/);
  });
});
