import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  alertsForStop,
  applyRealtime,
  computeDepartures,
  nextScheduledDeparture,
} from '../src/departures.js';
import { Timetable, buildTimetable } from '../src/gtfs/timetable.js';
import { cancelledTrips, parseAlerts, parseTripUpdates } from '../src/realtime.js';
import { describeDeparture, summarizeDepartures } from '../src/format.js';
import {
  NOW,
  T1_SCHEDULED,
  TODAY,
  alertsBody,
  dataDir,
  gtfsZip,
  tripUpdatesBody,
} from './fixtures.js';

const path = join(await dataDir(), 'gtfs.zip');
await writeFile(path, gtfsZip());
const timetable = new Timetable(await buildTimetable(path, ['S1']));
const HOUR = 60 * 60 * 1000;

const departure = {
  tripId: 'X',
  date: TODAY,
  sequence: 3,
  stopId: 'S1',
  scheduled: T1_SCHEDULED,
};
const updates = (update) =>
  new Map([['X', { startDate: TODAY, canceled: false, delay: null, updates: [], ...update }]]);

test('no trip update: the timetable time, flagged as not real-time', () => {
  assert.deepEqual(applyRealtime(departure, new Map()), {
    expected: T1_SCHEDULED,
    realtime: false,
    cancelled: false,
  });
  assert.equal(applyRealtime(departure, null).realtime, false);
});

test('an update at the stop gives the expected time', () => {
  const result = applyRealtime(
    departure,
    updates({
      updates: [
        { sequence: 3, stopId: 'S1', time: T1_SCHEDULED / 1000 + 120, delay: 120, skipped: false },
      ],
    }),
  );
  assert.equal(result.expected, T1_SCHEDULED + 120_000);
  assert.equal(result.realtime, true);
});

test('the delay of the last stop before carries over (GTFS-RT propagation)', () => {
  const result = applyRealtime(
    departure,
    updates({
      delay: 999,
      updates: [
        { sequence: 1, stopId: 'A', time: null, delay: 60, skipped: false },
        { sequence: 2, stopId: 'B', time: null, delay: 240, skipped: false },
        { sequence: 5, stopId: 'C', time: null, delay: 600, skipped: false },
      ],
    }),
  );
  assert.equal(result.expected, T1_SCHEDULED + 240_000);
});

test('without stop update, the trip delay applies', () => {
  assert.equal(applyRealtime(departure, updates({ delay: -60 })).expected, T1_SCHEDULED - 60_000);
});

test('a cancelled trip or a skipped stop cancels the departure', () => {
  assert.equal(applyRealtime(departure, updates({ canceled: true })).cancelled, true);
  const skipped = updates({
    updates: [{ sequence: 3, stopId: 'S1', time: null, delay: null, skipped: true }],
  });
  assert.equal(applyRealtime(departure, skipped).cancelled, true);
});

test('an update of the same trip on another day is ignored', () => {
  assert.equal(
    applyRealtime(departure, updates({ startDate: '20261015', delay: 600 })).realtime,
    false,
  );
});

test('the next departures mix timetable and real-time', () => {
  const departures = computeDepartures({
    timetable,
    tripUpdates: parseTripUpdates(tripUpdatesBody()),
    stopId: 'S1',
    now: NOW,
    horizonMs: HOUR,
  });
  assert.deepEqual(
    departures.map((d) => [d.line, d.minutes, d.delayMinutes, d.realtime, d.cancelled]),
    [
      ['52', 10, 0, true, true], // 08:05, cancelled: listed, flagged
      ['M2', 8, 3, true, false], // 08:00 + 3 min
    ].sort((a, b) => a[1] - b[1]),
  );
  const m2 = departures.find((d) => d.line === 'M2');
  assert.equal(m2.destination, 'ANDERLUES Monument');
  assert.equal(m2.key, `T1|${TODAY}`);
});

test('a late departure whose time passed is still ahead; a timetable one is gone', () => {
  const at = T1_SCHEDULED + 2 * 60_000; // 08:02: the metro is 3 minutes late
  const live = computeDepartures({
    timetable,
    tripUpdates: parseTripUpdates(tripUpdatesBody()),
    stopId: 'S1',
    now: at,
    horizonMs: HOUR,
  });
  assert.ok(live.some((d) => d.tripId === 'T1' && d.minutes === 1));
  const theoretical = computeDepartures({
    timetable,
    tripUpdates: null,
    stopId: 'S1',
    now: at,
    horizonMs: HOUR,
  });
  assert.ok(!theoretical.some((d) => d.tripId === 'T1'));
});

test('the line filter applies to the departures', () => {
  const departures = computeDepartures({
    timetable,
    tripUpdates: null,
    stopId: 'S1',
    lines: ['M2'],
    now: NOW,
    horizonMs: HOUR,
  });
  assert.deepEqual(
    departures.map((d) => d.line),
    ['M2'],
  );
});

test('at night, the next departure looks up to the next service', () => {
  const night = Date.UTC(2026, 9, 14, 23, 30); // Thursday 01:30, after the 24:30 metro
  const next = nextScheduledDeparture({ timetable, stopId: 'S1', now: night, fromMs: night });
  assert.equal(next.tripId, 'T1');
  assert.equal(next.date, '20261015');
  assert.equal(next.minutes, 6 * 60 + 30);
});

test('alerts are matched to a stop through its lines, whatever the route suffix', () => {
  const alerts = parseAlerts(alertsBody());
  const routes = timetable.routesAt('S1');
  const [alert] = alertsForStop(alerts, { stopId: 'S1', routes }, NOW);
  assert.deepEqual(alert.lines, ['M2']);
  // Only the bus 52 monitored: the metro works do not concern it.
  assert.deepEqual(
    alertsForStop(alerts, { stopId: 'S1', routes: timetable.routesAt('S1', ['52']) }, NOW),
    [],
  );
  // An alert on the stop itself.
  const onStop = [{ ...alerts[0], routeBases: [], stopIds: ['S1'] }];
  assert.equal(alertsForStop(onStop, { stopId: 'S1', routes: [] }, NOW).length, 1);
});

test('departure texts say the line, destination, time and delay', () => {
  const departures = computeDepartures({
    timetable,
    tripUpdates: parseTripUpdates(tripUpdatesBody()),
    stopId: 'S1',
    now: NOW,
    horizonMs: HOUR,
  });
  const m2 = departures.find((d) => d.line === 'M2');
  assert.equal(describeDeparture(m2, 'fr'), 'M2 → ANDERLUES Monument · 08:03 (+3 min)');
  assert.equal(describeDeparture(m2, 'en'), 'M2 → ANDERLUES Monument · 08:03 (+3 min)');
  assert.equal(summarizeDepartures(departures, 'fr'), 'M2 8 min (+3 min) · 52 08:05 supprimé');
  assert.equal(summarizeDepartures(departures, 'de'), 'M2 8 Min. (+3 Min.) · 52 08:05 fällt aus');
  const onTime = { ...m2, delayMinutes: 0, expected: m2.scheduled };
  assert.equal(describeDeparture(onTime, 'es'), 'M2 → ANDERLUES Monument · 08:00 (puntual)');
  const theoretical = { ...m2, realtime: false };
  assert.equal(describeDeparture(theoretical, 'en'), 'M2 → ANDERLUES Monument · 08:03');
});

test('a trip cancelled by a trip-level alert is a cancelled departure, not a disruption', () => {
  const body = {
    entity: [
      {
        id: 'rs:tec:cancel-t1',
        alert: {
          activePeriod: [{ start: NOW / 1000 - 60, end: NOW / 1000 + 86400 }],
          informedEntity: [
            {
              routeId: 'gr:tec:C00M2-555',
              trip: { tripId: 'gt:tec:T1', startDate: TODAY, scheduleRelationship: 3 },
            },
          ],
          effect: 1,
          headerText: { translation: [{ language: 'fr', text: 'Annulations' }] },
        },
      },
    ],
  };
  const alerts = parseAlerts(body);
  assert.equal(alerts[0].tripLevel, true);
  const cancelled = cancelledTrips(alerts);
  const departures = computeDepartures({
    timetable,
    tripUpdates: null,
    cancelled,
    stopId: 'S1',
    now: NOW,
    horizonMs: HOUR,
  });
  assert.equal(departures.find((d) => d.tripId === 'T1').cancelled, true);
  assert.deepEqual(
    alertsForStop(alerts, { stopId: 'S1', routes: timetable.routesAt('S1') }, NOW),
    [],
  );
  // Today's T1 skipped: the next metro is the one after midnight.
  const next = nextScheduledDeparture({
    timetable,
    stopId: 'S1',
    lines: ['M2'],
    now: NOW,
    fromMs: NOW,
    cancelled,
  });
  assert.equal(next.tripId, 'T3');
});
