// -----------------------------------------------------------------------------
// Texts describing departures, in one language (device states, scene outputs)
// or in all of them (widgets, through i18n.tAll).
// -----------------------------------------------------------------------------

import { t } from './i18n.js';
import { formatClock } from './time.js';

/** `+3 min`, `-1 min`, `on time`, `cancelled`, or '' (timetable only). */
export function delayLabel(departure, lang) {
  if (departure.cancelled) {
    return t(lang, 'cancelled');
  }
  if (!departure.realtime) {
    return '';
  }
  if (departure.delayMinutes > 0) {
    return `+${t(lang, 'minutes', { n: departure.delayMinutes })}`;
  }
  if (departure.delayMinutes < 0) {
    return `-${t(lang, 'minutes', { n: -departure.delayMinutes })}`;
  }
  return t(lang, 'on_time');
}

/** `3 min`, or `now` under a minute. */
export function waitLabel(departure, lang) {
  return departure.minutes === 0 ? t(lang, 'now') : t(lang, 'minutes', { n: departure.minutes });
}

/** `52 → MONS SNCB - Quai A`. */
export function lineLabel(departure) {
  return departure.destination ? `${departure.line} → ${departure.destination}` : departure.line;
}

/** `52 → MONS SNCB - Quai A · 14:32 (+2 min)`. */
export function describeDeparture(departure, lang) {
  const delay = delayLabel(departure, lang);
  const clock = formatClock(departure.expected);
  return `${lineLabel(departure)} · ${clock}${delay ? ` (${delay})` : ''}`;
}

/** `52 3 min · M4 7 min (+2 min) · 61 supprimé`, at most `count` entries. */
export function summarizeDepartures(departures, lang, count = 5) {
  return departures
    .slice(0, count)
    .map((departure) => {
      if (departure.cancelled) {
        return `${departure.line} ${formatClock(departure.scheduled)} ${t(lang, 'cancelled')}`;
      }
      const delay =
        departure.realtime && departure.delayMinutes !== 0 ? delayLabel(departure, lang) : '';
      return `${departure.line} ${waitLabel(departure, lang)}${delay ? ` (${delay})` : ''}`;
    })
    .join(' · ');
}
