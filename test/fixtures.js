// -----------------------------------------------------------------------------
// Test fixtures: a tiny TEC-like GTFS archive, built in memory, and real-time
// feeds in the JSON form of the Belgian Mobility portal. Tests never touch
// the network.
// -----------------------------------------------------------------------------

import { crc32, deflateRawSync } from 'node:zlib';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Build a ZIP archive (deflated entries, or stored with `store: true`). */
export function makeZip(files, { store = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const compressed = store ? data : deflateRawSync(data);
    const nameBuffer = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// Wednesday 14 October 2026, 07:55 in Brussels (CEST, UTC+2).
export const NOW = Date.UTC(2026, 9, 14, 5, 55);
export const TODAY = '20261014';

// Stops: S1 is served by the metro M2 and the bus 52, both toward other stops.
export const GTFS_FILES = {
  'agency.txt':
    'agency_id,agency_name,agency_url,agency_timezone\n"C","TEC Charleroi",http://www.letec.be,Europe/Brussels\n',
  'feed_info.txt': 'feed_publisher_name,feed_lang,feed_start_date\nOTW,fr,20261013\n',
  'routes.txt':
    '﻿route_id,agency_id,route_short_name,route_long_name,route_type\n' +
    'C00M2-100,"C",M2,"Gare Centrale - Anderlues (Métro)",1\n' +
    'C0052-200,"C",52,"Charleroi - Mons",3\n',
  'calendar.txt':
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
    'WEEK,1,1,1,1,1,0,0,20260101,20261231\n' +
    'SUN,0,0,0,0,0,0,1,20260101,20261231\n',
  // 11 November (a Wednesday) is a holiday: Sunday service.
  'calendar_dates.txt': 'service_id,date,exception_type\nWEEK,20261111,2\nSUN,20261111,1\n',
  'stops.txt':
    'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type\n' +
    'S1,,"CHARLEROI Gare Centrale - Quai 07",,  50.405505,   4.436939,1,,0\n' +
    'S2,,"GILLY Sart-Culpart (M)",,50.42,4.47,1,,0\n' +
    'S3,,"ANDERLUES Monument",,50.40,4.27,1,,0\n' +
    'S4,,"MONS Gare",,50.45,3.94,1,,0\n' +
    'ST,,"A station",,50.0,4.0,1,,1\n',
  'trips.txt':
    'route_id,service_id,trip_id,trip_short_name,direction_id,block_id,shape_id\n' +
    'C00M2-100,WEEK,T1,1,0,,\n' +
    'C0052-200,WEEK,T2,2,0,,\n' +
    'C00M2-100,WEEK,T3,3,0,,\n' +
    'C0052-200,SUN,T4,4,0,,\n' +
    'C00M2-100,WEEK,T5,5,0,,\n',
  'stop_times.txt':
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n' +
    'T1,08:00:00,08:00:00,S1,1,0,0\n' +
    'T1,08:10:00,08:10:00,S2,2,0,0\n' +
    'T1,08:20:00,08:20:00,S3,3,0,1\n' +
    'T2,08:05:00,08:05:00,S1,1,0,0\n' +
    'T2,08:30:00,08:30:00,S4,2,0,1\n' +
    // After midnight: 00:30 on the next calendar day, WEEK service of the day before.
    'T3,24:30:00,24:30:00,S1,1,0,0\n' +
    'T3,24:50:00,24:50:00,S3,2,0,1\n' +
    'T4,09:00:00,09:00:00,S1,1,0,0\n' +
    'T4,09:30:00,09:30:00,S4,2,0,1\n' +
    // T5 ends at S1: an arrival, never a departure there.
    'T5,07:40:00,07:40:00,S3,1,0,0\n' +
    'T5,07:58:00,07:58:00,S1,2,0,1\n',
};

export function gtfsZip(options) {
  return makeZip(GTFS_FILES, options);
}

/** A fresh data directory, optionally holding the archive already. */
export async function dataDir({ withArchive = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tec-test-'));
  if (withArchive) {
    await writeFile(join(dir, 'tec-gtfs.zip'), gtfsZip());
    await writeFile(join(dir, 'tec-gtfs.json'), JSON.stringify({ version: 'fixture-v1' }));
  }
  return dir;
}

const seconds = (ms) => Math.floor(ms / 1000);
// 08:00 Brussels on TODAY.
export const T1_SCHEDULED = Date.UTC(2026, 9, 14, 6, 0);

/** A trip updates feed: T1 three minutes late at S1, T2 cancelled. */
export function tripUpdatesBody({ t1Delay = 180, cancelT2 = true } = {}) {
  return {
    header: {
      gtfsRealtimeVersion: '1.0',
      timestamp: { low: seconds(NOW), high: 0, unsigned: true },
    },
    entity: [
      {
        id: 'rt:tec:T1',
        tripUpdate: {
          trip: {
            tripId: 'gt:tec:T1',
            startDate: TODAY,
            routeId: 'gr:tec:C00M2-999',
            scheduleRelationship: 0,
          },
          stopTimeUpdate: [
            {
              stopSequence: 1,
              stopId: 'gs:tec:S1',
              departure: { time: seconds(T1_SCHEDULED) + t1Delay, delay: t1Delay },
              scheduleRelationship: 0,
            },
          ],
          delay: t1Delay,
        },
      },
      {
        id: 'rt:tec:T2',
        tripUpdate: {
          trip: {
            tripId: 'gt:tec:T2',
            startDate: TODAY,
            routeId: 'gr:tec:C0052-999',
            scheduleRelationship: cancelT2 ? 3 : 0,
          },
          stopTimeUpdate: [],
        },
      },
    ],
  };
}

/** A service alerts feed: works on the M2 (route id with another suffix). */
export function alertsBody({ ids = ['works-m2'] } = {}) {
  return {
    header: { gtfsRealtimeVersion: '1.0', timestamp: seconds(NOW) },
    entity: ids.map((id) => ({
      id: `rs:tec:${id}`,
      alert: {
        activePeriod: [{ start: seconds(NOW) - 3600, end: 7258114800 }],
        informedEntity: [{ agencyId: 'tec', routeId: 'gr:tec:C00M2-555', routeType: 1 }],
        cause: 10,
        effect: 4,
        url: { translation: [{ language: 'fr', text: `https://letec.be/Traffic/Detail/${id}` }] },
        headerText: {
          translation: [
            { language: 'fr', text: `Charleroi | Travaux | Ligne M2 (${id})` },
            { language: 'en', text: `Charleroi | Works | Line M2 (${id})` },
          ],
        },
        descriptionText: {
          translation: [{ language: 'fr', text: 'Le métro est dévié.' }],
        },
      },
    })),
  };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(),
  json: async () => body,
});

/**
 * A fetch serving the archive and the real-time feeds; records the calls.
 * `routes` overrides the answer per feed ('trip-update', 'alert', 'gtfs').
 */
export function fakeFetch(routes = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers ?? {} });
    // A route function resolving undefined falls back to the default answer.
    const answer = (name, fallback) =>
      (typeof routes[name] === 'function' ? routes[name](options) : routes[name]) ?? fallback();
    if (String(url).includes('trip-update')) {
      return answer('trip-update', () => jsonResponse(tripUpdatesBody()));
    }
    if (String(url).includes('/alert')) {
      return answer('alert', () => jsonResponse(alertsBody()));
    }
    return answer('gtfs', () => new Response(gtfsZip(), { headers: { etag: '"v1"' } }));
  };
  fetch.calls = calls;
  return fetch;
}

export { jsonResponse };
