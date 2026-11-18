// Pure date helpers: when each "snooze until" preset wakes up, and how to show it.
// No chrome.* here, so it runs under `node --test`.

export const MORNING_HOUR = 9;
export const EVENING_HOUR = 18;

function at(base, days, hour, minute = 0) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function roundUpTo5Min(d) {
  const r = new Date(d);
  r.setSeconds(0, 0);
  const m = r.getMinutes();
  const up = Math.ceil(m / 5) * 5;
  r.setMinutes(up);
  return r;
}

// Days from `now` to the next given weekday (0 = Sunday), always 1..7.
function daysUntil(now, weekday) {
  const diff = (weekday - now.getDay() + 7) % 7;
  return diff === 0 ? 7 : diff;
}

function nextMonth(now) {
  const d = new Date(now);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  d.setHours(MORNING_HOUR, 0, 0, 0);
  return d;
}

/** The snooze choices for `now`, in display order. */
export function presets(now = new Date()) {
  const list = [];
  list.push({ id: "later", label: "Later today", when: roundUpTo5Min(new Date(now.getTime() + 3 * 3600e3)) });
  if (now.getHours() < EVENING_HOUR - 1) {
    list.push({ id: "evening", label: "This evening", when: at(now, 0, EVENING_HOUR) });
  } else {
    list.push({ id: "evening", label: "Tomorrow evening", when: at(now, 1, EVENING_HOUR) });
  }
  list.push({ id: "tomorrow", label: "Tomorrow morning", when: at(now, 1, MORNING_HOUR) });
  const day = now.getDay();
  const isWeekend = day === 6 || day === 0;
  list.push({ id: "weekend", label: isWeekend ? "Next weekend" : "This weekend", when: at(now, daysUntil(now, 6), MORNING_HOUR) });
  list.push({ id: "nextweek", label: "Next week", when: at(now, daysUntil(now, 1), MORNING_HOUR) });
  list.push({ id: "nextmonth", label: "Next month", when: nextMonth(now) });
  return list;
}

export function presetById(id, now = new Date()) {
  return presets(now).find((p) => p.id === id) || null;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today 18:00", "Tomorrow 09:00", "Sat 22 Nov, 09:00". */
// The UI is in English, so dates are too (otherwise "Sat" next to "21 Kas").
export function formatWhen(when, now = new Date(), locale = "en-GB") {
  const d = new Date(when);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, at(now, 1, 0))) return `Tomorrow ${time}`;
  const date = d.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${date}, ${time}`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInputValue(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
