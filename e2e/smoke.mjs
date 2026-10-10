// Manual end-to-end check of the UI in a real (headless) browser at phone size.
// Needs: local Supabase running with Mailpit SMTP exposed, and `npm run dev` on :3000.
//   node e2e/smoke.mjs        (screenshots go to e2e/shots/, which is gitignored)
import { chromium, devices } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:54324";
const shots = new URL("./shots/", import.meta.url).pathname;
const step = (m) => console.log(`- ${m}`);

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"] };
const adminCtx = await browser.newContext(phone);
const playerCtx = await browser.newContext(phone);
const admin = await adminCtx.newPage();
const player = await playerCtx.newPage();
for (const [name, page] of [["admin", admin], ["player", player]]) {
  page.on("pageerror", (e) => console.log(`[${name} page error] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && console.log(`[${name} console] ${m.text()}`));
}

async function magicLinkFor(email) {
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

async function evidence(error) {
  for (const [name, page] of [["admin", admin], ["player", player]]) {
    await page.screenshot({ path: `${shots}failure-${name}.png`, fullPage: true }).catch(() => {});
    const overlay = await page.evaluate(() => document.querySelector("nextjs-portal")?.shadowRoot?.textContent?.slice(0, 600) ?? "").catch(() => "");
    if (overlay) console.log(`[${name} dev overlay] ${overlay.replace(/\s+/g, " ")}`);
  }
  console.log(`FAILED: ${error.message.split("\n")[0]}`);
  await browser.close();
  process.exit(1);
}

try {
// 1. Organiser signs in with an emailed link and creates a group.
const email = `organiser-${Date.now()}@example.test`;
await admin.goto(`${APP}/start`);
await admin.getByLabel("Your email").fill(email);
await admin.getByRole("button", { name: "Email me a link" }).click();
await admin.getByText("Check your email").waitFor();
step("magic link requested");
await admin.screenshot({ path: `${shots}01-check-email.png` });
await admin.goto(await magicLinkFor(email));
await admin.getByLabel("Group name").waitFor();
await admin.getByLabel("Group name").fill("Thursday 7pm Powerleague");
await admin.getByLabel("Your name").fill("Sean");
await admin.screenshot({ path: `${shots}02-name-your-game.png` });
await admin.getByRole("button", { name: "Create group" }).click();
await admin.getByText("No game scheduled.").waitFor();
step("group created; empty state shown to organiser");
await admin.screenshot({ path: `${shots}03-no-match.png` });

// 2. Organiser makes a match two days out and opens RSVPs.
await admin.getByRole("link", { name: "Matches" }).click();
await admin.getByRole("button", { name: "New match" }).click();
const kickoff = new Date(Date.now() + 2 * 24 * 3600_000);
kickoff.setHours(19, 0, 0, 0);
const local = new Date(kickoff.getTime() - kickoff.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
await admin.getByLabel("Kick-off").fill(local);
await admin.getByLabel("Cost each").fill("4.50");
await admin.screenshot({ path: `${shots}04-new-match.png` });
await admin.getByRole("button", { name: "Create match" }).click();
await admin.getByText("RSVPs not open").waitFor();
await admin.getByRole("link", { name: "Next match" }).click();
await admin.getByRole("button", { name: "Open RSVPs", exact: true }).click();
await admin.getByRole("button", { name: "I'm in", exact: true }).waitFor();
step("match created and RSVPs opened");
await admin.screenshot({ path: `${shots}05-organiser-rsvps-open.png` });

// 3. Organiser copies the invite link from the Group tab.
await admin.getByRole("link", { name: "Group" }).click();
await admin.getByText("Invite players").waitFor();
const invite = await admin.locator("p", { hasText: "/join/" }).first().innerText();
step(`invite link: ${invite.trim()}`);
await admin.screenshot({ path: `${shots}06-group-tab.png`, fullPage: true });

// 4. A player opens the invite link, adds themselves, and taps "I'm in".
await player.goto(invite.trim().replace(/^https?:\/\/[^/]+/, APP));
await player.getByText("What should we call you?").waitFor();
await player.screenshot({ path: `${shots}07-join.png` });
await player.getByLabel("Your name").fill("Priya");
await player.getByRole("button", { name: "Join" }).click();
await player.getByRole("button", { name: "I'm in", exact: true }).waitFor();
await player.screenshot({ path: `${shots}08-player-before.png` });
await player.getByRole("button", { name: "I'm in", exact: true }).click();
await player.getByText("You're in").waitFor();
step("player tapped I'm in");
await player.screenshot({ path: `${shots}09-player-in.png` });

// 5. Organiser sees them in the list.
await admin.getByRole("link", { name: "Next match" }).click();
await admin.getByText("Priya").waitFor();
step("organiser sees Priya in the list");
await admin.screenshot({ path: `${shots}10-organiser-sees-priya.png` });

} catch (error) {
  await evidence(error);
}
await browser.close();
console.log("smoke test passed");
