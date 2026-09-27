import test from 'node:test';
import assert from 'node:assert/strict';
import { idleExpired } from '../src/app/idle.ts';

test('normal input remains unlocked before monotonic deadline', () => {
  assert.equal(idleExpired(1000, 1_000_000, 31_000, 1_030_000, 600_000), false);
});
test('wall-clock rollback conservatively locks', () => {
  assert.equal(idleExpired(1000, 1_000_000, 2000, 900_000, 600_000), true);
});
test('suspend recovery locks when monotonic clock did not advance', () => {
  assert.equal(idleExpired(1000, 1_000_000, 2000, 1_700_000, 600_000), true);
});
test('monotonic idle locks despite a small wall-clock adjustment', () => {
  assert.equal(idleExpired(1000, 1_000_000, 602_000, 1_100_000, 600_000), true);
});
