// Manual end-to-end check of editing a player's Rating, position and happy-in-goal, in headless Chromium at phone size.
//   node e2e/ratings.mjs       (screenshots go to e2e/shots/)
import { chromium, devices } from "playwright";
import { shots, sql, startGroup, step } from "./helpers.mjs";

const browser = await chromium.launch();
const page = await (await browser.newContext(devices["iPhone 13"])).newPage();
page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));

async function fail(error) {
  await page.screenshot({ path: `${shots}ratings-failure.png`, fullPage: true }).catch(() => {});
  console.log(`[url] ${page.url()}\nFAILED: ${error.message.split("\n")[0]}`);
  await browser.close();
  process.exit(1);
}

const ratingOf = (groupId, name) =>
  sql(`select r.rating from memberships m join membership_ratings r on r.membership_id = m.id where m.group_id = '${groupId}' and m.display_name = '${name}'`);

try {
  const groupId = await startGroup(page, { groupName: "Thursday 7pm Powerleague", yourName: "Sean" });
  sql(`insert into memberships (group_id, display_name, claim) values ('${groupId}', 'Mo', 'ghost')`);
  sql(`insert into membership_ratings (membership_id) select id from memberships where group_id = '${groupId}' and display_name = 'Mo'`);
  await page.getByRole("link", { name: "Squad" }).click();
  await page.getByRole("button", { name: "Edit Mo" }).waitFor();
  step("squad shown with an Edit button per player");

  // 1. The editor opens with the default Rating and its band.
  await page.getByRole("button", { name: "Edit Mo" }).click();
  const form = page.getByRole("form", { name: "Edit Mo" });
  const slider = form.getByRole("slider");
  if (!(await slider.evaluate((el) => el === document.activeElement))) throw new Error("focus did not move into the editor");
  if ((await slider.inputValue()) !== "50") throw new Error("default Rating is not 50");
  if (!(await form.innerText()).includes("Solid Sunday player")) throw new Error("band label missing");
  if (!(await form.getByRole("button", { name: "Save" }).isDisabled())) throw new Error("Save should be off until something changes");
  await page.screenshot({ path: `${shots}30-edit-player.png`, fullPage: true });
  // Save must not end up behind the fixed tab bar.
  await form.getByRole("button", { name: "Cancel" }).scrollIntoViewIfNeeded();
  const [saveBottom, tabsTop] = await page.evaluate(() => [
    Math.round(document.querySelector('form[aria-label="Edit Mo"] button.primary').getBoundingClientRect().bottom),
    Math.round(document.querySelector(".tabs").getBoundingClientRect().top),
  ]);
  if (saveBottom > tabsTop) throw new Error(`Save (bottom ${saveBottom}) is under the tab bar (top ${tabsTop})`);

  // 2. Keyboard: arrow keys move the slider and the band follows; then save all three fields.
  for (let i = 0; i < 35; i++) await page.keyboard.press("ArrowRight");
  if ((await slider.inputValue()) !== "85") throw new Error(`slider at ${await slider.inputValue()}`);
  if (!(await form.innerText()).includes("Ex-semi-pro")) throw new Error("band did not follow the slider");
  await form.getByLabel("Position").selectOption("defender");
  await form.getByLabel("Happy to play in goal").check();
  await form.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Edit Mo" }).waitFor();
  const row = await page.locator(".list li", { hasText: "Mo" }).innerText();
  if (!/Defender/.test(row) || !/Happy in goal/.test(row) || !/Rating 85/.test(row)) throw new Error(`row says: ${row}`);
  if ((await ratingOf(groupId, "Mo")) !== "85") throw new Error("Rating not stored");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  if (focused !== "Edit Mo") throw new Error(`focus went to ${focused}`);
  step("Rating 85, defender, happy in goal saved; focus returned to Edit");
  await page.screenshot({ path: `${shots}31-edit-saved.png`, fullPage: true });

  // 3. Cancel discards, and clearing the position works.
  await page.getByRole("button", { name: "Edit Mo" }).click();
  await form.getByLabel("Position").selectOption("");
  await form.getByRole("button", { name: "Cancel" }).click();
  if (!/Defender/.test(await page.locator(".list li", { hasText: "Mo" }).innerText())) throw new Error("cancel kept the change");
  await page.getByRole("button", { name: "Edit Mo" }).click();
  await form.getByLabel("Position").selectOption("");
  await form.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Edit Mo" }).waitFor();
  if (/Defender/.test(await page.locator(".list li", { hasText: "Mo" }).innerText())) throw new Error("position not cleared");
  step("cancel discards; position can be cleared");

  // 4. A player (not an admin) sees no Edit buttons, no Ratings, and can set only their own happy-in-goal.
  // Test setup only: hand ownership to Mo so Sean can be a plain player (triggers off for this one transaction).
  sql(`set session_replication_role = replica;
    update memberships set role = 'member' where group_id = '${groupId}' and display_name = 'Sean';
    update memberships set role = 'owner' where group_id = '${groupId}' and display_name = 'Mo'`);
  await page.reload();
  await page.getByRole("heading", { name: "Squad" }).waitFor();
  if ((await page.getByRole("button", { name: /^Edit / }).count()) !== 0) throw new Error("a player can see Edit buttons");
  if (/Rating \d/.test(await page.locator("main").innerText())) throw new Error("a player can see a Rating");
  await page.getByLabel("I'm happy to play in goal").click();
  await page.getByLabel("I'm happy to play in goal").waitFor();
  await page.waitForFunction(() => document.querySelector("main")?.innerText.includes("Happy in goal"));
  step("player view: no Edit, no Ratings, can tick their own happy-in-goal");
  await page.screenshot({ path: `${shots}32-player-view.png`, fullPage: true });

  console.log("PASS");
  await browser.close();
} catch (e) {
  await fail(e);
}
