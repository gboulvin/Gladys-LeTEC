import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  formatClock,
  minutesUntil,
  parseGtfsTime,
  serviceDate,
  serviceDayStart,
  weekday,
} from '../src/time.js';

test('a service day starts at local midnight on an ordinary day', () => {
  // CEST (UTC+2): midnight is 22:00 UTC the day before.
  assert.equal(serviceDayStart('20261014'), Date.UTC(2026, 9, 13, 22, 0));
  // CET (UTC+1) in winter.
  assert.equal(serviceDayStart('20261215'), Date.UTC(2026, 11, 14, 23, 0));
});

test('on a DST change day, the service day starts at noon minus 12 hours', () => {
  // 25 October 2026: noon is CET (11:00 UTC), so the origin is 23:00 UTC the
  // day before — one hour after the local midnight (22:00 UTC, still CEST).
  assert.equal(serviceDayStart('20261025'), Date.UTC(2026, 9, 24, 23, 0));
});

test('GTFS times may go past 24:00', () => {
  assert.equal(parseGtfsTime('08:05:30'), 8 * 3600 + 5 * 60 + 30);
  assert.equal(parseGtfsTime('25:10:00'), 25 * 3600 + 10 * 60);
  assert.equal(parseGtfsTime(' 7:00:00 '), 7 * 3600);
  assert.equal(parseGtfsTime('soon'), null);
});

test('dates and clocks are read in Brussels', () => {
  assert.equal(serviceDate(Date.UTC(2026, 9, 14, 22, 30)), '20261015');
  assert.equal(formatClock(Date.UTC(2026, 9, 14, 6, 3)), '08:03');
  assert.equal(addDays('20261231', 1), '20270101');
  assert.equal(addDays('20261101', -1), '20261031');
  assert.equal(weekday('20261014'), 2, 'a Wednesday');
  assert.equal(weekday('20261018'), 6, 'a Sunday');
});

test('the countdown is in whole minutes, never negative', () => {
  assert.equal(minutesUntil(1000 + 5 * 60_000 + 59_000, 1000), 5);
  assert.equal(minutesUntil(0, 60_000), 0);
});
