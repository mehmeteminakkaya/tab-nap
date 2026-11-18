// End-to-end test: loads the real extension into Chromium and snoozes tabs.
//   npm run e2e
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(root, "extension");
const SHOTS = path.join(root, "e2e", "out");
fs.mkdirSync(SHOTS, { recursive: true });

// Tiny local site to snooze.
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1)) || "home";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>${name}</title><h1>${name}</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tabnap-"));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log("ok  ", name);
  } catch (e) {
    failures++;
    console.log("FAIL", name, "\n     ", e.message);
  }
}

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;

  const naps = () => sw.evaluate(async () => (await chrome.storage.local.get("naps")).naps || []);
  const tabUrls = () => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url));
  const tabIdFor = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
  const waitFor = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };

  // A page to snooze, plus a second one so the window stays open.
  const article = await ctx.newPage();
  await article.goto(`${base}/Great%20Article`);
  const keep = await ctx.newPage();
  await keep.goto(`${base}/Keep`);
  const articleUrl = `${base}/Great%20Article`;

  let popup;
  await step("popup opens and shows presets for the target tab", async () => {
    const tabId = await tabIdFor(articleUrl);
    assert.ok(tabId, "article tab exists");
    popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await popup.waitForSelector(".preset");
    assert.equal(await popup.locator(".preset").count(), 6);
    assert.equal(await popup.locator("#cur-title").textContent(), "Great Article");
    await popup.setViewportSize({ width: 340, height: 520 });
    await popup.screenshot({ path: path.join(SHOTS, "popup-empty.png") });
  });

  await step("clicking 'Tomorrow morning' closes the tab and stores it", async () => {
    await popup.locator('.preset[data-preset="tomorrow"]').click();
    assert.ok(await waitFor(async () => !(await tabUrls()).includes(articleUrl)), "tab closed");
    const list = await naps();
    assert.equal(list.length, 1);
    assert.equal(list[0].url, articleUrl);
    assert.equal(list[0].title, "Great Article");
    const when = new Date(list[0].when);
    assert.equal(when.getHours(), 9);
    assert.ok(when > new Date());
    const alarm = await sw.evaluate((id) => chrome.alarms.get("nap:" + id), list[0].id);
    assert.ok(alarm, "alarm scheduled");
    await popup.waitForSelector("#list li");
    const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
    assert.equal(badge, "1");
  });

  await step("'Wake' reopens the tab and clears it", async () => {
    await popup.locator("#list li .icon-btn", { hasText: "Wake" }).click();
    assert.ok(await waitFor(async () => (await tabUrls()).includes(articleUrl)), "tab reopened");
    assert.equal((await naps()).length, 0);
    assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), "");
  });

  await step("custom time + forget (✕) removes without opening", async () => {
    const tabId = await tabIdFor(articleUrl);
    const p2 = await ctx.newPage();
    await p2.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await p2.fill("#custom-when", "2031-05-04T10:30");
    await p2.click("#custom button");
    await p2.waitForSelector("#list li");
    const list = await naps();
    assert.equal(list.length, 1);
    assert.equal(new Date(list[0].when).getFullYear(), 2031);
    await p2.close();
    // Forget it from a fresh popup: gone from the list, tab not reopened.
    const p2b = await ctx.newPage();
    await p2b.goto(`chrome-extension://${extId}/popup.html?tabId=${await tabIdFor(`${base}/Keep`)}`);
    await p2b.waitForSelector("#list li");
    await p2b.locator("#list li .icon-btn", { hasText: "✕" }).click();
    assert.ok(await waitFor(async () => (await naps()).length === 0), "forgotten");
    assert.ok(!(await tabUrls()).includes(articleUrl), "not reopened");
    const alarms = await sw.evaluate(() => chrome.alarms.getAll());
    assert.ok(!alarms.some((a) => a.name.startsWith("nap:")), "alarm cleared");
    await p2b.close();
  });

  await step("a nap that comes due is woken by its alarm", async () => {
    const url = `${base}/Due%20Soon`;
    const due = await ctx.newPage();
    await due.goto(url);
    const tabId = await tabIdFor(url);
    // Unpacked extensions may use alarms shorter than the 30 s store minimum.
    const res = await sw.evaluate(
      ({ tabId }) => new Promise((r) => chrome.runtime.sendMessage({ type: "snooze", tabId, when: Date.now() + 2000 }, r)),
      { tabId }
    ).catch(() => null);
    // sendMessage from the worker to itself has no receiver, so call through a popup page instead.
    if (!res?.ok) {
      const p3 = await ctx.newPage();
      await p3.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
      const r = await p3.evaluate((tabId) => chrome.runtime.sendMessage({ type: "snooze", tabId, when: Date.now() + 2000 }), tabId);
      assert.ok(r.ok, r.error);
      await p3.close();
    }
    assert.ok(await waitFor(async () => !(await tabUrls()).includes(url)), "tab closed");
    assert.ok(await waitFor(async () => (await tabUrls()).includes(url), 40000), "tab came back");
    const left = await naps();
    assert.ok(!left.some((n) => n.url === url), "removed from list");
  });

  await step("chrome:// pages can't be snoozed", async () => {
    const p4 = await ctx.newPage();
    await p4.goto(`chrome-extension://${extId}/popup.html`);
    const r = await p4.evaluate(async () => {
      const t = await chrome.tabs.create({ url: "chrome://version", active: false });
      return chrome.runtime.sendMessage({ type: "snooze", tabId: t.id, when: Date.now() + 60000 });
    });
    assert.equal(r.ok, false);
    await p4.close();
  });

  await step("snoozing the only tab in a window keeps the window open", async () => {
    const p5 = await ctx.newPage();
    await p5.goto(`chrome-extension://${extId}/popup.html`);
    const r = await p5.evaluate(async (u) => {
      const w = await chrome.windows.create({ url: u });
      const [t] = await chrome.tabs.query({ windowId: w.id });
      await new Promise((ok) => setTimeout(ok, 500));
      const res = await chrome.runtime.sendMessage({ type: "snooze", tabId: t.id, when: Date.now() + 3600e3 });
      const left = await chrome.tabs.query({ windowId: w.id });
      return { ok: res.ok, left: left.length };
    }, `${base}/Lonely`);
    assert.ok(r.ok);
    assert.equal(r.left, 1, "a new tab replaced it");
    await p5.close();
  });

  await step("popup screenshot with sleeping tabs", async () => {
    const tabId = await tabIdFor(`${base}/Keep`);
    const p6 = await ctx.newPage();
    await p6.setViewportSize({ width: 340, height: 560 });
    await p6.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await p6.waitForSelector("#list li");
    await p6.screenshot({ path: path.join(SHOTS, "popup-list.png") });
    await p6.emulateMedia({ colorScheme: "dark" });
    await p6.screenshot({ path: path.join(SHOTS, "popup-dark.png") });
  });
} finally {
  await ctx.close();
  server.close();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
