// Shared by the manual end-to-end scripts. They need the local Supabase stack (with Mailpit's SMTP port exposed),
// `npm run dev` on :3000, and `npx playwright install chromium` once.
import { execFileSync } from "node:child_process";

export const APP = process.env.APP_URL ?? "http://localhost:3000";
export const MAILPIT = "http://127.0.0.1:54324";
export const shots = new URL("./shots/", import.meta.url).pathname;
export const step = (message) => console.log(`- ${message}`);

/** Waits for the sign-in link Mailpit caught for an address. */
export async function magicLinkFor(email) {
  for (let i = 0; i < 40; i++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    if (found.messages?.length) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json();
      const link = /https?:\/\/[^\s"<>]*verify[^\s"<>]*/.exec(msg.Text + msg.HTML)?.[0];
      if (link) return link.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no magic link arrived");
}

/** Signs an organiser in with a real emailed link and creates a Group. Returns the Group's id. */
export async function startGroup(page, { groupName, yourName }) {
  const email = `organiser-${Date.now()}@example.test`;
  await page.goto(`${APP}/start`);
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await page.getByText("Check your email").waitFor();
  await page.goto(await magicLinkFor(email));
  await page.getByLabel("Group name").fill(groupName);
  await page.getByLabel("Your name").fill(yourName);
  await page.getByRole("button", { name: "Create group" }).click();
  await page.getByText("No game scheduled.").waitFor();
  return /\/g\/([0-9a-f-]+)/.exec(page.url())[1];
}

/** Test setup only: runs SQL as the database owner. */
export function sql(query) {
  return execFileSync("docker", ["exec", "supabase_db_PlayersWanted", "psql", "-U", "postgres", "-tAc", query], { encoding: "utf8" }).trim();
}

/** Sets a datetime-local input's value for a time `days` from now at 19:00. */
export function kickoffInput(days) {
  const kickoff = new Date(Date.now() + days * 24 * 3600_000);
  kickoff.setHours(19, 0, 0, 0);
  return new Date(kickoff.getTime() - kickoff.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
