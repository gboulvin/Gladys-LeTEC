// -----------------------------------------------------------------------------
// Dashboard widgets, scene actions and Configuration-screen actions, run
// against a service started on the fixture timetable and the SDK fake Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TecService } from '../src/service.js';
import {
  LINE_DISRUPTIONS_WIDGET,
  NEXT_DEPARTURES_WIDGET,
  WIDGETS,
  refreshWidgets,
} from '../src/widgets.js';
import { SCENE_ACTIONS, parseLines } from '../src/scenes.js';
import { ACTIONS } from '../src/actions.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, dataDir, fakeFetch } from './fixtures.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

async function started(config = {}, fetch = fakeFetch()) {
  const gladys = createFakeGladys({
    config: { stops: 'S1, S2:52', ...config },
    houses: [
      { id: 'h1', name: 'Maison', selector: 'maison', latitude: 50.4056, longitude: 4.4369 },
      { id: 'h2', name: 'Chalet', selector: 'chalet', latitude: null, longitude: null },
    ],
  });
  const service = new TecService({ gladys, dataDir: await dataDir(), fetch, now: () => NOW });
  await service.start();
  service.stop();
  return { gladys, service };
}

const { gladys, service } = await started();
const S1 = service.deviceId(service.entries[0]);
const S2 = service.deviceId(service.entries[1]);
const outputsOf = (key) =>
  manifest.scene_actions.find((action) => action.key === key).outputs.map((output) => output.key);

test('the departure board is rendered exactly as sent, in every language', async () => {
  for (const language of LANGUAGES) {
    const content = await WIDGETS[NEXT_DEPARTURES_WIDGET].get(gladys, {
      settings: { device: S1 },
      language,
      service,
    });
    assert.deepEqual(validateWidgetContent(content), [], language);
  }
});

test('the board lists the departures and binds its tiles to published features', async () => {
  const content = await WIDGETS[NEXT_DEPARTURES_WIDGET].get(gladys, {
    settings: { device: S1 },
    language: 'fr',
    service,
  });
  const list = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((item) => [item.title, item.badge.text, item.badge.color]),
    [
      ['M2 → ANDERLUES Monument', '8 min', 'info'],
      ['52 → MONS Gare', 'supprimé', 'danger'],
    ],
  );
  const features = new Set(
    gladys.fake.discoveredDevices.flatMap((device) => device.features.map((f) => f.external_id)),
  );
  for (const tile of content.components.filter((c) => c.device_feature)) {
    assert.ok(features.has(tile.device_feature), tile.device_feature);
  }
});

test('the board explains a missing or unknown stop, and an empty list', async () => {
  for (const settings of [{}, { device: 'ext:test-integration:stop:gone' }]) {
    const content = await WIDGETS[NEXT_DEPARTURES_WIDGET].get(gladys, {
      settings,
      language: 'en',
      service,
    });
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].type, 'text');
  }
  const empty = await WIDGETS[NEXT_DEPARTURES_WIDGET].get(gladys, {
    settings: { device: S2 },
    language: 'en',
    service,
  });
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.ok(empty.components.some((c) => c.type === 'text' && /No departure/.test(c.text)));
});

test('the refresh button forces a real-time read and answers a toast', async () => {
  const message = await WIDGETS[NEXT_DEPARTURES_WIDGET].action(gladys, {
    actionKey: 'refresh',
    params: {},
    settings: { device: S1 },
    service,
  });
  assert.ok(message.en.length <= 200);
  assert.ok(message.de && message.es && message.fr);
  await assert.rejects(
    WIDGETS[NEXT_DEPARTURES_WIDGET].action(gladys, { actionKey: 'nope', service }),
    /Unknown widget action/,
  );
});

test('the disruptions widget lists the alerts of the monitored lines', async () => {
  const content = await WIDGETS[LINE_DISRUPTIONS_WIDGET].get(gladys, {
    settings: {},
    language: 'en',
    service,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const [item] = content.components[0].items;
  assert.equal(item.title, 'Charleroi | Works | Line M2 (works-m2)');
  assert.equal(item.badge.text, 'Detour');
  assert.equal(item.links[0].url, 'https://letec.be/Traffic/Detail/works-m2');

  const filtered = await WIDGETS[LINE_DISRUPTIONS_WIDGET].get(gladys, {
    settings: { line: '52' },
    language: 'fr',
    service,
  });
  assert.deepEqual(validateWidgetContent(filtered), []);
  assert.equal(filtered.components[0].text, 'Aucune perturbation sur vos lignes.');
});

test('refreshWidgets nudges every widget', () => {
  const fresh = createFakeGladys();
  refreshWidgets(fresh);
  assert.deepEqual(fresh.fake.widgetRefreshes, Object.keys(WIDGETS));
});

test('get_next_departure returns the declared outputs', async () => {
  const outputs = await SCENE_ACTIONS.get_next_departure(gladys, {
    fields: { device: S1 },
    service,
  });
  assert.equal(outputs.found, true);
  assert.equal(outputs.line, 'M2');
  assert.equal(outputs.minutes, 8);
  assert.equal(outputs.delay_minutes, 3);
  assert.equal(outputs.expected_time, '08:03');
  assert.equal(outputs.scheduled_time, '08:00');
  for (const key of Object.keys(outputs)) {
    assert.ok(outputsOf('get_next_departure').includes(key), `output ${key} is declared`);
  }
});

test('get_next_departure takes another line filter, and reports an unknown stop', async () => {
  const bus = await SCENE_ACTIONS.get_next_departure(gladys, {
    fields: { device: S1, line: '52' },
    service,
  });
  assert.equal(bus.line, '52');
  assert.equal(bus.minutes, 24 * 60 + 10, 'today is cancelled: tomorrow');
  const unknown = await SCENE_ACTIONS.get_next_departure(gladys, {
    fields: { device: 'ext:test-integration:stop:gone' },
    service,
  });
  assert.equal(unknown.found, false);
});

test('get_line_disruptions says whether a line is disrupted', async () => {
  const metro = await SCENE_ACTIONS.get_line_disruptions(gladys, {
    fields: { line: 'm2' },
    service,
  });
  assert.deepEqual(metro, {
    disrupted: true,
    count: 1,
    summary: 'Charleroi | Travaux | Ligne M2 (works-m2)',
  });
  const bus = await SCENE_ACTIONS.get_line_disruptions(gladys, {
    fields: { line: '52', device: S1 },
    service,
  });
  assert.equal(bus.disrupted, false);
  for (const key of Object.keys(metro)) {
    assert.ok(outputsOf('get_line_disruptions').includes(key));
  }
});

test('parseLines accepts the usual separators', () => {
  assert.deepEqual(parseLines('52+m4, T1 | 1/'), ['52', 'M4', 'T1', '1/']);
  assert.deepEqual(parseLines(undefined), []);
});

test('the stop search gives copyable codes and the lines', async () => {
  const message = await ACTIONS.search_stop(gladys, { fields: { query: 'charleroi' }, service });
  assert.match(message.fr, /• S1 — CHARLEROI Gare Centrale - Quai 07 — 52, M2/);
  assert.match(
    (await ACTIONS.search_stop(gladys, { fields: { query: 'zzz' }, service })).en,
    /No stop matches/,
  );
  assert.match((await ACTIONS.search_stop(gladys, { fields: {}, service })).en, /Type part/);
});

test('the nearby stops use the located houses only', async () => {
  const message = await ACTIONS.nearby_stops(gladys, { fields: {}, service });
  assert.match(
    message.en,
    /^Stops near Maison:\n• S1 — CHARLEROI Gare Centrale - Quai 07 \(\d+ m\)/,
  );
  assert.doesNotMatch(message.en, /Chalet/);
  gladys.fake.houses = [];
  assert.match((await ACTIONS.nearby_stops(gladys, { fields: {}, service })).en, /No house/);
});

test('the connection test reads the real-time feed live', async () => {
  const message = await ACTIONS.test_connection(gladys, { fields: {}, service });
  assert.match(
    message.en,
    /Timetable 20261013 loaded \(4 stops\)\. Real-time: 2 trips tracked, 1 alerts/,
  );
  assert.ok(message.de && message.es);
});

test('the timetable refresh says whether it changed', async () => {
  let unchanged = false;
  const fetch = fakeFetch({
    gtfs: () => (unchanged ? new Response(null, { status: 304 }) : undefined),
  });
  const { gladys: other, service: fresh } = await started({}, fetch);
  unchanged = true;
  const message = await ACTIONS.refresh_timetable(other, { fields: {}, service: fresh });
  assert.match(message.en, /already up to date \(20261013\)/);
  const conditional = fetch.calls.filter((call) => call.url.includes('opendata')).at(-1);
  assert.equal(conditional.headers['If-None-Match'], '"v1"');
});

test('the actions wait for the timetable when it is not loaded yet', async () => {
  const fresh = createFakeGladys({ config: {} });
  const idle = new TecService({ gladys: fresh, dataDir: await dataDir(), fetch: fakeFetch() });
  idle.loading = Promise.resolve(); // pretend a load is running
  const message = await ACTIONS.search_stop(fresh, { fields: { query: 'x' }, service: idle });
  assert.match(message.en, /still loading/);
});
