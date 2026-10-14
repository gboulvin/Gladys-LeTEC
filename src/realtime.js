// -----------------------------------------------------------------------------
// TEC real-time feeds (GTFS-RT), served by the Belgian Mobility open data
// portal in their JSON form: trip updates (delays, cancellations, skipped
// stops) and service alerts (works, detours, strikes...).
//
// The portal admits 100 requests a day without a key, and 12 000 a day with
// the free key of its developer portal. The client owns that quota: it
// refuses to call beyond a daily budget, spaces the anonymous calls, and backs
// off after a 429. The JSON is gzip-compressed on the wire (~400 KB per trip
// updates read).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'realtime' });

export const REALTIME_BASE_URL =
  'https://api-management-opendata-production.azure-api.net/api/gtfs/feed/tec/rt';

export const FEEDS = { TRIP_UPDATES: 'trip-update', ALERTS: 'alert' };

// Requests a day and a minute the client allows itself, a little under the
// published limits so the manual actions keep some room.
export const BUDGETS = {
  anonymous: { perDay: 95, perMinute: 8 },
  key: { perDay: 11_500, perMinute: 400 },
};

// Without a key, the 95 daily requests are shared between both feeds: trip
// updates every 20 minutes (72 a day at most, none at night) and alerts every
// 2 hours (12 a day), leaving room for the manual actions.
export const ANONYMOUS_INTERVALS = { [FEEDS.TRIP_UPDATES]: 20 * 60, [FEEDS.ALERTS]: 2 * 60 * 60 };
// With a key, alerts move slowly: every 5 minutes is plenty.
export const ALERTS_INTERVAL_WITH_KEY = 5 * 60;

const BACKOFF_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 30_000;

// GTFS-RT enums (numbers in the JSON form).
const TRIP_CANCELED = 3;
const EFFECT_NO_SERVICE = 1;
const STOP_SKIPPED = 1;
const STOP_NO_DATA = 2;

export class RealtimeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Strip the `gt:tec:` / `gs:tec:` / `gr:tec:` prefix of the real-time ids. */
export function stripPrefix(id) {
  return String(id ?? '').replace(/^[a-z]{1,3}:[a-z]+:/i, '');
}

/** A protobuf 64-bit integer as JSON: a number, a string or `{ low, high }`. */
export function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return (Number(value.low) >>> 0) + Number(value.high ?? 0) * 2 ** 32;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Index a trip updates feed by trip id.
 * @returns {Map<string, { startDate: string, canceled: boolean, delay: number|null,
 *   updates: Array<{ sequence: number|null, stopId: string, time: number|null,
 *   delay: number|null, skipped: boolean }> }>}
 */
export function parseTripUpdates(body) {
  const trips = new Map();
  for (const entity of body?.entity ?? []) {
    const update = entity.tripUpdate;
    if (!update?.trip?.tripId) {
      continue;
    }
    trips.set(stripPrefix(update.trip.tripId), {
      startDate: update.trip.startDate ?? '',
      canceled: update.trip.scheduleRelationship === TRIP_CANCELED,
      delay: toNumber(update.delay),
      updates: (update.stopTimeUpdate ?? [])
        .filter((stopUpdate) => stopUpdate.scheduleRelationship !== STOP_NO_DATA)
        .map((stopUpdate) => {
          const event = stopUpdate.departure ?? stopUpdate.arrival ?? {};
          return {
            sequence: toNumber(stopUpdate.stopSequence),
            stopId: stripPrefix(stopUpdate.stopId),
            time: toNumber(event.time),
            delay: toNumber(event.delay),
            skipped: stopUpdate.scheduleRelationship === STOP_SKIPPED,
          };
        }),
    });
  }
  return trips;
}

function translations(text) {
  const result = {};
  for (const { language, text: value } of text?.translation ?? []) {
    if (value) {
      result[language || 'fr'] = value;
    }
  }
  return result;
}

/**
 * Normalize a service alerts feed.
 *
 * TEC also publishes every cancelled TRIP as an alert ("Annulations", one
 * trip per alert, hundreds a day): those are `tripLevel` — a cancelled
 * departure, not a disruption of the line — and their `trips` list the
 * cancelled trips with their service date.
 *
 * @returns {Array<{ id: string, periods: Array<{ start: number|null, end: number|null }>,
 *   routeBases: string[], stopIds: string[], trips: Array<{ tripId: string, startDate: string }>,
 *   tripLevel: boolean, cause: number|null, effect: number|null, header: object,
 *   description: object, url: object }>}
 */
export function parseAlerts(body) {
  const alerts = [];
  for (const entity of body?.entity ?? []) {
    const alert = entity.alert;
    if (!alert) {
      continue;
    }
    const periods = (alert.activePeriod ?? []).map((period) => ({
      start: toNumber(period.start),
      end: toNumber(period.end),
    }));
    const entities = alert.informedEntity ?? [];
    const trips = entities
      .filter((informed) => informed.trip?.tripId)
      .map((informed) => ({
        tripId: stripPrefix(informed.trip.tripId),
        startDate: informed.trip.startDate ?? '',
      }));
    alerts.push({
      id: String(entity.id),
      periods,
      routeBases: [
        ...new Set(
          entities
            .filter((informed) => informed.routeId)
            .map((informed) => stripPrefix(informed.routeId).split('-')[0]),
        ),
      ],
      stopIds: [
        ...new Set(
          entities
            .filter((informed) => informed.stopId)
            .map((informed) => stripPrefix(informed.stopId)),
        ),
      ],
      trips,
      tripLevel: entities.length > 0 && trips.length === entities.length,
      cause: alert.cause ?? null,
      effect: alert.effect ?? null,
      header: translations(alert.headerText),
      description: translations(alert.descriptionText),
      url: translations(alert.url),
    });
  }
  return alerts;
}

/**
 * Trips cancelled by trip-level alerts: `Map<tripId, Set<startDate>>` (an
 * empty date means any day).
 */
export function cancelledTrips(alerts) {
  const cancelled = new Map();
  for (const alert of alerts ?? []) {
    if (!alert.tripLevel || alert.effect !== EFFECT_NO_SERVICE) {
      continue;
    }
    for (const { tripId, startDate } of alert.trips) {
      if (!cancelled.has(tripId)) {
        cancelled.set(tripId, new Set());
      }
      cancelled.get(tripId).add(startDate);
    }
  }
  return cancelled;
}

/** Whether an alert is in force at an instant (no period = always). */
export function isAlertActive(alert, nowMs) {
  if (alert.periods.length === 0) {
    return true;
  }
  const now = nowMs / 1000;
  return alert.periods.some(
    (period) =>
      (period.start === null || period.start <= now) && (period.end === null || now < period.end),
  );
}

export class RealtimeClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   * @param {string} [options.baseUrl]
   */
  constructor({ fetch = (...args) => globalThis.fetch(...args), now = Date.now, baseUrl } = {}) {
    this.fetch = fetch;
    this.now = now;
    this.baseUrl = baseUrl ?? REALTIME_BASE_URL;
    this.apiKey = '';
    this.calls = [];
    this.blockedUntil = 0;
    this.cache = new Map();
    this.lastError = null;
  }

  setApiKey(apiKey) {
    if (apiKey !== this.apiKey) {
      this.apiKey = apiKey ?? '';
      this.blockedUntil = 0;
      this.lastError = null;
    }
  }

  get hasKey() {
    return this.apiKey !== '';
  }

  get budget() {
    return this.hasKey ? BUDGETS.key : BUDGETS.anonymous;
  }

  /** Requests made over the last 24 hours. */
  usedToday() {
    const now = this.now();
    this.calls = this.calls.filter((time) => now - time < 24 * 60 * 60 * 1000);
    return this.calls.length;
  }

  /** Whether the quota allows one more request now. */
  canCall() {
    const now = this.now();
    if (now < this.blockedUntil) {
      return false;
    }
    const lastMinute = this.calls.filter((time) => now - time < 60_000).length;
    return this.usedToday() < this.budget.perDay && lastMinute < this.budget.perMinute;
  }

  /**
   * Minimum seconds between two reads of a feed.
   * @param {string} feed - FEEDS value
   * @param {number} refreshInterval - user setting, seconds
   */
  intervalFor(feed, refreshInterval) {
    if (!this.hasKey) {
      return ANONYMOUS_INTERVALS[feed];
    }
    return feed === FEEDS.ALERTS
      ? Math.max(ALERTS_INTERVAL_WITH_KEY, refreshInterval)
      : refreshInterval;
  }

  /** The last successful read of a feed: `{ fetchedAt, data }`, or undefined. */
  cached(feed) {
    return this.cache.get(feed);
  }

  /** Whether a feed is due for a new read. */
  isDue(feed, refreshInterval) {
    const cached = this.cache.get(feed);
    const lastAttempt = Math.max(cached?.fetchedAt ?? 0, cached?.failedAt ?? 0);
    return this.now() - lastAttempt >= this.intervalFor(feed, refreshInterval) * 1000 - 5_000;
  }

  /**
   * Read a feed when due (or when `force` and the quota allows), and return
   * the latest data, cached or fresh. Never throws for a quota reason: the
   * cached data is returned instead. Throws RealtimeError on a refused key.
   */
  async get(feed, { refreshInterval = 60, force = false } = {}) {
    const cached = this.cache.get(feed);
    if ((!force && !this.isDue(feed, refreshInterval)) || !this.canCall()) {
      return cached;
    }
    this.calls.push(this.now());
    const headers = { Accept: 'application/json' };
    if (this.hasKey) {
      headers['Ocp-Apim-Subscription-Key'] = this.apiKey;
    }
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/${feed}?format=json`, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.cache.set(feed, { ...cached, failedAt: this.now() });
      this.lastError = new RealtimeError('network', err.message);
      throw this.lastError;
    }
    if (response.status === 401 || response.status === 403) {
      this.blockedUntil = this.now() + BACKOFF_MS;
      this.lastError = new RealtimeError(
        'unauthorized',
        `Real-time feed refused the request (HTTP ${response.status})`,
      );
      throw this.lastError;
    }
    if (response.status === 429) {
      this.blockedUntil = this.now() + BACKOFF_MS;
      this.lastError = new RealtimeError('quota', 'Real-time quota exceeded (HTTP 429)');
      logger.warn('Real-time quota exceeded: pausing the real-time reads for 15 minutes');
      return cached;
    }
    if (!response.ok) {
      this.cache.set(feed, { ...cached, failedAt: this.now() });
      this.lastError = new RealtimeError('http', `Real-time feed HTTP ${response.status}`);
      throw this.lastError;
    }
    const body = await response.json();
    const data = feed === FEEDS.ALERTS ? parseAlerts(body) : parseTripUpdates(body);
    const entry = {
      fetchedAt: this.now(),
      feedTimestamp: toNumber(body?.header?.timestamp),
      data,
    };
    this.cache.set(feed, entry);
    this.lastError = null;
    logger.debug(`Real-time ${feed}: ${data.size ?? data.length} entities`);
    return entry;
  }
}
