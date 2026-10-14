// -----------------------------------------------------------------------------
// Device type: MONITORED STOP
//
// One Gladys device per entry of the `stops` configuration (a stop, with an
// optional line filter). Read-only features, refreshed by the service loop
// (src/service.js) — not by Gladys polling: one read of the real-time feed
// serves every stop at once.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { describeDeparture, summarizeDepartures } from './format.js';

export const DEVICE_TYPE = 'stop';

// Feature keys: part of the feature external_ids, never renamed.
export const FEATURES = {
  NEXT: 'next-departure',
  NEXT_TRIP: 'next-trip',
  DELAY: 'next-delay',
  FOLLOWING: 'following-departure',
  DEPARTURES: 'departures',
  DISRUPTIONS: 'disruptions',
};

export function stopIds(gladys, entry) {
  return gladys.externalIds(DEVICE_TYPE, entry.key);
}

/** Device name: the stop name, with the line filter when there is one. */
export function deviceName(entry, stop) {
  const name = stop?.name ?? entry.stopId;
  return entry.lines.length > 0 ? `TEC ${name} (${entry.lines.join(', ')})` : `TEC ${name}`;
}

const minutesFeature = (ids, key, name, min, max) => ({
  name,
  external_id: ids.feature(key),
  category: DEVICE_FEATURE_CATEGORIES.DURATION,
  type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
  unit: DEVICE_FEATURE_UNITS.MINUTES,
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

const textFeature = (ids, key, name) => ({
  name,
  external_id: ids.feature(key),
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: false,
});

/**
 * Discovery payload of a monitored stop.
 * @param {object} gladys
 * @param {{ stopId: string, lines: string[], key: string }} entry
 * @param {{ name: string } | null} stop - timetable data, null while loading
 * @param {string} lang - language of the feature names
 */
export function buildStopDevice(gladys, entry, stop, lang) {
  const ids = stopIds(gladys, entry);
  return {
    name: deviceName(entry, stop),
    external_id: ids.device,
    features: [
      minutesFeature(ids, FEATURES.NEXT, t(lang, 'feature_next'), 0, 2160),
      textFeature(ids, FEATURES.NEXT_TRIP, t(lang, 'feature_next_trip')),
      minutesFeature(ids, FEATURES.DELAY, t(lang, 'feature_delay'), -60, 600),
      minutesFeature(ids, FEATURES.FOLLOWING, t(lang, 'feature_following'), 0, 2160),
      textFeature(ids, FEATURES.DEPARTURES, t(lang, 'feature_departures')),
      {
        name: t(lang, 'feature_disruptions'),
        external_id: ids.feature(FEATURES.DISRUPTIONS),
        category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
        min: 0,
        max: 100,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

/**
 * States of a monitored stop, from its snapshot (see service.snapshot()).
 * A counter without a departure in the next 36 hours (a stop no longer
 * served) is left as is rather than set to a misleading value.
 */
export function buildStopStates(gladys, entry, snapshot, lang, horizonMinutes) {
  const ids = stopIds(gladys, entry);
  const states = [];
  const push = (key, value) =>
    states.push({
      device_feature_external_id: ids.feature(key),
      ...(typeof value === 'string' ? { text: value } : { state: value }),
    });

  const { next, following, departures, alerts } = snapshot;
  if (next) {
    push(FEATURES.NEXT, next.minutes);
    push(FEATURES.DELAY, next.delayMinutes);
    push(FEATURES.NEXT_TRIP, describeDeparture(next, lang));
  } else {
    push(FEATURES.NEXT_TRIP, t(lang, 'no_service'));
  }
  if (following) {
    push(FEATURES.FOLLOWING, following.minutes);
  }
  push(
    FEATURES.DEPARTURES,
    departures.length > 0
      ? summarizeDepartures(departures, lang)
      : t(lang, 'no_departure', { n: horizonMinutes }),
  );
  push(FEATURES.DISRUPTIONS, alerts.length);
  return states;
}
