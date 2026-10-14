// -----------------------------------------------------------------------------
// Scene triggers (manifest `scene_triggers`, Gladys 5.1+).
//
// The service loop computes a snapshot of every monitored stop twice a minute;
// the tracker compares it with what it saw before and returns the events to
// fire — ONE per transition, never one per refresh:
//
//   departure_soon       a departure crossed a "leave in N minutes" mark;
//   departure_delayed    a departure became late by the configured threshold;
//   departure_cancelled  a departure was cancelled (trip or stop);
//   disruption_started   a new alert concerns a line of the stop.
//
// Event `data` is flat and only carries the keys the manifest declares in
// `fields` (filters) and `variables` (exposed to the scene).
// -----------------------------------------------------------------------------

import { pickTranslation } from './i18n.js';
import { formatClock } from './time.js';

export const TRIGGERS = {
  DEPARTURE_SOON: 'departure_soon',
  DEPARTURE_DELAYED: 'departure_delayed',
  DEPARTURE_CANCELLED: 'departure_cancelled',
  DISRUPTION_STARTED: 'disruption_started',
};

// "Leave in N minutes" marks: the options of the `minutes` filter of
// departure_soon in the manifest.
export const SOON_MARKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30];

// Departure events are only fired for what is coming soon.
const EVENT_WINDOW_MINUTES = 60;
// Forget what was fired once it is that old: the departure is long gone.
const MEMORY_MS = 6 * 60 * 60 * 1000;

export class TriggerTracker {
  constructor() {
    this.lastMinutes = new Map(); // `${device}|${departure}` -> minutes
    this.fired = new Map(); // event identity -> time
    this.knownAlerts = new Map(); // device -> Set(alert id)
  }

  fireOnce(identity, now) {
    if (this.fired.has(identity)) {
      return false;
    }
    this.fired.set(identity, now);
    return true;
  }

  prune(now) {
    for (const [identity, time] of this.fired) {
      if (now - time > MEMORY_MS) {
        this.fired.delete(identity);
      }
    }
  }

  /** Forget a device (removed from the configuration). */
  forget(device) {
    this.knownAlerts.delete(device);
    for (const key of this.lastMinutes.keys()) {
      if (key.startsWith(`${device}|`)) {
        this.lastMinutes.delete(key);
      }
    }
  }

  /**
   * Events to fire for one stop.
   * @param {string} device - the device external_id
   * @param {object} snapshot - service snapshot of the stop
   * @param {{ delay_threshold: number, language: string }} config
   * @param {number} now
   * @returns {Array<{ key: string, data: object }>}
   */
  evaluate(device, snapshot, config, now) {
    const events = [];
    const stopName = snapshot.stop?.name ?? snapshot.entry.stopId;
    const seen = new Set();

    for (const departure of snapshot.departures) {
      if (departure.minutes > EVENT_WINDOW_MINUTES) {
        continue;
      }
      const id = `${device}|${departure.key}`;
      seen.add(id);
      const base = {
        device,
        line: departure.line,
        destination: departure.destination,
        stop_name: stopName,
        scheduled_time: formatClock(departure.scheduled),
      };

      if (departure.cancelled) {
        if (this.fireOnce(`${id}|cancelled`, now)) {
          events.push({ key: TRIGGERS.DEPARTURE_CANCELLED, data: base });
        }
        continue;
      }

      const expected = {
        expected_time: formatClock(departure.expected),
        delay_minutes: departure.delayMinutes,
      };
      if (
        departure.realtime &&
        departure.delayMinutes >= config.delay_threshold &&
        this.fireOnce(`${id}|delayed`, now)
      ) {
        events.push({ key: TRIGGERS.DEPARTURE_DELAYED, data: { ...base, ...expected } });
      }

      // A mark fires when the countdown CROSSES it: never at the first sight
      // of a departure (a restart in the middle of a countdown stays quiet).
      const before = this.lastMinutes.get(id);
      this.lastMinutes.set(id, departure.minutes);
      if (before === undefined) {
        continue;
      }
      for (const mark of SOON_MARKS) {
        if (
          before > mark &&
          departure.minutes <= mark &&
          this.fireOnce(`${id}|soon|${mark}`, now)
        ) {
          events.push({
            key: TRIGGERS.DEPARTURE_SOON,
            data: {
              ...base,
              ...expected,
              minutes: String(mark),
              realtime: departure.realtime,
            },
          });
        }
      }
    }
    for (const key of this.lastMinutes.keys()) {
      if (key.startsWith(`${device}|`) && !seen.has(key)) {
        this.lastMinutes.delete(key);
      }
    }

    // Alerts: the first read only learns what is already in force.
    const known = this.knownAlerts.get(device);
    const current = new Set(snapshot.alerts.map((alert) => alert.id));
    if (known && snapshot.alertsLoaded) {
      for (const alert of snapshot.alerts) {
        if (known.has(alert.id)) {
          continue;
        }
        const lines = alert.lines.length > 0 ? alert.lines : [''];
        for (const line of lines) {
          events.push({
            key: TRIGGERS.DISRUPTION_STARTED,
            data: {
              device,
              line,
              stop_name: stopName,
              title: pickTranslation(alert.header, config.language).slice(0, 1000),
              description: pickTranslation(alert.description, config.language).slice(0, 1000),
              url: pickTranslation(alert.url, config.language).slice(0, 1000),
            },
          });
        }
      }
    }
    if (snapshot.alertsLoaded) {
      this.knownAlerts.set(device, current);
    }

    this.prune(now);
    return events;
  }
}
