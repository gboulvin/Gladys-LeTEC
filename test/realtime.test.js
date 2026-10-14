import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANONYMOUS_INTERVALS,
  BUDGETS,
  FEEDS,
  RealtimeClient,
  isAlertActive,
  parseAlerts,
  parseTripUpdates,
  stripPrefix,
  toNumber,
} from '../src/realtime.js';
import { NOW, TODAY, alertsBody, fakeFetch, jsonResponse, tripUpdatesBody } from './fixtures.js';

const clock = (start = NOW) => {
  const state = { now: start };
  return { now: () => state.now, advance: (ms) => (state.now += ms) };
};

test('real-time ids lose their feed prefix', () => {
  assert.equal(stripPrefix('gt:tec:55685419-H_2026'), '55685419-H_2026');
  assert.equal(stripPrefix('gs:tec:Ctrrpla2'), 'Ctrrpla2');
  assert.equal(stripPrefix('Ctrrpla2'), 'Ctrrpla2');
});

test('64-bit integers arrive as numbers, strings or { low, high }', () => {
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber({ low: 5, high: 1, unsigned: true }), 2 ** 32 + 5);
  assert.equal(toNumber(undefined), null);
});

test('trip updates are indexed by trip, with their stop updates', () => {
  const trips = parseTripUpdates(tripUpdatesBody());
  assert.deepEqual([...trips.keys()], ['T1', 'T2']);
  const t1 = trips.get('T1');
  assert.equal(t1.startDate, TODAY);
  assert.equal(t1.canceled, false);
  assert.equal(t1.updates[0].stopId, 'S1');
  assert.equal(t1.updates[0].delay, 180);
  assert.equal(trips.get('T2').canceled, true);
});

test('stop updates without data are dropped, skipped stops flagged', () => {
  const trips = parseTripUpdates({
    entity: [
      {
        tripUpdate: {
          trip: { tripId: 'gt:tec:X' },
          stopTimeUpdate: [
            { stopSequence: 1, stopId: 'gs:tec:A', scheduleRelationship: 2 },
            { stopSequence: 2, stopId: 'gs:tec:B', scheduleRelationship: 1 },
          ],
        },
      },
      { id: 'no trip update' },
    ],
  });
  assert.deepEqual(trips.get('X').updates, [
    { sequence: 2, stopId: 'B', time: null, delay: null, skipped: true },
  ]);
});

test('alerts keep their lines, translations and active periods', () => {
  const [alert] = parseAlerts(alertsBody());
  assert.equal(alert.id, 'rs:tec:works-m2');
  assert.deepEqual(alert.routeBases, ['C00M2']);
  assert.equal(alert.header.fr, 'Charleroi | Travaux | Ligne M2 (works-m2)');
  assert.equal(alert.url.fr, 'https://letec.be/Traffic/Detail/works-m2');
  assert.ok(isAlertActive(alert, NOW));
  assert.ok(!isAlertActive(alert, NOW - 2 * 3600 * 1000), 'not started yet');
  assert.ok(isAlertActive({ periods: [] }, NOW), 'no period: always');
});

test('without a key, the client spaces its reads to fit 100 requests a day', async () => {
  const time = clock();
  const fetch = fakeFetch();
  const client = new RealtimeClient({ fetch, now: time.now });
  const first = await client.get(FEEDS.TRIP_UPDATES, { refreshInterval: 60 });
  assert.equal(first.data.size, 2);
  time.advance(5 * 60 * 1000);
  const second = await client.get(FEEDS.TRIP_UPDATES, { refreshInterval: 60 });
  assert.equal(second, first, 'served from the cache');
  assert.equal(fetch.calls.length, 1);
  time.advance(ANONYMOUS_INTERVALS[FEEDS.TRIP_UPDATES] * 1000);
  await client.get(FEEDS.TRIP_UPDATES, { refreshInterval: 60 });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].headers['Ocp-Apim-Subscription-Key'], undefined);
  // A whole day of anonymous reads stays under the daily budget.
  const perDay =
    86400 / ANONYMOUS_INTERVALS[FEEDS.TRIP_UPDATES] + 86400 / ANONYMOUS_INTERVALS[FEEDS.ALERTS];
  assert.ok(perDay <= BUDGETS.anonymous.perDay);
});

test('with a key, the client sends it and follows the refresh interval', async () => {
  const time = clock();
  const fetch = fakeFetch();
  const client = new RealtimeClient({ fetch, now: time.now });
  client.setApiKey('secret');
  await client.get(FEEDS.TRIP_UPDATES, { refreshInterval: 60 });
  time.advance(60 * 1000);
  await client.get(FEEDS.TRIP_UPDATES, { refreshInterval: 60 });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].headers['Ocp-Apim-Subscription-Key'], 'secret');
  assert.equal(client.intervalFor(FEEDS.ALERTS, 60), 300, 'alerts every 5 minutes');
});

test('the daily budget is never exceeded, even when forced', async () => {
  const time = clock();
  const fetch = fakeFetch();
  const client = new RealtimeClient({ fetch, now: time.now });
  for (let i = 0; i < BUDGETS.anonymous.perDay + 10; i += 1) {
    await client.get(FEEDS.ALERTS, { force: true });
    time.advance(60 * 1000);
  }
  assert.equal(fetch.calls.length, BUDGETS.anonymous.perDay);
  assert.equal(client.canCall(), false);
  time.advance(24 * 60 * 60 * 1000);
  assert.equal(client.canCall(), true, 'the window slides');
});

test('a 429 pauses the reads and keeps the cached data', async () => {
  const time = clock();
  let status = 200;
  const fetch = fakeFetch({
    alert: () => (status === 200 ? jsonResponse(alertsBody()) : jsonResponse({}, status)),
  });
  const client = new RealtimeClient({ fetch, now: time.now });
  const cached = await client.get(FEEDS.ALERTS);
  status = 429;
  assert.equal(await client.get(FEEDS.ALERTS, { force: true }), cached);
  assert.equal(client.lastError.code, 'quota');
  assert.equal(client.canCall(), false, 'paused');
  time.advance(16 * 60 * 1000);
  assert.equal(client.canCall(), true);
});

test('a refused key throws, and a new key lifts the pause', async () => {
  const fetch = fakeFetch({ alert: () => jsonResponse({}, 401) });
  const client = new RealtimeClient({ fetch, now: () => NOW });
  client.setApiKey('wrong');
  await assert.rejects(client.get(FEEDS.ALERTS), (err) => err.code === 'unauthorized');
  assert.equal(client.canCall(), false);
  client.setApiKey('right');
  assert.equal(client.canCall(), true);
  assert.equal(client.lastError, null);
});

test('a network error is thrown and retried at the next interval only', async () => {
  const time = clock();
  const fetch = fakeFetch({
    'trip-update': () => {
      throw new Error('ECONNRESET');
    },
  });
  const client = new RealtimeClient({ fetch, now: time.now });
  await assert.rejects(client.get(FEEDS.TRIP_UPDATES), /ECONNRESET/);
  assert.equal(client.isDue(FEEDS.TRIP_UPDATES, 60), false, 'no hammering');
  time.advance(ANONYMOUS_INTERVALS[FEEDS.TRIP_UPDATES] * 1000);
  assert.equal(client.isDue(FEEDS.TRIP_UPDATES, 60), true);
});
