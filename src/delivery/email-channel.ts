import type { Notification, NotificationChannel } from "../app-layer/notifications";

/** The one method of a nodemailer transport that we use, so tests can swap in a fake. */
export interface Mailer {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export interface EmailChannelDeps {
  mailer: Mailer;
  from: string;
  /** Finds the email address for an account, or null if it has none (e.g. a player who joined anonymously). */
  lookupEmail: (authUserId: string) => Promise<string | null>;
}

/** One plain address: nothing that nodemailer could read as a list, a display name or a group. */
const SINGLE_ADDRESS = /^[^\s,;<>"'()[\]\\]+@[^\s,;<>"'()[\]\\]+$/;

/**
 * Sends each recipient their own plain-text email. Nobody else's address or name appears in it. People without an
 * email address are skipped; a failing address does not stop the rest, and the failure is reported as a count
 * (never with addresses, which would end up in logs).
 */
export class EmailChannel implements NotificationChannel {
  readonly name = "email";

  constructor(private readonly deps: EmailChannelDeps) {}

  async send(notification: Notification): Promise<void> {
    const accounts = [...new Set(notification.recipients.flatMap((r) => (r.authUserId ? [r.authUserId] : [])))];
    let attempted = 0;
    let failed = 0;

    for (const account of accounts) {
      let address: string | null;
      try {
        address = await this.deps.lookupEmail(account);
      } catch {
        attempted++;
        failed++;
        continue;
      }
      if (!address) continue;
      attempted++;
      if (!SINGLE_ADDRESS.test(address)) {
        failed++;
        continue;
      }
      try {
        await this.deps.mailer.sendMail({
          from: this.deps.from,
          to: address,
          subject: notification.title.replace(/[\r\n]+/g, " "),
          text:
            `${notification.body}\n\n${notification.url}\n\n` +
            `You're receiving this because you're a member of "${notification.groupName}" on Bibleague.`,
        });
      } catch {
        failed++;
      }
    }
    if (failed > 0) throw new Error(`${failed} of ${attempted} emails failed`);
  }
}
