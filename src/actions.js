// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
//   search_stop        find the code of a stop from part of its name;
//   nearby_stops       the stops closest to the houses of Gladys;
//   test_connection    timetable + live read of the real-time feed;
//   refresh_timetable  download the latest timetable now.
//
// Each handler resolves the multi-language message shown under the button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { tAll } from './i18n.js';
import { FEEDS } from './realtime.js';

const logger = createLogger({ name: 'actions' });

const SEARCH_LIMIT = 12;
const NEARBY_PER_HOUSE = 6;
// Under the 120 s ack of the refresh_timetable action.
const REFRESH_WAIT_MS = 100_000;

function stopLine(stop) {
  const lines = stop.lines.length > 0 ? ` — ${stop.lines.join(', ')}` : '';
  const distance = stop.meters !== undefined ? ` (${stop.meters} m)` : '';
  return `• ${stop.id} — ${stop.name}${distance}${lines}`;
}

/** Start loading the timetable in the background when nothing runs yet. */
function notReady(service) {
  if (!service.loading) {
    service.loadAndRefresh().catch((err) => logger.error('Timetable loading failed', err));
  }
  return tAll('action_not_ready');
}

export const ACTIONS = {
  async search_stop(gladys, { fields, service }) {
    const query = String(fields.query ?? '').trim();
    if (!query) {
      return tAll('action_search_empty');
    }
    if (!service.timetable) {
      return notReady(service);
    }
    const stops = service.timetable.searchStops(query, SEARCH_LIMIT);
    if (stops.length === 0) {
      return tAll('action_search_none', { query });
    }
    return tAll('action_search_results', { list: stops.map(stopLine).join('\n') });
  },

  async nearby_stops(gladys, { service }) {
    if (!service.timetable) {
      return notReady(service);
    }
    const houses = (await gladys.getHouses()).filter(
      (house) => typeof house.latitude === 'number' && typeof house.longitude === 'number',
    );
    if (houses.length === 0) {
      return tAll('action_nearby_no_house');
    }
    const blocks = houses.slice(0, 3).map((house) => {
      const stops = service.timetable.nearbyStops(
        house.latitude,
        house.longitude,
        NEARBY_PER_HOUSE,
      );
      return { house: house.name, list: stops.map(stopLine).join('\n') };
    });
    const messages = blocks.map((block) => tAll('action_nearby_results', block));
    // One message per language, the houses one after the other.
    return Object.fromEntries(
      Object.keys(messages[0]).map((lang) => [lang, messages.map((m) => m[lang]).join('\n\n')]),
    );
  },

  async test_connection(gladys, { service }) {
    if (!service.timetable) {
      return notReady(service);
    }
    // A live read, unless the quota forbids it: then say so rather than
    // passing the cached data off as a successful test.
    const callsBefore = service.realtime.usedToday();
    let alerts;
    try {
      alerts = await service.realtime.get(FEEDS.ALERTS, { force: true });
    } catch (err) {
      await service.reportStatus();
      return tAll('action_test_realtime_failed', { message: err.message });
    }
    if (service.realtime.usedToday() === callsBefore || !alerts?.data) {
      return tAll('action_test_quota');
    }
    await service.reportStatus();
    return tAll('action_test_ok', {
      version: service.timetable.feedVersion,
      stops: service.timetable.data.stops.length,
      trips: service.realtime.cached(FEEDS.TRIP_UPDATES)?.data?.size ?? 0,
      alerts: alerts.data.length,
      used: service.realtime.usedToday(),
      limit: service.realtime.budget.perDay,
    });
  },

  async refresh_timetable(gladys, { service }) {
    const refresh = service.ensureTimetable({ checkUpdate: true }).then(async (result) => {
      if (result.updated) {
        await service.publishDevices();
        await service.tick();
      }
      await service.reportStatus();
      return result;
    });
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), REFRESH_WAIT_MS);
    });
    try {
      const result = await Promise.race([refresh, timeout]);
      if (result === null) {
        refresh.catch((err) => logger.error('Timetable refresh failed', err));
        return tAll('status_loading');
      }
      const version = service.timetable?.feedVersion ?? result.version;
      return tAll(result.updated ? 'action_refresh_updated' : 'action_refresh_unchanged', {
        version,
      });
    } finally {
      clearTimeout(timer);
    }
  },
};
