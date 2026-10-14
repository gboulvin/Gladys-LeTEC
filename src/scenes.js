// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
//   get_next_departure    the next departure of a monitored stop, as outputs a
//                         message action reads: "Bus {{...line}} in
//                         {{...minutes}} min";
//   get_line_disruptions  whether a line is disrupted right now.
//
// Both read what the service already holds (timetable + last real-time
// read): a scene never spends the real-time quota, except for the alerts
// when none were read yet. Throwing fails this action only; a stop without
// departure is an output (`found: false`), not a failure.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { describeDeparture, summarizeDepartures } from './format.js';
import { pickTranslation, t } from './i18n.js';
import { FEEDS, isAlertActive } from './realtime.js';
import { formatClock } from './time.js';

const logger = createLogger({ name: 'scenes' });

/** "52+M4", "52 M4" -> ['52', 'M4']. */
export function parseLines(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/[+|,;\s]+/)
        .map((line) => line.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

function assertReady(service) {
  if (!service.timetable) {
    throw new Error('The TEC timetable is still loading');
  }
}

export const SCENE_ACTIONS = {
  async get_next_departure(gladys, { fields, service }) {
    logger.info(`Scene action get_next_departure <- ${fields.device}`);
    assertReady(service);
    const entry = service.entryOf(fields.device);
    const lang = service.config.language;
    if (!entry) {
      return { found: false, summary: t(lang, 'widget_unknown_stop') };
    }
    const lines = parseLines(fields.line);
    const snapshot = service.snapshot(entry, { lines: lines.length > 0 ? lines : entry.lines });
    const { next, following, departures } = snapshot;
    if (!next) {
      return { found: false, summary: t(lang, 'no_service') };
    }
    return {
      found: true,
      line: next.line,
      destination: next.destination,
      minutes: next.minutes,
      expected_time: formatClock(next.expected),
      scheduled_time: formatClock(next.scheduled),
      delay_minutes: next.delayMinutes,
      realtime: next.realtime,
      following_minutes: following ? following.minutes : null,
      summary:
        departures.length > 0
          ? summarizeDepartures(departures, lang)
          : describeDeparture(next, lang),
    };
  },

  async get_line_disruptions(gladys, { fields, service }) {
    logger.info(`Scene action get_line_disruptions <- ${fields.line}`);
    assertReady(service);
    const lang = service.config.language;
    const lines = parseLines(fields.line);
    const entry = fields.device ? service.entryOf(fields.device) : null;
    const routes = entry
      ? service.timetable.routesAt(entry.stopId, lines)
      : lines.flatMap((line) => service.timetable.routesNamed(line));
    const bases = new Set(routes.map((route) => route.base));

    let alerts = service.alerts();
    if (alerts === null) {
      alerts = (await service.realtime.get(FEEDS.ALERTS).catch(() => null))?.data ?? [];
    }
    const now = service.now();
    const matching = alerts.filter(
      (alert) =>
        !alert.tripLevel &&
        isAlertActive(alert, now) &&
        alert.routeBases.some((base) => bases.has(base)),
    );
    return {
      disrupted: matching.length > 0,
      count: matching.length,
      summary:
        matching.length > 0
          ? matching
              .map((alert) => pickTranslation(alert.header, lang))
              .join(' | ')
              .slice(0, 2000)
          : t(lang, 'disruptions_none'),
    };
  },
};
