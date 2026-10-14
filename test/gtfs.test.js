import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { Readable } from 'node:stream';
import { openZipEntry, readZipEntries } from '../src/gtfs/zip.js';
import { parseCsvLine, readCsv } from '../src/gtfs/csv.js';
import { Timetable, buildTimetable, normalizeText, routeBase } from '../src/gtfs/timetable.js';
import { NOW, TODAY, dataDir, gtfsZip, makeZip } from './fixtures.js';

async function zipFile(buffer) {
  const path = join(await dataDir(), 'test.zip');
  await writeFile(path, buffer);
  return path;
}

async function fixtureTimetable(stops = ['S1']) {
  return new Timetable(await buildTimetable(await zipFile(gtfsZip()), stops));
}

test('the ZIP reader streams deflated and stored entries', async () => {
  for (const store of [false, true]) {
    const path = await zipFile(
      makeZip({ 'a.txt': 'hello', 'dir/b.txt': 'é'.repeat(5000) }, { store }),
    );
    const entries = await readZipEntries(path);
    assert.deepEqual([...entries.keys()], ['a.txt', 'b.txt'], 'indexed by base name');
    assert.equal(await text(await openZipEntry(path, entries.get('a.txt'))), 'hello');
    assert.equal(await text(await openZipEntry(path, entries.get('b.txt'))), 'é'.repeat(5000));
  }
});

test('the ZIP reader refuses a file that is not an archive', async () => {
  const path = await zipFile(Buffer.from('not a zip at all, sorry'));
  await assert.rejects(readZipEntries(path), /Not a ZIP archive/);
});

test('the CSV parser handles quotes, escaped quotes and commas', () => {
  assert.deepEqual(parseCsvLine('a,b,,c'), ['a', 'b', '', 'c']);
  assert.deepEqual(parseCsvLine('"x, y","say ""hi""",z'), ['x, y', 'say "hi"', 'z']);
});

test('the CSV reader strips the BOM of the header and skips blank lines', async () => {
  let columns;
  const rows = [];
  for await (const row of readCsv(Readable.from(['﻿id,name\r\n1,a\r\n\r\n2,b\r\n']), (c) => {
    columns = c;
  })) {
    rows.push(row);
  }
  assert.deepEqual(columns, { id: 0, name: 1 });
  assert.deepEqual(rows, [
    ['1', 'a'],
    ['2', 'b'],
  ]);
});

test('the route base drops the numbered suffix the real-time ids change', () => {
  assert.equal(routeBase('C00M2-23368'), 'C00M2');
  assert.equal(routeBase('X'), 'X');
});

test('the timetable keeps the departures of the monitored stops only', async () => {
  const data = await buildTimetable(await zipFile(gtfsZip()), ['S1']);
  assert.equal(data.feedVersion, '20261013');
  assert.deepEqual(Object.keys(data.departures), ['S1']);
  // T5 ENDS at S1: an arrival, not a departure.
  assert.deepEqual(data.departures.S1.map(([trip]) => trip).sort(), ['T1', 'T2', 'T3', 'T4']);
  assert.equal(data.stops.length, 4, 'stations are not stops');
});

test('a stop knows the lines serving it and its position', async () => {
  const timetable = await fixtureTimetable();
  const stop = timetable.stop('S1');
  assert.equal(stop.name, 'CHARLEROI Gare Centrale - Quai 07');
  assert.deepEqual(stop.lines, ['52', 'M2']);
  assert.equal(stop.latitude, 50.405505);
  assert.equal(timetable.stop('nope'), null);
  assert.ok(timetable.covers(['S1']));
  assert.ok(!timetable.covers(['S1', 'S2']));
});

test('the stop search ignores case and accents, and matches the code', async () => {
  const timetable = await fixtureTimetable();
  assert.deepEqual(
    timetable.searchStops('charleroi gare').map((stop) => stop.id),
    ['S1'],
  );
  assert.deepEqual(
    timetable.searchStops('SART culpart').map((stop) => stop.id),
    ['S2'],
  );
  assert.deepEqual(
    timetable.searchStops('s4').map((stop) => stop.id),
    ['S4'],
  );
  assert.deepEqual(timetable.searchStops('   '), []);
  assert.equal(normalizeText('Gérompont  Église'), 'gerompont eglise');
});

test('the nearby stops come sorted by distance', async () => {
  const timetable = await fixtureTimetable();
  const [first, second] = timetable.nearbyStops(50.4055, 4.4369, 2);
  assert.equal(first.id, 'S1');
  assert.ok(first.meters < 10);
  assert.equal(second.id, 'S2');
});

test('scheduled departures follow the calendar, exceptions included', async () => {
  const timetable = await fixtureTimetable();
  const day = 24 * 60 * 60 * 1000;
  const lines = (from, span) =>
    timetable.scheduledDepartures('S1', from, from + span).map((d) => `${d.line}@${d.tripId}`);
  // A Wednesday: the WEEK trips, not the Sunday one.
  assert.deepEqual(lines(NOW, 3 * 60 * 60 * 1000), ['M2@T1', '52@T2']);
  // 11 November: holiday, Sunday service.
  const holiday = Date.UTC(2026, 10, 11, 6, 0);
  assert.deepEqual(lines(holiday, 4 * 60 * 60 * 1000), ['52@T4']);
  // A Saturday: nothing.
  assert.deepEqual(lines(NOW + 3 * day, 6 * 60 * 60 * 1000), []);
});

test('a departure after midnight belongs to the service day before', async () => {
  const timetable = await fixtureTimetable();
  // Thursday 15 October 00:00 -> 01:00 Brussels: the 24:30 trip of Wednesday.
  const from = Date.UTC(2026, 9, 14, 22, 0);
  const [late] = timetable.scheduledDepartures('S1', from, from + 60 * 60 * 1000);
  assert.equal(late.tripId, 'T3');
  assert.equal(late.date, TODAY);
  assert.equal(late.scheduled, Date.UTC(2026, 9, 14, 22, 30));
  assert.equal(late.destination, 'ANDERLUES Monument');
});

test('departures can be filtered by line, and routes found by name', async () => {
  const timetable = await fixtureTimetable();
  const departures = timetable.scheduledDepartures('S1', NOW, NOW + 3 * 60 * 60 * 1000, ['52']);
  assert.deepEqual(
    departures.map((d) => d.tripId),
    ['T2'],
  );
  assert.deepEqual(
    timetable.routesAt('S1', ['M2']).map((route) => route.base),
    ['C00M2'],
  );
  assert.deepEqual(
    timetable.routesNamed('m2').map((route) => route.id),
    ['C00M2-100'],
  );
});
