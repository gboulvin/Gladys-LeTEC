// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes the received object (form values may arrive as strings), and
// parses the list of monitored stops.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './i18n.js';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Free key of the Belgian Mobility open data portal. Optional: without it
  // the anonymous quota (100 requests a day) only allows a slow real-time
  // refresh, see src/realtime.js.
  api_key: '',
  // Monitored stops, e.g. "Cmonacc1, Ctrrpla2:52+M4" (see parseStops).
  stops: '',
  // Language of the texts the integration writes in the device states.
  language: 'fr',
  // Seconds between two reads of the real-time feed (with an API key).
  refresh_interval: 60,
  // How far ahead the departures lists look, in minutes.
  horizon_minutes: 90,
  // Delay, in minutes, from which a departure fires the "delayed" trigger.
  delay_threshold: 5,
};

export const LIMITS = {
  refresh_interval: { min: 30, max: 3600 },
  horizon_minutes: { min: 15, max: 240 },
  delay_threshold: { min: 1, max: 60 },
};

// More stops would mean more devices, events and widget content than a home
// needs, and a longer timetable indexing.
export const MAX_STOPS = 20;

function clampNumber(value, fallback, { min, max }) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const language = LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    api_key: typeof raw.api_key === 'string' ? raw.api_key.trim() : '',
    stops: typeof raw.stops === 'string' ? raw.stops : '',
    language,
    refresh_interval: clampNumber(
      raw.refresh_interval,
      DEFAULT_CONFIG.refresh_interval,
      LIMITS.refresh_interval,
    ),
    horizon_minutes: clampNumber(
      raw.horizon_minutes,
      DEFAULT_CONFIG.horizon_minutes,
      LIMITS.horizon_minutes,
    ),
    delay_threshold: clampNumber(
      raw.delay_threshold,
      DEFAULT_CONFIG.delay_threshold,
      LIMITS.delay_threshold,
    ),
  };
}

// A TEC stop id: letters and digits, e.g. "Cmonacc1", "LGHmani1", "X615aaa".
const STOP_ID = /^[A-Za-z0-9]{2,20}$/;
// A line as the network names it: "52", "M2", "T1", "E42", "1/"...
const LINE = /^[A-Za-z0-9/]{1,8}$/;

/**
 * Parse the `stops` config text into the list of monitored stops.
 *
 * Entries are separated by commas, semicolons or line breaks. Each one is a
 * stop id, optionally followed by a colon and the lines to keep, separated
 * by `+`, `|` or spaces: `Ctrrpla2`, `Ctrrpla2:52+M4`.
 *
 * @param {string} text
 * @returns {{ entries: Array<{ stopId: string, lines: string[], key: string }>, invalid: string[] }}
 *   `key` is the stable platform id of the device built for the entry.
 */
export function parseStops(text = '') {
  const entries = [];
  const invalid = [];
  const seen = new Set();
  for (const raw of String(text).split(/[,;\n]+/)) {
    const item = raw.trim();
    if (!item) {
      continue;
    }
    const [stopPart, linesPart = ''] = item.split(':');
    const stopId = stopPart.trim();
    const lines = [
      ...new Set(
        linesPart
          .split(/[+|\s]+/)
          .map((line) => line.trim().toUpperCase())
          .filter(Boolean),
      ),
    ].sort();
    if (!STOP_ID.test(stopId) || lines.some((line) => !LINE.test(line))) {
      invalid.push(item);
      continue;
    }
    // The key becomes part of the device external_id: it must never change
    // for the same entry, hence the sorted, de-duplicated lines.
    const key = lines.length > 0 ? `${stopId}__${lines.join('-').replaceAll('/', '')}` : stopId;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ stopId, lines, key });
  }
  return { entries: entries.slice(0, MAX_STOPS), invalid };
}
