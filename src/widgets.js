// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
//   next_departures   the departure board of one monitored stop: live tiles
//                     bound to its features, the list of the next departures
//                     with their delay, the data source, a refresh button;
//   line_disruptions  the alerts in force on the lines of the monitored
//                     stops (or of one of them, or of one line).
//
// The content is declarative (no HTML): the core renders it with its theme
// and dark mode. Texts are built in the language of the viewing user.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { delayLabel, lineLabel, waitLabel } from './format.js';
import { effectKey, pickTranslation, t, tAll } from './i18n.js';
import { FEATURES, stopIds } from './stopDevice.js';
import { parseLines } from './scenes.js';
import { FEEDS } from './realtime.js';
import { formatClock } from './time.js';

const logger = createLogger({ name: 'widgets' });

export const NEXT_DEPARTURES_WIDGET = 'next_departures';
export const LINE_DISRUPTIONS_WIDGET = 'line_disruptions';

const ACTIONS = { REFRESH: 'refresh' };

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function departureColor(departure, threshold) {
  if (departure.cancelled) return WIDGET_COLORS.DANGER;
  if (!departure.realtime) return WIDGET_COLORS.NEUTRAL;
  if (departure.delayMinutes >= threshold) return WIDGET_COLORS.WARNING;
  if (departure.delayMinutes > 0) return WIDGET_COLORS.INFO;
  return WIDGET_COLORS.SUCCESS;
}

function departureItem(departure, lang, threshold) {
  const delay = delayLabel(departure, lang);
  const clock = formatClock(departure.cancelled ? departure.scheduled : departure.expected);
  return {
    title: truncate(lineLabel(departure), 60),
    subtitle: delay ? `${clock} · ${delay}` : `${clock} · ${t(lang, 'scheduled_only')}`,
    badge: {
      text: truncate(departure.cancelled ? t(lang, 'cancelled') : waitLabel(departure, lang), 16),
      color: departureColor(departure, threshold),
    },
  };
}

function alertItem(alert, lang) {
  const url = pickTranslation(alert.url, lang);
  const item = {
    title: truncate(pickTranslation(alert.header, lang) || t(lang, 'widget_disruptions'), 60),
    badge: {
      text: truncate(t(lang, effectKey(alert.effect)), 16),
      color: alert.effect === 1 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.WARNING,
    },
    description: truncate(pickTranslation(alert.description, lang), 2000),
  };
  if (alert.lines.length > 0) {
    item.subtitle = truncate(t(lang, 'widget_lines', { lines: alert.lines.join(', ') }), 60);
  }
  if (/^https:\/\//.test(url)) {
    item.links = [{ url, label: t(lang, 'widget_details') }];
  }
  return item;
}

const textContent = (lang, key) => ({
  ttl_seconds: 60,
  components: [{ type: 'text', text: t(lang, key) }],
});

/** The snapshot of the stop a widget instance shows, or a message content. */
function snapshotOf(service, device, lang) {
  if (!device) {
    return { content: textContent(lang, 'widget_choose_stop') };
  }
  const entry = service.entryOf(device);
  if (!entry) {
    return { content: textContent(lang, 'widget_unknown_stop') };
  }
  if (!service.ready) {
    return { content: textContent(lang, 'action_not_ready') };
  }
  return { entry, snapshot: service.snapshots.get(device) ?? service.snapshot(entry) };
}

export const WIDGETS = {
  [NEXT_DEPARTURES_WIDGET]: {
    async get(gladys, { settings = {}, language, service }) {
      logger.debug(`onWidgetGet <- ${NEXT_DEPARTURES_WIDGET}`);
      const lang = language ?? service.config.language;
      const { content, entry, snapshot } = snapshotOf(service, settings.device, lang);
      if (content) {
        return content;
      }
      const ids = stopIds(gladys, entry);
      const threshold = service.config.delay_threshold;
      const components = [
        {
          type: 'text',
          variant: 'heading',
          text: truncate(snapshot.stop?.name ?? entry.stopId, 40),
        },
        // Live tiles: they follow the published states, no refresh needed.
        {
          type: 'value',
          label: tAll('widget_next'),
          icon: 'clock',
          device_feature: ids.feature(FEATURES.NEXT),
        },
        {
          type: 'value',
          label: tAll('widget_delay'),
          icon: 'alert-circle',
          device_feature: ids.feature(FEATURES.DELAY),
        },
        {
          type: 'value',
          label: tAll('widget_disruptions'),
          icon: 'alert-triangle',
          device_feature: ids.feature(FEATURES.DISRUPTIONS),
        },
      ];
      if (snapshot.departures.length > 0) {
        components.push({
          type: 'card-list',
          display: 'list',
          items: snapshot.departures.slice(0, 8).map((d) => departureItem(d, lang, threshold)),
        });
      } else {
        components.push({
          type: 'text',
          text: t(lang, 'no_departure', { n: service.config.horizon_minutes }),
        });
      }
      components.push(
        {
          type: 'status',
          items: [
            {
              label: t(lang, 'widget_source'),
              icon: 'radio',
              value: truncate(
                snapshot.realtime
                  ? t(lang, 'widget_realtime', { clock: formatClock(snapshot.realtimeAt) })
                  : t(lang, 'widget_timetable_only'),
                40,
              ),
              color: snapshot.realtime ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
            },
            {
              label: t(lang, 'widget_disruptions'),
              icon: 'alert-triangle',
              value: truncate(
                snapshot.alerts.length > 0
                  ? t(lang, 'disruptions_count', { n: snapshot.alerts.length })
                  : t(lang, 'disruptions_none'),
                40,
              ),
              color: snapshot.alerts.length > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
            },
          ],
        },
        {
          type: 'button',
          label: tAll('widget_refresh'),
          icon: 'refresh-cw',
          style: 'secondary',
          action: { key: ACTIONS.REFRESH },
        },
      );
      // The countdown moves every minute: the service nudges the widget when
      // the list changes, the TTL is a safety net.
      return { ttl_seconds: 60, components };
    },

    // The refresh button forces a real-time read, within the quota.
    async action(gladys, { actionKey, service }) {
      logger.info(`onWidgetAction <- ${NEXT_DEPARTURES_WIDGET}.${actionKey}`);
      if (actionKey !== ACTIONS.REFRESH) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      if (!service.realtime.canCall()) {
        const at = service.realtime.cached(FEEDS.TRIP_UPDATES)?.fetchedAt;
        return tAll('widget_refresh_quota', { clock: at ? formatClock(at) : '--:--' });
      }
      await service.tick({ forceRealtime: true });
      return tAll('widget_refreshed');
    },
  },

  [LINE_DISRUPTIONS_WIDGET]: {
    async get(gladys, { settings = {}, language, service }) {
      logger.debug(`onWidgetGet <- ${LINE_DISRUPTIONS_WIDGET}`);
      const lang = language ?? service.config.language;
      if (!service.ready) {
        return textContent(lang, 'action_not_ready');
      }
      const entries = settings.device
        ? [service.entryOf(settings.device)].filter(Boolean)
        : service.entries;
      const lines = parseLines(settings.line);
      const byId = new Map();
      for (const entry of entries) {
        const snapshot = service.snapshots.get(service.deviceId(entry)) ?? service.snapshot(entry);
        for (const alert of snapshot.alerts) {
          if (lines.length > 0 && !alert.lines.some((line) => lines.includes(line.toUpperCase()))) {
            continue;
          }
          const known = byId.get(alert.id);
          byId.set(alert.id, {
            ...alert,
            lines: [...new Set([...(known?.lines ?? []), ...alert.lines])],
          });
        }
      }
      const alerts = [...byId.values()];
      if (alerts.length === 0) {
        return {
          ttl_seconds: 300,
          components: [{ type: 'text', text: t(lang, 'widget_no_disruption') }],
        };
      }
      return {
        ttl_seconds: 300,
        components: [
          {
            type: 'card-list',
            display: 'list',
            items: alerts.slice(0, 8).map((alert) => alertItem(alert, lang)),
          },
        ],
      };
    },
  },
};

/** Ask the core to re-pull every widget now (rate-limited core-side). */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
