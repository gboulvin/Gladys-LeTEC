// -----------------------------------------------------------------------------
// Next departures of a stop: the timetable, corrected by the real-time feed.
//
// Pure functions (no I/O, `now` passed in) so every rule is unit-tested:
//   - a trip update at THIS stop gives the expected time (or says it is
//     skipped);
//   - otherwise the delay of the last updated stop BEFORE it carries over
//     (the GTFS-RT propagation rule), then the trip-level delay;
//   - a canceled trip stays listed, flagged, so the user sees it is gone.
// -----------------------------------------------------------------------------

import { isAlertActive } from './realtime.js';
import { minutesUntil } from './time.js';

// A departure scheduled up to this long ago may still be ahead when late.
const LATE_WINDOW_MS = 60 * 60 * 1000;
// A departure stays listed this long after its expected time (bus at the stop).
const LEAVING_GRACE_MS = 30 * 1000;
// How far the "next departure" counter looks when nothing runs in the
// horizon (night, Sunday): the first bus of the next morning still counts.
export const LOOKAHEAD_MS = 36 * 60 * 60 * 1000;

/**
 * Real-time correction of one scheduled departure.
 * @param {object} departure
 * @param {Map|null} tripUpdates - parseTripUpdates() output
 * @param {Map<string, Set<string>>} [cancelled] - cancelledTrips() output
 */
export function applyRealtime(departure, tripUpdates, cancelled) {
  const dates = cancelled?.get(departure.tripId);
  if (dates && (dates.has(departure.date) || dates.has(''))) {
    return { expected: departure.scheduled, realtime: true, cancelled: true };
  }
  const update = tripUpdates?.get(departure.tripId);
  if (!update || (update.startDate && update.startDate !== departure.date)) {
    return { expected: departure.scheduled, realtime: false, cancelled: false };
  }
  if (update.canceled) {
    return { expected: departure.scheduled, realtime: true, cancelled: true };
  }
  const atStop = update.updates.find((stopUpdate) =>
    stopUpdate.sequence !== null
      ? stopUpdate.sequence === departure.sequence
      : stopUpdate.stopId === departure.stopId,
  );
  if (atStop) {
    if (atStop.skipped) {
      return { expected: departure.scheduled, realtime: true, cancelled: true };
    }
    if (atStop.time !== null) {
      return { expected: atStop.time * 1000, realtime: true, cancelled: false };
    }
    if (atStop.delay !== null) {
      return {
        expected: departure.scheduled + atStop.delay * 1000,
        realtime: true,
        cancelled: false,
      };
    }
  }
  const before = update.updates
    .filter(
      (stopUpdate) =>
        stopUpdate.sequence !== null &&
        stopUpdate.sequence < departure.sequence &&
        stopUpdate.delay !== null,
    )
    .sort((a, b) => b.sequence - a.sequence)[0];
  const delay = before?.delay ?? update.delay;
  return {
    expected: departure.scheduled + (delay ?? 0) * 1000,
    realtime: true,
    cancelled: false,
  };
}

/**
 * Upcoming departures of a monitored stop.
 * @param {object} options
 * @param {import('./gtfs/timetable.js').Timetable} options.timetable
 * @param {Map|null} options.tripUpdates - parseTripUpdates() output, null when unavailable
 * @param {Map} [options.cancelled] - trips cancelled by alerts (cancelledTrips())
 * @param {string} options.stopId
 * @param {string[]} options.lines - line filter (all when empty)
 * @param {number} options.now - epoch ms
 * @param {number} options.horizonMs - how far ahead to list
 */
export function computeDepartures({
  timetable,
  tripUpdates,
  cancelled,
  stopId,
  lines = [],
  now,
  horizonMs,
}) {
  const scheduled = timetable.scheduledDepartures(
    stopId,
    now - LATE_WINDOW_MS,
    now + horizonMs,
    lines,
  );
  const departures = [];
  for (const departure of scheduled) {
    const {
      expected,
      realtime,
      cancelled: isCancelled,
    } = applyRealtime({ ...departure, stopId }, tripUpdates, cancelled);
    // Without real-time data, a departure whose time passed is gone.
    const reference = realtime ? expected : departure.scheduled;
    if (reference < now - LEAVING_GRACE_MS || reference > now + horizonMs) {
      continue;
    }
    departures.push({
      key: `${departure.tripId}|${departure.date}`,
      tripId: departure.tripId,
      date: departure.date,
      line: departure.line,
      routeType: departure.routeType,
      routeBase: departure.routeBase,
      destination: departure.destination,
      scheduled: departure.scheduled,
      expected: reference,
      delayMinutes: Math.round((reference - departure.scheduled) / 60_000),
      minutes: minutesUntil(reference, now),
      realtime,
      cancelled: isCancelled,
    });
  }
  return departures.sort((a, b) => a.expected - b.expected || a.line.localeCompare(b.line));
}

/**
 * First scheduled departure after the horizon, for the "next departure"
 * counter at night: no delay correction that far ahead.
 */
export function nextScheduledDeparture({ timetable, stopId, lines = [], now, fromMs, cancelled }) {
  // Cancellations are announced ahead (trip-level alerts): skip them.
  const first = timetable
    .scheduledDepartures(stopId, fromMs, now + LOOKAHEAD_MS, lines)
    .find((departure) => !applyRealtime({ ...departure, stopId }, null, cancelled).cancelled);
  if (!first) {
    return null;
  }
  return {
    key: `${first.tripId}|${first.date}`,
    tripId: first.tripId,
    date: first.date,
    line: first.line,
    routeType: first.routeType,
    routeBase: first.routeBase,
    destination: first.destination,
    scheduled: first.scheduled,
    expected: first.scheduled,
    delayMinutes: 0,
    minutes: minutesUntil(first.scheduled, now),
    realtime: false,
    cancelled: false,
  };
}

/**
 * Alerts in force on a monitored stop: on one of the routes serving it (with
 * the line filter applied), or on the stop itself.
 * @param {Array} alerts - parseAlerts() output
 * @param {{ stopId: string, routes: Array<{ base: string, short: string }> }} target
 * @returns {Array<object & { lines: string[] }>} the alerts, with the lines concerned
 */
export function alertsForStop(alerts, { stopId, routes }, now) {
  const linesByBase = new Map();
  for (const route of routes) {
    linesByBase.set(route.base, route.short);
  }
  const result = [];
  for (const alert of alerts ?? []) {
    // A cancelled trip is a cancelled departure, not a disruption of the line.
    if (alert.tripLevel || !isAlertActive(alert, now)) {
      continue;
    }
    const lines = [
      ...new Set(
        alert.routeBases
          .filter((base) => linesByBase.has(base))
          .map((base) => linesByBase.get(base)),
      ),
    ];
    if (lines.length > 0 || alert.stopIds.includes(stopId)) {
      result.push({ ...alert, lines });
    }
  }
  return result;
}
