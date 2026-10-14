import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOON_MARKS, TRIGGERS, TriggerTracker } from '../src/triggers.js';
import { NOW, TODAY } from './fixtures.js';

const config = { delay_threshold: 5, language: 'fr' };
const DEVICE = 'ext:test:stop:S1';

const departure = (minutes, extra = {}) => ({
  key: `T1|${TODAY}`,
  line: 'M2',
  destination: 'ANDERLUES Monument',
  scheduled: NOW + minutes * 60_000,
  expected: NOW + minutes * 60_000,
  delayMinutes: 0,
  minutes,
  realtime: true,
  cancelled: false,
  ...extra,
});

const snapshot = (departures, alerts = [], alertsLoaded = true) => ({
  entry: { stopId: 'S1' },
  stop: { name: 'CHARLEROI Gare' },
  departures,
  alerts,
  alertsLoaded,
});

const alert = (id, lines = ['M2']) => ({
  id,
  lines,
  header: { fr: `Travaux ${id}`, en: `Works ${id}` },
  description: { fr: 'Déviation' },
  url: { fr: 'https://letec.be/x' },
});

test('departure_soon fires when the countdown crosses a mark, never at first sight', () => {
  const tracker = new TriggerTracker();
  assert.deepEqual(tracker.evaluate(DEVICE, snapshot([departure(6)]), config, NOW), []);
  const events = tracker.evaluate(DEVICE, snapshot([departure(5)]), config, NOW);
  assert.deepEqual(
    events.map((e) => [e.key, e.data.minutes]),
    [[TRIGGERS.DEPARTURE_SOON, '5']],
  );
  assert.equal(events[0].data.device, DEVICE);
  assert.equal(events[0].data.line, 'M2');
  assert.equal(events[0].data.stop_name, 'CHARLEROI Gare');
  // Same minute again: nothing new.
  assert.deepEqual(tracker.evaluate(DEVICE, snapshot([departure(5)]), config, NOW), []);
});

test('a jump of the countdown fires every mark it crossed, once', () => {
  const tracker = new TriggerTracker();
  tracker.evaluate(DEVICE, snapshot([departure(11)]), config, NOW);
  const events = tracker.evaluate(DEVICE, snapshot([departure(7)]), config, NOW);
  assert.deepEqual(
    events.map((e) => e.data.minutes),
    ['7', '8', '9', '10'],
  );
  assert.ok(SOON_MARKS.includes(7));
});

test('departure_delayed fires once, from the configured threshold', () => {
  const tracker = new TriggerTracker();
  assert.deepEqual(
    tracker.evaluate(DEVICE, snapshot([departure(20, { delayMinutes: 4 })]), config, NOW),
    [],
  );
  const late = departure(20, { delayMinutes: 6 });
  const [event] = tracker.evaluate(DEVICE, snapshot([late]), config, NOW);
  assert.equal(event.key, TRIGGERS.DEPARTURE_DELAYED);
  assert.equal(event.data.delay_minutes, 6);
  assert.deepEqual(tracker.evaluate(DEVICE, snapshot([late]), config, NOW), [], 'once');
  // A timetable-only departure has no known delay.
  const fresh = new TriggerTracker();
  const theoretical = departure(20, { delayMinutes: 9, realtime: false });
  assert.deepEqual(fresh.evaluate(DEVICE, snapshot([theoretical]), config, NOW), []);
});

test('departure_cancelled fires once per cancelled departure', () => {
  const tracker = new TriggerTracker();
  const cancelled = departure(15, { cancelled: true });
  const [event] = tracker.evaluate(DEVICE, snapshot([cancelled]), config, NOW);
  assert.equal(event.key, TRIGGERS.DEPARTURE_CANCELLED);
  assert.equal(event.data.scheduled_time.length, 5);
  assert.deepEqual(tracker.evaluate(DEVICE, snapshot([cancelled]), config, NOW), []);
});

test('nothing fires for departures more than an hour ahead', () => {
  const tracker = new TriggerTracker();
  const far = departure(80, { cancelled: true });
  assert.deepEqual(tracker.evaluate(DEVICE, snapshot([far]), config, NOW), []);
});

test('disruption_started fires for new alerts only, one event per line', () => {
  const tracker = new TriggerTracker();
  // Not loaded yet: nothing learnt, nothing fired.
  assert.deepEqual(tracker.evaluate(DEVICE, snapshot([], [], false), config, NOW), []);
  // First read: the alerts already in force are learnt silently.
  assert.deepEqual(tracker.evaluate(DEVICE, snapshot([], [alert('a')]), config, NOW), []);
  const events = tracker.evaluate(
    DEVICE,
    snapshot([], [alert('a'), alert('b', ['M2', '52'])]),
    config,
    NOW,
  );
  assert.deepEqual(
    events.map((e) => [e.key, e.data.line, e.data.title]),
    [
      [TRIGGERS.DISRUPTION_STARTED, 'M2', 'Travaux b'],
      [TRIGGERS.DISRUPTION_STARTED, '52', 'Travaux b'],
    ],
  );
  assert.equal(events[0].data.url, 'https://letec.be/x');
});

test('forget drops what was learnt about a device', () => {
  const tracker = new TriggerTracker();
  tracker.evaluate(DEVICE, snapshot([departure(6)], [alert('a')]), config, NOW);
  tracker.forget(DEVICE);
  assert.equal(tracker.knownAlerts.has(DEVICE), false);
  assert.equal(tracker.lastMinutes.size, 0);
});
