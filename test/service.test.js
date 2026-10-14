import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TecService } from '../src/service.js';
import { FEATURES } from '../src/stopDevice.js';
import { NOW, alertsBody, dataDir, fakeFetch, jsonResponse } from './fixtures.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

async function startService({ config = {}, fetch = fakeFetch(), now = () => NOW, dir } = {}) {
  const gladys = createFakeGladys({ config: { stops: 'S1, S1:52, S2, NOPE1, bad!', ...config } });
  const service = new TecService({ gladys, dataDir: dir ?? (await dataDir()), fetch, now });
  await service.start();
  service.stop(); // no timers left running in the tests
  return { gladys, service, fetch };
}

const feature = (gladys, key, name) =>
  gladys.fake.lastState(`ext:test-integration:stop:${key}:${name}`);

test('a first start downloads the timetable, then publishes devices and states', async () => {
  const { gladys, fetch } = await startService();
  assert.ok(fetch.calls.some((call) => call.url.includes('opendata.tec-wl.be')));

  // Accepted by the fake Gladys: categories, types, units, external ids.
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    [
      'TEC CHARLEROI Gare Centrale - Quai 07',
      'TEC CHARLEROI Gare Centrale - Quai 07 (52)',
      'TEC GILLY Sart-Culpart (M)',
    ],
    'the unknown stop gets no device',
  );
  assert.equal(devices[0].features[0].name, 'Prochain départ', 'in the configured language');

  assert.equal(feature(gladys, 'S1', FEATURES.NEXT), 8);
  assert.equal(feature(gladys, 'S1', FEATURES.DELAY), 3);
  assert.equal(
    feature(gladys, 'S1', FEATURES.NEXT_TRIP),
    'M2 → ANDERLUES Monument · 08:03 (+3 min)',
  );
  assert.equal(feature(gladys, 'S1', FEATURES.DEPARTURES), 'M2 8 min (+3 min) · 52 08:05 supprimé');
  assert.equal(feature(gladys, 'S1', FEATURES.DISRUPTIONS), 1, 'the metro works');
  // Line filter: only the (cancelled) bus 52, and no metro alert.
  assert.equal(feature(gladys, 'S1__52', FEATURES.DISRUPTIONS), 0);
  assert.match(feature(gladys, 'S1__52', FEATURES.DEPARTURES), /^52 08:05 supprimé$/);
  // The next bus 52 that runs: tomorrow, 08:05.
  assert.equal(feature(gladys, 'S1__52', FEATURES.NEXT), 24 * 60 + 10);
});

test('the Configuration screen lists what was ignored', async () => {
  const { gladys } = await startService();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /bad!, NOPE1/);
  assert.ok(gladys.fake.connectionStatus.message.de);
  assert.ok(gladys.fake.connectionStatus.message.es);
});

test('without stops, the timetable still loads (for the stop search)', async () => {
  const { gladys, service } = await startService({ config: { stops: '' } });
  assert.ok(service.timetable);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Ajoutez les arrêts/);
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('without a key, the cloud badge says the real-time is slow', async () => {
  const { gladys } = await startService();
  const [entry] = gladys.fake.transports;
  assert.equal(entry.transport, 'cloud');
  assert.equal(entry.degraded, true);
  assert.match(entry.message.en, /20 minutes/);
});

test('with a key, the badge is nominal, and a refused key is reported', async () => {
  const { gladys } = await startService({ config: { api_key: 'secret' } });
  assert.equal(gladys.fake.transports[0].degraded, undefined);

  const refused = await startService({
    config: { api_key: 'wrong' },
    fetch: fakeFetch({ 'trip-update': jsonResponse({}, 401), alert: jsonResponse({}, 401) }),
  });
  assert.equal(refused.gladys.fake.connectionStatus.connected, false);
  assert.match(refused.gladys.fake.connectionStatus.message.en, /refused the API key/);
  // The timetable still works.
  assert.equal(feature(refused.gladys, 'S1', FEATURES.NEXT), 5);
});

test('a restart reuses the cached timetable without downloading again', async () => {
  const dir = await dataDir();
  await startService({ dir });
  const fetch = fakeFetch();
  const { gladys } = await startService({ dir, fetch });
  assert.ok(!fetch.calls.some((call) => call.url.includes('opendata.tec-wl.be')));
  assert.equal(feature(gladys, 'S1', FEATURES.NEXT), 8);
});

test('a new stop in the configuration re-indexes the archive on disk', async () => {
  const dir = await dataDir({ withArchive: true });
  const fetch = fakeFetch();
  const { gladys, service } = await startService({ dir, fetch, config: { stops: 'S1' } });
  assert.ok(!fetch.calls.some((call) => call.url.includes('opendata.tec-wl.be')), 'archive reused');
  await service.reconfigure({ stops: 'S1, S2', language: 'en' });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.equal(gladys.fake.discoveredDevices[1].features[0].name, 'Next departure');
  assert.ok(service.timetable.covers(['S1', 'S2']));
});

test('a failed timetable download is reported, then retried', async () => {
  let fail = true;
  const fetch = fakeFetch({ gtfs: () => (fail ? jsonResponse({}, 503) : undefined) });
  const { gladys, service } = await startService({ fetch });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 503/);
  fail = false;
  await service.loadAndRefresh();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(feature(gladys, 'S1', FEATURES.NEXT), 8);
});

test('scene events fired by the loop only carry declared keys', async () => {
  let now = NOW;
  let alertIds = ['works-m2'];
  const fetch = fakeFetch({ alert: () => jsonResponse(alertsBody({ ids: alertIds })) });
  const { gladys, service } = await startService({
    config: { api_key: 'k', stops: 'S1' },
    fetch,
    now: () => now,
  });
  // Two minutes later the metro (08:03) is 6 minutes away: marks 7 and 6.
  now += 2 * 60_000;
  alertIds = ['works-m2', 'strike'];
  await service.tick({ forceRealtime: true });
  const keys = gladys.fake.sceneEvents.map((event) => event.key);
  assert.ok(keys.includes('departure_soon'));
  assert.ok(keys.includes('departure_cancelled'));
  assert.ok(keys.includes('disruption_started'));
  for (const { key, data } of gladys.fake.sceneEvents) {
    const trigger = manifest.scene_triggers.find((entry) => entry.key === key);
    assert.ok(trigger, `${key} is declared`);
    const declared = [...trigger.fields, ...trigger.variables].map((entry) => entry.key);
    for (const [name, value] of Object.entries(data)) {
      assert.ok(declared.includes(name), `${key}.${name} is declared`);
      assert.ok(value === null || typeof value !== 'object', `${key}.${name} is a primitive`);
    }
  }
});

test('the widgets are nudged only when the departures change', async () => {
  const { service } = await startService();
  let nudges = 0;
  service.onChange = () => (nudges += 1);
  await service.tick();
  assert.equal(nudges, 0, 'nothing changed since the start');
  service.now = () => NOW + 60_000;
  await service.tick();
  assert.equal(nudges, 1);
});

test('the data directory holds the archive and the index only', async () => {
  const dir = await dataDir();
  await startService({ dir });
  const index = JSON.parse(await readFile(join(dir, 'timetable.json'), 'utf8'));
  assert.equal(index.version, '"v1"');
  assert.deepEqual(Object.keys(index.data.departures).sort(), ['NOPE1', 'S1', 'S2']);
});
