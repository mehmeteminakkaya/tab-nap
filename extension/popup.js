import { presets, formatWhen, toLocalInputValue } from "./lib/times.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const SNOOZABLE = /^(https?|file|ftp):/i;
let target = null; // the tab to snooze

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

async function findTarget() {
  // ?tabId= lets tests (and future pages) aim at a specific tab.
  const param = new URLSearchParams(location.search).get("tabId");
  if (param) return chrome.tabs.get(Number(param));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function snooze(when) {
  showError("");
  const res = await send({ type: "snooze", tabId: target.id, when });
  if (!res?.ok) return showError(res?.error || "Something went wrong.");
  // The tab is gone now; when the popup belongs to it, it closes by itself.
  await renderList();
  disablePresets("Snoozed ✓");
}

function disablePresets(reason) {
  for (const b of document.querySelectorAll(".preset, #custom button")) b.disabled = true;
  $("cur-title").textContent = reason;
}

function renderPresets() {
  const grid = $("presets");
  grid.textContent = "";
  for (const p of presets()) {
    const b = document.createElement("button");
    b.className = "preset";
    b.dataset.preset = p.id;
    const label = document.createElement("b");
    label.textContent = p.label;
    const when = document.createElement("span");
    when.textContent = formatWhen(p.when);
    b.append(label, when);
    b.addEventListener("click", () => snooze(p.when.getTime()));
    grid.append(b);
  }
}

function favicon(url) {
  const img = document.createElement("img");
  img.width = img.height = 16;
  img.alt = "";
  img.src = url || "icons/icon16.png";
  img.addEventListener("error", () => (img.src = "icons/icon16.png"), { once: true });
  return img;
}

async function renderList() {
  const res = await send({ type: "list" });
  const naps = res?.naps || [];
  const list = $("list");
  list.textContent = "";
  $("empty").hidden = naps.length > 0;
  $("count").textContent = naps.length ? `· ${naps.length}` : "";
  for (const nap of naps) {
    const li = document.createElement("li");
    li.dataset.id = nap.id;

    const text = document.createElement("div");
    text.className = "nap-text";
    const a = document.createElement("a");
    a.className = "nap-title";
    a.href = nap.url;
    a.title = nap.url;
    a.textContent = nap.title;
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      await send({ type: "wake", id: nap.id });
      await renderList();
    });
    const when = document.createElement("span");
    when.className = "nap-when";
    when.textContent = formatWhen(nap.when);
    text.append(a, when);

    const wakeBtn = document.createElement("button");
    wakeBtn.className = "icon-btn";
    wakeBtn.textContent = "Wake";
    wakeBtn.title = "Open it now";
    wakeBtn.addEventListener("click", async () => {
      await send({ type: "wake", id: nap.id });
      await renderList();
    });

    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "✕";
    del.title = "Forget this tab";
    del.setAttribute("aria-label", "Forget " + nap.title);
    del.addEventListener("click", async () => {
      await send({ type: "cancel", id: nap.id });
      await renderList();
    });

    li.append(favicon(nap.favIconUrl), text, wakeBtn, del);
    list.append(li);
  }
}

async function init() {
  const input = $("custom-when");
  const tomorrow = new Date(Date.now() + 24 * 3600e3);
  tomorrow.setHours(9, 0, 0, 0);
  input.value = toLocalInputValue(tomorrow);
  input.min = toLocalInputValue(new Date());

  renderPresets();
  $("custom").addEventListener("submit", (e) => {
    e.preventDefault();
    const when = new Date(input.value).getTime();
    if (!(when > Date.now())) return showError("Pick a time in the future.");
    snooze(when);
  });

  try {
    target = await findTarget();
  } catch {
    target = null;
  }
  if (!target || !SNOOZABLE.test(target.url || "")) {
    disablePresets("This page can't be snoozed");
  } else {
    $("cur-title").textContent = target.title || target.url;
    $("cur-icon").src = target.favIconUrl || "icons/icon16.png";
  }
  await renderList();
}

init();
