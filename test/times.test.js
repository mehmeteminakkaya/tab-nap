import { test } from "node:test";
import assert from "node:assert/strict";
import { presets, presetById, formatWhen, toLocalInputValue } from "../extension/lib/times.js";

const get = (now, id) => presetById(id, now).when;
const ymdh = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

// 2026-11-18 is a Wednesday.
const wedMorning = new Date(2026, 10, 18, 10, 7);

test("later today is +3h rounded up to 5 minutes", () => {
  assert.deepEqual(ymdh(get(wedMorning, "later")), [2026, 11, 18, 13, 10]);
});

test("evening is today before 17:00, tomorrow after", () => {
  assert.deepEqual(ymdh(get(wedMorning, "evening")), [2026, 11, 18, 18, 0]);
  const late = new Date(2026, 10, 18, 17, 30);
  const p = presetById("evening", late);
  assert.equal(p.label, "Tomorrow evening");
  assert.deepEqual(ymdh(p.when), [2026, 11, 19, 18, 0]);
});

test("tomorrow morning", () => {
  assert.deepEqual(ymdh(get(wedMorning, "tomorrow")), [2026, 11, 19, 9, 0]);
});

test("weekend is the coming Saturday; on a Saturday it is next Saturday", () => {
  assert.deepEqual(ymdh(get(wedMorning, "weekend")), [2026, 11, 21, 9, 0]);
  const sat = new Date(2026, 10, 21, 8, 0);
  const p = presetById("weekend", sat);
  assert.equal(p.label, "Next weekend");
  assert.deepEqual(ymdh(p.when), [2026, 11, 28, 9, 0]);
});

test("next week is the coming Monday; on a Monday it is a week later", () => {
  assert.deepEqual(ymdh(get(wedMorning, "nextweek")), [2026, 11, 23, 9, 0]);
  const mon = new Date(2026, 10, 23, 8, 0);
  assert.deepEqual(ymdh(get(mon, "nextweek")), [2026, 11, 30, 9, 0]);
});

test("next month clamps to the month's last day and crosses years", () => {
  assert.deepEqual(ymdh(get(new Date(2026, 0, 31, 12), "nextmonth")), [2026, 2, 28, 9, 0]);
  assert.deepEqual(ymdh(get(new Date(2026, 11, 15, 12), "nextmonth")), [2027, 1, 15, 9, 0]);
});

test("every preset is in the future", () => {
  for (let h = 0; h < 24; h++) {
    for (let day = 15; day <= 21; day++) {
      const now = new Date(2026, 10, day, h, 59);
      for (const p of presets(now)) assert.ok(p.when > now, `${p.id} at ${now}`);
    }
  }
});

test("formatWhen", () => {
  const now = new Date(2026, 10, 18, 10, 0);
  assert.match(formatWhen(new Date(2026, 10, 18, 18, 0), now, "en-GB"), /^Today 18:00$/);
  assert.match(formatWhen(new Date(2026, 10, 19, 9, 0), now, "en-GB"), /^Tomorrow 09:00$/);
  assert.match(formatWhen(new Date(2026, 10, 21, 9, 0), now, "en-GB"), /^Sat 21 Nov, 09:00$/);
  assert.match(formatWhen(new Date(2027, 0, 2, 9, 0), now, "en-GB"), /2027/);
});

test("toLocalInputValue", () => {
  assert.equal(toLocalInputValue(new Date(2026, 0, 5, 7, 3)), "2026-01-05T07:03");
});
