import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingInstants, resolveRecordTime, utcOffsetLabel, wallTime } from '../src/features/records/recordTime.ts';

test('one instant displays differently in Shanghai and New York', () => {
  const instant = Date.parse('2024-11-03T05:30:00Z');
  assert.equal(wallTime(instant, 'America/New_York'), '2024-11-03T01:30');
  assert.equal(wallTime(instant, 'Asia/Shanghai'), '2024-11-03T13:30');
  assert.deepEqual(matchingInstants('2024-11-03T13:30', 'Asia/Shanghai'), [instant]);
  const original = { occurredAtUtcMs: instant + 12_345, zoneId: 'America/New_York' };
  assert.deepEqual(resolveRecordTime(original, wallTime(original.occurredAtUtcMs, 'Asia/Shanghai'), 'Asia/Shanghai'), original);
  assert.deepEqual(resolveRecordTime(original, '2024-11-03T13:31', 'Asia/Shanghai'), { occurredAtUtcMs: instant + 60_000, zoneId: 'Asia/Shanghai' });
});

test('DST fall-back requires choosing one of two UTC instants', () => {
  const instants = matchingInstants('2024-11-03T01:30', 'America/New_York');
  assert.deepEqual(instants, [Date.parse('2024-11-03T05:30:00Z'), Date.parse('2024-11-03T06:30:00Z')]);
  assert.deepEqual(instants.map((instant) => utcOffsetLabel(instant, 'America/New_York')), ['UTC−04:00', 'UTC−05:00']);
  assert.throws(() => resolveRecordTime(null, '2024-11-03T01:30', 'America/New_York'), /出现两次/);
  assert.deepEqual(resolveRecordTime(null, '2024-11-03T01:30', 'America/New_York', String(instants[1])), { occurredAtUtcMs: instants[1], zoneId: 'America/New_York' });
});

test('DST spring gap and malformed dates cannot be saved', () => {
  assert.deepEqual(matchingInstants('2024-03-10T02:30', 'America/New_York'), []);
  assert.deepEqual(matchingInstants('2024-02-30T12:00', 'Asia/Shanghai'), []);
  assert.throws(() => resolveRecordTime(null, '2024-03-10T02:30', 'America/New_York'), /不存在/);
});
