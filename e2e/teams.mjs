// Manual end-to-end check of the team-assignment screen in headless Chromium at phone size.
//   node e2e/teams.mjs       (screenshots go to e2e/shots/)
import { chromium, devices } from "playwright";
import { APP, kickoffInput, shots, sql, startGroup, step } from "./helpers.mjs";

const browser = await chromium.launch();
const page = await (await browser.newContext(devices["iPhone 13"])).newPage();
page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));

async function fail(error) {
  await page.screenshot({ path: `${shots}teams-failure.png`, fullPage: true }).catch(() => {});
  console.log(`[url] ${page.url()}\nFAILED: ${error.message.split("\n")[0]}`);
  await browser.close();
  process.exit(1);
}

const side = (label) => page.locator(`section[aria-labelledby="team-${label}"]`);
const namesIn = async (label) => (await side(label).locator(".player-name").allInnerTexts()).sort();
const gapText = () => page.locator(".meter .gap").innerText();

try {
  // Set up: a Group, a match with RSVPs open, and eight players with varied Ratings who are all in.
  const groupId = await startGroup(page, { groupName: "Thursday 7pm Powerleague", yourName: "Sean" });
  await page.getByRole("link", { name: "Matches" }).click();
  await page.getByRole("button", { name: "New match" }).click();
  await page.getByLabel("Kick-off").fill(kickoffInput(2));
  await page.getByLabel("Players").fill("8");
  await page.getByRole("button", { name: "Create match" }).click();
  await page.getByText("RSVPs not open").waitFor();
  await page.getByRole("link", { name: "Next match" }).click();
  await page.getByRole("button", { name: "Open RSVPs", exact: true }).click();
  await page.getByRole("button", { name: "I'm in", exact: true }).waitFor();

  sql(`
    with m as (select id from matches where group_id = '${groupId}' order by created_at desc limit 1),
    people(name, rating, pos, keeper) as (values
      ('Mo', 90, 'attacker'::position_tag, false), ('Dave', 80, 'defender'::position_tag, true),
      ('Priya', 70, 'attacker'::position_tag, false), ('Luca', 60, 'defender'::position_tag, false),
      ('Jess', 50, null, true), ('Tom', 40, 'defender'::position_tag, false),
      ('Ollie', 30, 'attacker'::position_tag, false), ('Ben', 20, null, false)),
    ins as (insert into memberships (group_id, display_name, claim, position, happy_in_goal)
            select '${groupId}', name, 'ghost', pos, keeper from people returning id, display_name),
    r as (insert into membership_ratings (membership_id, rating)
          select ins.id, people.rating from ins join people on people.name = ins.display_name returning 1)
    insert into rsvps (match_id, membership_id, response) select m.id, ins.id, 'in' from ins, m`);
  await page.reload();
  step("8 players seeded and in");

  // 1. "Make teams" takes the organiser straight to the screen.
  await page.getByRole("button", { name: "Make teams" }).click();
  await page.getByRole("heading", { name: "Balance" }).waitFor();
  if (!/\/teams$/.test(page.url())) throw new Error("did not go to the team screen");
  await page.screenshot({ path: `${shots}20-teams-draft.png`, fullPage: true });
  const a0 = await namesIn("A");
  const b0 = await namesIn("B");
  if (a0.length !== 4 || b0.length !== 4) throw new Error(`expected 4 v 4, got ${a0.length} v ${b0.length}`);
  const gap0 = await gapText();
  // The Balance meter stays in view while scrolling, and the tab bar does not cover the buttons.
  await page.getByRole("button", { name: "Start again" }).scrollIntoViewIfNeeded();
  const meterTop = await page.locator(".meter").evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const buttonBottom = await page.getByRole("button", { name: "Start again" }).evaluate((el) => el.getBoundingClientRect().bottom);
  const tabTop = await page.locator(".tabs").evaluate((el) => el.getBoundingClientRect().top);
  if (meterTop !== 0) throw new Error(`meter is not pinned (top ${meterTop})`);
  if (buttonBottom > tabTop) throw new Error("the tab bar covers the buttons");
  await page.screenshot({ path: `${shots}20b-teams-scrolled.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  const label = await side("A").locator(".player").first().evaluate((el) => el.textContent);
  if (!/, rating \d+/.test(label)) throw new Error(`a player's name should say "rating": ${label}`);
  step(`teams made: A=${a0.join("/")} B=${b0.join("/")} (${gap0})`);

  // 2. Tap a player, then someone on the other team: they swap, and the meter moves at once.
  const firstA = await side("A").locator(".player").first().locator(".player-name").innerText();
  const firstB = await side("B").locator(".player").first().locator(".player-name").innerText();
  await side("A").locator(".player").first().click();
  await page.getByText(`${firstA} selected`).waitFor();
  await page.screenshot({ path: `${shots}21-teams-selected.png`, fullPage: true });
  await side("B").locator(".player").first().click();
  await side("A").locator(".player-name", { hasText: firstB }).waitFor();
  const a1 = await namesIn("A");
  if (!a1.includes(firstB) || a1.includes(firstA)) throw new Error("the swap did not happen");
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-player"), null, { timeout: 3000 }).catch(() => {
    throw new Error("focus was lost after the swap");
  });
  const gap1 = await gapText();
  step(`swapped ${firstA} and ${firstB}: ${gap0} -> ${gap1}`);
  await page.screenshot({ path: `${shots}22-teams-swapped.png`, fullPage: true });

  // 3. The swap was saved: a reload shows the same teams.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await page.getByRole("heading", { name: "Balance" }).waitFor();
  if (JSON.stringify(await namesIn("A")) !== JSON.stringify(a1)) throw new Error("the swap was not saved");
  step("swap persisted across a reload");

  // 4. Next suggestion steps along the generator's ranked list (confirming, as the teams were edited).
  await page.getByText("Suggestion 1.").waitFor();
  await page.getByRole("button", { name: "Next suggestion" }).click();
  await page.getByRole("group", { name: /Swap in the next suggestion/ }).waitFor();
  await page.getByRole("button", { name: "Keep these" }).click(); // keeping them changes nothing
  if (!(await namesIn("A")).includes(firstB)) throw new Error("keeping the swap changed the teams");
  await page.getByRole("button", { name: "Next suggestion" }).click();
  await page.getByRole("button", { name: "Show the next suggestion" }).click();
  await page.getByText("Suggestion 2.").waitFor();
  step("next suggestion asks before replacing swaps, then works");

  // 4b. "Start again" asks first, and keeping the teams changes nothing.
  const beforeAgain = JSON.stringify(await namesIn("A"));
  await page.getByRole("button", { name: "Start again" }).click();
  await page.getByRole("group", { name: /Throw these teams away/ }).waitFor();
  await page.getByRole("button", { name: "Keep these" }).click();
  if (JSON.stringify(await namesIn("A")) !== beforeAgain) throw new Error("keeping the teams changed them");
  step("start again asks first");

  // 5. Publish returns to the next match, now showing the published teams.
  await page.getByRole("button", { name: "Publish teams" }).click();
  await page.getByRole("heading", { name: "Teams", exact: true }).waitFor();
  await page.getByText("All sorted. Teams are published.").waitFor();
  await page.screenshot({ path: `${shots}23-teams-published.png`, fullPage: true });
  step("published; next match shows the teams");

  // 6. A published team screen is read-only.
  await page.getByRole("link", { name: "See the balance" }).click();
  await page.getByText("These teams are published").waitFor();
  if ((await side("A").locator("button.player").count()) > 0) throw new Error("published teams should not be editable");
  if ((await side("A").locator(".player").count()) !== 4) throw new Error("published teams should still be listed");
  step("published teams are read-only until you ask to change them");

  // 7. Change teams: swaps stay on the device until saved; saving asks first and tells players.
  const stored = () =>
    sql(`select string_agg(side || ':' || display_name, ',' order by display_name) from team_players tp
         join memberships m on m.id = tp.membership_id where tp.match_id = (select id from matches where group_id = '${groupId}')`);
  const revision = () => sql(`select revision from teams where match_id = (select id from matches where group_id = '${groupId}')`);
  const eventCount = () => sql(`select count(*) from notification_events where kind = 'teams_changed' and group_id = '${groupId}'`);
  const storedBefore = stored();
  await page.getByRole("button", { name: "Change teams" }).click();
  await page.getByText("Nothing changes for players until you save").waitFor();
  if (!(await page.getByRole("button", { name: "Save changes" }).isDisabled())) throw new Error("Save should be off before any change");
  const pubA = await side("A").locator(".player-name").first().innerText();
  const pubB = await side("B").locator(".player-name").first().innerText();
  const gapBefore = await gapText();
  await side("A").locator(".player").first().click();
  await side("B").locator(".player").first().click();
  await side("A").locator(".player-name", { hasText: pubB }).waitFor();
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-player"), null, { timeout: 3000 }).catch(() => {
    throw new Error("focus was lost after the swap");
  });
  step(`swapped ${pubA} and ${pubB} while changing: ${gapBefore} -> ${await gapText()}`);
  if (stored() !== storedBefore) throw new Error("a swap reached the database before Save");
  // Reloading the page abandons the unsaved change. (Surviving the 30s background refresh is by design, not checked here.)
  await page.reload();
  await page.getByRole("heading", { name: "Balance" }).waitFor();
  if (!(await page.getByRole("button", { name: "Change teams" }).isVisible())) throw new Error("a reload should leave change mode");
  if (stored() !== storedBefore) throw new Error("unsaved changes were stored");
  step("unsaved swaps are not stored, and a reload drops them");

  await page.getByRole("button", { name: "Change teams" }).click();
  await side("A").locator(".player").first().click();
  await side("B").locator(".player").first().click();
  await page.screenshot({ path: `${shots}24-teams-changing.png`, fullPage: true });
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("group", { name: /Save these teams/ }).waitFor();
  await page.getByRole("button", { name: "Keep editing" }).click();
  if (stored() !== storedBefore) throw new Error("declining the confirmation still saved");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Save and tell players" }).click();
  await page.getByText("Saved. Players have been told").waitFor();
  if (stored() === storedBefore) throw new Error("saving did not change the teams");
  if (revision() !== "1") throw new Error(`revision is ${revision()}`);
  if (eventCount() !== "1") throw new Error(`expected one teams_changed event, got ${eventCount()}`);
  await page.getByRole("button", { name: "Change teams" }).waitFor();
  await page.screenshot({ path: `${shots}25-teams-changed.png`, fullPage: true });
  step("saved after confirming: stored, revision 1, one notification");
} catch (error) {
  await fail(error);
}
await browser.close();
console.log("team screen check passed");
