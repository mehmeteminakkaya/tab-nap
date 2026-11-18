// Tab Nap service worker: stores snoozed tabs and brings them back on time.
import { presetById, presets, formatWhen } from "./lib/times.js";

const KEY = "naps";
const CHECK_ALARM = "nap-check";
const ALARM_PREFIX = "nap:";

// Runs storage read-modify-write steps one at a time, so an alarm and the
// minute check can't both wake (and open) the same tab.
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function loadNaps() {
  const { [KEY]: naps = [] } = await chrome.storage.local.get(KEY);
  return naps;
}

async function saveNaps(naps) {
  naps.sort((a, b) => a.when - b.when);
  await chrome.storage.local.set({ [KEY]: naps });
  await updateBadge(naps);
}

async function updateBadge(naps) {
  await chrome.action.setBadgeBackgroundColor({ color: "#6d5bd0" });
  await chrome.action.setBadgeText({ text: naps.length ? String(naps.length) : "" });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function addNap({ url, title, favIconUrl }, when) {
  if (!url || !/^(https?|file|ftp):/i.test(url)) {
    throw new Error("This page can't be snoozed.");
  }
  if (!(when > Date.now())) throw new Error("Pick a time in the future.");
  const nap = { id: newId(), url, title: title || url, favIconUrl: favIconUrl || "", when, created: Date.now() };
  await serial(async () => {
    const naps = await loadNaps();
    naps.push(nap);
    await saveNaps(naps);
  });
  await chrome.alarms.create(ALARM_PREFIX + nap.id, { when });
  return nap;
}

async function snoozeTab(tabId, when) {
  const tab = await chrome.tabs.get(tabId);
  const nap = await addNap(tab, when);
  // Closing the only tab would close the window (and maybe the browser).
  const siblings = await chrome.tabs.query({ windowId: tab.windowId });
  if (siblings.length === 1) {
    await chrome.tabs.create({ windowId: tab.windowId });
  }
  await chrome.tabs.remove(tabId);
  return nap;
}

function wake(ids, opts) {
  return serial(() => wakeNow(ids, opts));
}

async function wakeNow(ids, { notify = true, active = false } = {}) {
  const naps = await loadNaps();
  const woken = naps.filter((n) => ids.includes(n.id));
  if (!woken.length) return [];
  await saveNaps(naps.filter((n) => !ids.includes(n.id)));
  for (const nap of woken) {
    await chrome.alarms.clear(ALARM_PREFIX + nap.id);
    await chrome.tabs.create({ url: nap.url, active });
  }
  if (notify) {
    const title = woken.length === 1 ? "A tab is back" : `${woken.length} tabs are back`;
    const message = woken.map((n) => n.title).join("\n").slice(0, 300);
    try {
      await chrome.notifications.create("nap-" + Date.now(), {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message,
      });
    } catch {
      // Notifications are a nicety; the tabs are already open.
    }
  }
  return woken;
}

async function cancel(id) {
  await serial(async () => {
    const naps = await loadNaps();
    await saveNaps(naps.filter((n) => n.id !== id));
  });
  await chrome.alarms.clear(ALARM_PREFIX + id);
}

// Wakes everything that is due, including naps missed while the browser was closed.
function wakeDue() {
  return serial(async () => {
    const now = Date.now();
    const due = (await loadNaps()).filter((n) => n.when <= now).map((n) => n.id);
    if (due.length) await wakeNow(due);
  });
}

// Menus are built once, so their labels must not depend on the time of day.
const MENU_LABELS = {
  later: "Later today (3 hours)",
  evening: "Next evening (18:00)",
  tomorrow: "Tomorrow morning",
  weekend: "At the weekend",
  nextweek: "Next week",
  nextmonth: "Next month",
};

// ---------- events ----------

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "nap-link", title: "Snooze link until…", contexts: ["link"] });
    chrome.contextMenus.create({ id: "nap-page", title: "Snooze this tab until…", contexts: ["page"] });
    for (const p of presets()) {
      const title = MENU_LABELS[p.id] || p.label;
      chrome.contextMenus.create({ id: `nap-link:${p.id}`, parentId: "nap-link", title, contexts: ["link"] });
      chrome.contextMenus.create({ id: `nap-page:${p.id}`, parentId: "nap-page", title, contexts: ["page"] });
    }
  });
}

async function ensureCheckAlarm() {
  if (!(await chrome.alarms.get(CHECK_ALARM))) {
    await chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 1 });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  setupMenus();
  await ensureCheckAlarm();
  await updateBadge(await loadNaps());
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureCheckAlarm();
  await wakeDue();
  await updateBadge(await loadNaps());
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CHECK_ALARM) return wakeDue();
  if (alarm.name.startsWith(ALARM_PREFIX)) return wake([alarm.name.slice(ALARM_PREFIX.length)]);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const [kind, presetId] = String(info.menuItemId).split(":");
  const preset = presetId && presetById(presetId);
  if (!preset) return;
  if (kind === "nap-link" && info.linkUrl) {
    await addNap({ url: info.linkUrl, title: info.selectionText || info.linkUrl }, preset.when.getTime());
  } else if (kind === "nap-page" && tab?.id != null) {
    await snoozeTab(tab.id, preset.when.getTime());
  }
});

chrome.notifications.onClicked.addListener((id) => chrome.notifications.clear(id));

// Messages from the popup.
const handlers = {
  list: async () => ({ naps: await loadNaps() }),
  snooze: async ({ tabId, when }) => ({ nap: await snoozeTab(tabId, when) }),
  wake: async ({ id }) => ({ woken: await wake([id], { notify: false, active: true }) }),
  cancel: async ({ id }) => (await cancel(id), {}),
  label: async ({ when }) => ({ text: formatWhen(when) }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg)
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
