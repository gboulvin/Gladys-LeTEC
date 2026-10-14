// -----------------------------------------------------------------------------
// TEC timetable (GTFS static): indexing and queries.
//
// buildTimetable() reads the archive ONCE and keeps only what the integration
// needs: the routes, the service calendars, every stop (name, position, lines
// serving it, for the stop search) and the scheduled departures of the
// MONITORED stops. The result is a plain JSON object, cached on disk, wrapped
// by the Timetable class for the queries.
// -----------------------------------------------------------------------------

import { readCsv } from './csv.js';
import { openZipEntry, readZipEntries } from './zip.js';
import { addDays, parseGtfsTime, serviceDate, serviceDayStart, weekday } from '../time.js';

export const TIMETABLE_FORMAT = 2;

// GTFS route_type values of the network.
export const ROUTE_TYPES = { TRAM: 0, METRO: 1, BUS: 3 };

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

async function eachRecord(zipPath, entries, file, onRecord, { optional = false } = {}) {
  const entry = entries.get(file);
  if (!entry) {
    if (optional) {
      return;
    }
    throw new Error(`GTFS archive without ${file}`);
  }
  let columns = {};
  const stream = await openZipEntry(zipPath, entry);
  for await (const record of readCsv(stream, (header) => (columns = header))) {
    onRecord(record, columns);
  }
}

const field = (record, columns, name) => (record[columns[name]] ?? '').trim();

/** Static part of a route id: `C00M2-23368` -> `C00M2`. The real-time feed
 * carries another numbered suffix for the same line: match on this part. */
export function routeBase(routeId) {
  return String(routeId).split('-')[0];
}

/**
 * Index a GTFS archive.
 * @param {string} zipPath
 * @param {Iterable<string>} monitoredStopIds - stops whose departures are kept.
 * @returns {Promise<object>} serializable timetable data.
 */
export async function buildTimetable(zipPath, monitoredStopIds = []) {
  const monitored = new Set(monitoredStopIds);
  const entries = await readZipEntries(zipPath);

  let feedVersion = '';
  await eachRecord(
    zipPath,
    entries,
    'feed_info.txt',
    (record, columns) => {
      feedVersion =
        field(record, columns, 'feed_version') || field(record, columns, 'feed_start_date');
    },
    { optional: true },
  );

  const routes = [];
  const routeIndex = new Map();
  await eachRecord(zipPath, entries, 'routes.txt', (record, columns) => {
    const id = field(record, columns, 'route_id');
    routeIndex.set(id, routes.length);
    routes.push({
      id,
      base: routeBase(id),
      short: field(record, columns, 'route_short_name') || field(record, columns, 'route_id'),
      long: field(record, columns, 'route_long_name'),
      type: Number(field(record, columns, 'route_type') || ROUTE_TYPES.BUS),
      agency: field(record, columns, 'agency_id'),
    });
  });

  const services = [];
  const serviceIndex = new Map();
  const serviceOf = (id) => {
    if (!serviceIndex.has(id)) {
      serviceIndex.set(id, services.length);
      services.push({
        id,
        days: [0, 0, 0, 0, 0, 0, 0],
        start: '',
        end: '',
        added: [],
        removed: [],
      });
    }
    return services[serviceIndex.get(id)];
  };
  await eachRecord(
    zipPath,
    entries,
    'calendar.txt',
    (record, columns) => {
      const service = serviceOf(field(record, columns, 'service_id'));
      service.days = DAY_NAMES.map((day) => (field(record, columns, day) === '1' ? 1 : 0));
      service.start = field(record, columns, 'start_date');
      service.end = field(record, columns, 'end_date');
    },
    { optional: true },
  );
  await eachRecord(
    zipPath,
    entries,
    'calendar_dates.txt',
    (record, columns) => {
      const service = serviceOf(field(record, columns, 'service_id'));
      const date = field(record, columns, 'date');
      if (field(record, columns, 'exception_type') === '1') {
        service.added.push(date);
      } else {
        service.removed.push(date);
      }
    },
    { optional: true },
  );

  const stops = [];
  const stopIndex = new Map();
  await eachRecord(zipPath, entries, 'stops.txt', (record, columns) => {
    const type = field(record, columns, 'location_type');
    if (type !== '' && type !== '0') {
      return; // stations and entrances: departures happen at the stops
    }
    const id = field(record, columns, 'stop_id');
    stopIndex.set(id, stops.length);
    stops.push([
      id,
      field(record, columns, 'stop_name'),
      Number(field(record, columns, 'stop_lat')),
      Number(field(record, columns, 'stop_lon')),
      [],
    ]);
  });

  // Trips, by position: two typed arrays instead of one object per trip (the
  // network runs ~200 000 trips over the period of the archive).
  const tripPosition = new Map();
  const tripRoute = [];
  const tripService = [];
  await eachRecord(zipPath, entries, 'trips.txt', (record, columns) => {
    const route = routeIndex.get(field(record, columns, 'route_id'));
    const service = serviceIndex.get(field(record, columns, 'service_id'));
    if (route === undefined || service === undefined) {
      return;
    }
    tripPosition.set(field(record, columns, 'trip_id'), tripRoute.length);
    tripRoute.push(route);
    tripService.push(service);
  });
  const tripIds = [...tripPosition.keys()];
  const lastSequence = new Int32Array(tripRoute.length).fill(-1);
  const lastStop = new Int32Array(tripRoute.length).fill(-1);

  const stopRoutes = new Map();
  const collected = new Map([...monitored].map((id) => [id, []]));
  await eachRecord(zipPath, entries, 'stop_times.txt', (record, columns) => {
    const trip = tripPosition.get(record[columns.trip_id]);
    const stop = stopIndex.get(record[columns.stop_id]);
    if (trip === undefined || stop === undefined) {
      return;
    }
    const sequence = Number(record[columns.stop_sequence]);
    if (sequence > lastSequence[trip]) {
      lastSequence[trip] = sequence;
      lastStop[trip] = stop;
    }
    let routesAtStop = stopRoutes.get(stop);
    if (!routesAtStop) {
      routesAtStop = new Set();
      stopRoutes.set(stop, routesAtStop);
    }
    routesAtStop.add(tripRoute[trip]);

    const departures = collected.get(record[columns.stop_id]);
    if (departures && (record[columns.pickup_type] ?? '').trim() !== '1') {
      const seconds = parseGtfsTime(record[columns.departure_time] || record[columns.arrival_time]);
      if (seconds !== null) {
        departures.push([trip, seconds, sequence]);
      }
    }
  });

  for (const [stop, routeSet] of stopRoutes) {
    stops[stop][4] = [...routeSet];
  }

  // A row at the last stop of its trip is an arrival, not a departure.
  const departures = {};
  for (const [stopId, rows] of collected) {
    departures[stopId] = rows
      .filter(([trip, , sequence]) => sequence !== lastSequence[trip])
      .map(([trip, seconds, sequence]) => [
        tripIds[trip],
        tripService[trip],
        tripRoute[trip],
        seconds,
        sequence,
        lastStop[trip],
      ])
      .sort((a, b) => a[3] - b[3]);
  }

  return {
    format: TIMETABLE_FORMAT,
    feedVersion,
    monitored: [...monitored].sort(),
    builtAt: new Date().toISOString(),
    routes,
    services,
    stops,
    departures,
  };
}

/** Lower-case, accent-free text, for the stop search. */
export function normalizeText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const lineOrder = (a, b) => a.localeCompare(b, 'en', { numeric: true });

export class Timetable {
  /** @param {object} data - output of buildTimetable (or its JSON cache). */
  constructor(data) {
    this.data = data;
    this.stopIndex = new Map(data.stops.map((stop, index) => [stop[0], index]));
    this.serviceSets = data.services.map((service) => ({
      ...service,
      addedSet: new Set(service.added),
      removedSet: new Set(service.removed),
    }));
    this.searchNames = data.stops.map(
      (stop) => `${normalizeText(stop[1])} ${stop[0].toLowerCase()}`,
    );
  }

  get feedVersion() {
    return this.data.feedVersion;
  }

  /** Whether the departures of these stops were indexed. */
  covers(stopIds) {
    return stopIds.every((id) => this.data.departures[id] !== undefined);
  }

  /** `{ id, name, latitude, longitude, lines }` of a stop, or null. */
  stop(stopId) {
    const index = this.stopIndex.get(stopId);
    if (index === undefined) {
      return null;
    }
    const [id, name, latitude, longitude, routes] = this.data.stops[index];
    const lines = [...new Set(routes.map((route) => this.data.routes[route].short))].sort(
      lineOrder,
    );
    return { id, name, latitude, longitude, lines };
  }

  /** Routes serving a stop, restricted to the given lines (all when empty). */
  routesAt(stopId, lines = []) {
    const index = this.stopIndex.get(stopId);
    if (index === undefined) {
      return [];
    }
    return this.data.stops[index][4]
      .map((route) => this.data.routes[route])
      .filter((route) => lines.length === 0 || lines.includes(route.short.toUpperCase()));
  }

  /** Every route whose public name is `line` (several zones reuse numbers). */
  routesNamed(line) {
    const wanted = String(line).trim().toUpperCase();
    return this.data.routes.filter((route) => route.short.toUpperCase() === wanted);
  }

  /** Stops whose name (or id) contains every word of the query. */
  searchStops(query, limit = 10) {
    const words = normalizeText(query).split(' ').filter(Boolean);
    if (words.length === 0) {
      return [];
    }
    const results = [];
    for (let index = 0; index < this.searchNames.length && results.length < limit; index += 1) {
      const name = this.searchNames[index];
      if (words.every((word) => name.includes(word))) {
        results.push(this.stop(this.data.stops[index][0]));
      }
    }
    return results;
  }

  /** The stops nearest to a position, with their distance in meters. */
  nearbyStops(latitude, longitude, limit = 10) {
    return this.data.stops
      .map((stop) => ({ id: stop[0], km: distanceKm(latitude, longitude, stop[2], stop[3]) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, limit)
      .map(({ id, km }) => ({ ...this.stop(id), meters: Math.round(km * 1000) }));
  }

  isServiceActive(serviceIndex, date) {
    const service = this.serviceSets[serviceIndex];
    if (!service) {
      return false;
    }
    if (service.removedSet.has(date)) {
      return false;
    }
    if (service.addedSet.has(date)) {
      return true;
    }
    return (
      service.start !== '' &&
      date >= service.start &&
      date <= service.end &&
      service.days[weekday(date)] === 1
    );
  }

  /**
   * Scheduled departures of a stop between two instants, sorted by time.
   * @param {string} stopId
   * @param {number} fromMs
   * @param {number} toMs
   * @param {string[]} lines - keep these lines only (all when empty)
   */
  scheduledDepartures(stopId, fromMs, toMs, lines = []) {
    const rows = this.data.departures[stopId];
    if (!rows) {
      return [];
    }
    // A service day starts at its noon minus 12 h and runs past midnight
    // (times over 24:00:00): yesterday's late trips may still be ahead.
    const results = [];
    const firstDate = addDays(serviceDate(fromMs), -1);
    const lastDate = serviceDate(toMs);
    for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
      const dayStart = serviceDayStart(date);
      for (const [tripId, service, routeIndex, seconds, sequence, lastStop] of rows) {
        const scheduled = dayStart + seconds * 1000;
        if (scheduled < fromMs || scheduled > toMs) {
          continue;
        }
        const route = this.data.routes[routeIndex];
        if (lines.length > 0 && !lines.includes(route.short.toUpperCase())) {
          continue;
        }
        if (!this.isServiceActive(service, date)) {
          continue;
        }
        results.push({
          tripId,
          date,
          sequence,
          scheduled,
          line: route.short,
          routeType: route.type,
          routeBase: route.base,
          destination: this.data.stops[lastStop]?.[1] ?? '',
        });
      }
    }
    return results.sort((a, b) => a.scheduled - b.scheduled);
  }
}
