import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarWatch, fromDays } from '../src/app/calendar.ts';

test('local midnight changes the displayed day without waiting for a real clock', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    let instant = new Date('2026-09-27T15:59:30Z');
    let scheduled;
    const changes = [];
    const watch = createCalendarWatch(
      (day) => changes.push(day),
      () => instant,
      (callback, delay) => { scheduled = { callback, delay }; return 1; },
      () => {},
    );
    assert.equal(scheduled.delay, 30_000);
    instant = new Date('2026-09-27T16:00:00Z');
    scheduled.callback();
    assert.equal(changes[0].date, '2026-09-28');
    assert.equal(changes[0].key, '2026-09-28|Asia/Shanghai');
    watch.stop();
  } finally { process.env.TZ = previous; }
});

test('focus check detects a changed timezone even when local date is unchanged', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Shanghai';
    const instant = new Date('2026-09-27T08:00:00Z');
    const changes = [];
    const watch = createCalendarWatch((day) => changes.push(day), () => instant, () => 1, () => {});
    process.env.TZ = 'Asia/Tokyo';
    watch.check();
    assert.equal(changes[0].date, '2026-09-27');
    assert.equal(changes[0].zone, 'Asia/Tokyo');
    watch.stop();
  } finally { process.env.TZ = previous; }
});

test('calendar range stays tied to one local date after a clock change', () => {
  assert.equal(fromDays(7, '2026-01-01'), '2025-12-26');
});
