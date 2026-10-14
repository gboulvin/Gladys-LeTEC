// -----------------------------------------------------------------------------
// The TEC service: owns the configuration, the timetable, the real-time
// client and the refresh loop, and publishes everything to Gladys.
//
//   start()    on every (re)connection: config, timetable, devices, loop;
//   tick()     every 30 s: snapshots of the monitored stops (timetable +
//              real-time when due), states, scene events, widget nudges;
//   stop()     on disconnection and shutdown.
//
// Everything that talks to Gladys goes through the `gladys` client passed
// in, so the tests run the whole service against the SDK's fake Gladys.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseStops } from './config.js';
import { tAll } from './i18n.js';
import { Timetable, buildTimetable } from './gtfs/timetable.js';
import { archivePath, archiveVersion, downloadFeed, loadIndex, saveIndex } from './gtfs/feed.js';
import { FEEDS, RealtimeClient, cancelledTrips } from './realtime.js';
import { alertsForStop, computeDepartures, nextScheduledDeparture } from './departures.js';
import { buildStopDevice, buildStopStates, stopIds } from './stopDevice.js';
import { TriggerTracker } from './triggers.js';

const logger = createLogger({ name: 'tec' });

export const TICK_MS = 30_000;
// The TEC server publishes a new timetable every night: check a few times a
// day, a 304 costs nothing.
export const TIMETABLE_CHECK_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;

export class TecService {
  /**
   * @param {object} options
   * @param {object} options.gladys - GladysIntegration (or the SDK fake)
   * @param {string} [options.dataDir] - writable directory (/data in the container)
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   * @param {(data: object) => Promise<object>} [options.build] - timetable indexer
   */
  constructor({
    gladys,
    dataDir = '/data',
    fetch = (...args) => globalThis.fetch(...args),
    now = Date.now,
    build = buildTimetable,
  }) {
    this.gladys = gladys;
    this.dataDir = dataDir;
    this.fetch = fetch;
    this.now = now;
    this.build = build;
    this.realtime = new RealtimeClient({ fetch, now });
    this.tracker = new TriggerTracker();
    this.config = normalizeConfig();
    this.entries = [];
    this.invalidStops = [];
    this.timetable = null;
    this.timetableVersion = null;
    this.timetableError = null;
    this.loading = null;
    this.snapshots = new Map();
    this.timers = [];
    this.onChange = () => {};
  }

  // --- Configuration --------------------------------------------------------

  /** Apply a (raw) configuration. Resolves whether the stop list changed. */
  configure(rawConfig) {
    const previous = this.entries.map((entry) => entry.key).join(',');
    this.config = normalizeConfig(rawConfig);
    const { entries, invalid } = parseStops(this.config.stops);
    this.entries = entries;
    this.invalidStops = invalid;
    this.realtime.setApiKey(this.config.api_key);
    const changed = previous !== entries.map((entry) => entry.key).join(',');
    if (changed) {
      for (const key of this.snapshots.keys()) {
        if (!entries.some((entry) => this.deviceId(entry) === key)) {
          this.snapshots.delete(key);
          this.tracker.forget(key);
        }
      }
    }
    return changed;
  }

  deviceId(entry) {
    return stopIds(this.gladys, entry).device;
  }

  entryOf(deviceExternalId) {
    return this.entries.find((entry) => this.deviceId(entry) === deviceExternalId) ?? null;
  }

  stopIdList() {
    return [...new Set(this.entries.map((entry) => entry.stopId))];
  }

  // --- Timetable ------------------------------------------------------------

  get ready() {
    return this.timetable !== null && this.timetable.covers(this.stopIdList());
  }

  /**
   * Make sure the timetable covers the monitored stops. Single flight: a call
   * while one runs waits for it, then runs again if still needed.
   * @param {{ checkUpdate?: boolean }} options - also ask the server for a newer archive
   * @returns {Promise<{ updated: boolean, version: string|null }>}
   */
  async ensureTimetable({ checkUpdate = false } = {}) {
    while (this.loading) {
      await this.loading.catch(() => {});
    }
    if (this.ready && !checkUpdate) {
      return { updated: false, version: this.timetableVersion };
    }
    this.loading = this.loadTimetable({ checkUpdate });
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async loadTimetable({ checkUpdate }) {
    const stopIdList = this.stopIdList();
    try {
      // 1. The cached index, when it covers the stops: instant restart.
      if (!this.timetable) {
        const index = await loadIndex(this.dataDir);
        if (index) {
          this.timetable = new Timetable(index.data);
          this.timetableVersion = index.version;
        }
      }
      if (this.ready && !checkUpdate) {
        return { updated: false, version: this.timetableVersion };
      }
      // 2. A newer archive, or none on disk yet.
      let version = await archiveVersion(this.dataDir);
      let changed = false;
      if (checkUpdate || version === null) {
        await this.reportStatus();
        ({ version, changed } = await downloadFeed({ dataDir: this.dataDir, fetch: this.fetch }));
      }
      // 3. Re-index when the archive changed or new stops appeared.
      if (changed || !this.ready || version !== this.timetableVersion) {
        logger.info(`Indexing the timetable for ${stopIdList.length} stop(s)...`);
        const started = this.now();
        const data = await this.build(archivePath(this.dataDir), stopIdList);
        this.timetable = new Timetable(data);
        this.timetableVersion = version;
        await saveIndex(this.dataDir, version, data);
        logger.info(`Timetable ${data.feedVersion} indexed in ${this.now() - started} ms`);
        changed = true;
      }
      this.timetableError = null;
      return { updated: changed, version: this.timetableVersion };
    } catch (err) {
      this.timetableError = err;
      logger.error('Timetable loading failed', err);
      throw err;
    }
  }

  // --- Snapshots ------------------------------------------------------------

  /** Real-time trip updates, when fresh enough to trust. */
  freshTripUpdates() {
    const cached = this.realtime.cached(FEEDS.TRIP_UPDATES);
    if (!cached?.data) {
      return null;
    }
    const interval = this.realtime.intervalFor(FEEDS.TRIP_UPDATES, this.config.refresh_interval);
    const maxAge = (2 * interval + 120) * 1000;
    return this.now() - cached.fetchedAt <= maxAge ? cached.data : null;
  }

  alerts() {
    return this.realtime.cached(FEEDS.ALERTS)?.data ?? null;
  }

  /**
   * Departures, next departure and alerts of one monitored entry.
   * @param {{ stopId: string, lines: string[], key: string }} entry
   * @param {{ lines?: string[] }} [override] - another line filter (scene action)
   */
  snapshot(entry, { lines = entry.lines } = {}) {
    const now = this.now();
    const horizonMs = this.config.horizon_minutes * 60_000;
    const tripUpdates = this.freshTripUpdates();
    const alerts = this.alerts();
    const cancelled = cancelledTrips(alerts);
    const departures = computeDepartures({
      timetable: this.timetable,
      tripUpdates,
      cancelled,
      stopId: entry.stopId,
      lines,
      now,
      horizonMs,
    });
    const running = departures.filter((departure) => !departure.cancelled);
    let [next, following] = running;
    if (!next) {
      next = nextScheduledDeparture({
        timetable: this.timetable,
        stopId: entry.stopId,
        lines,
        now,
        fromMs: now + horizonMs,
        cancelled,
      });
    }
    if (next && !following) {
      following = nextScheduledDeparture({
        timetable: this.timetable,
        stopId: entry.stopId,
        lines,
        now,
        fromMs: Math.max(next.scheduled, next.expected) + 1000,
        cancelled,
      });
    }
    return {
      entry,
      stop: this.timetable.stop(entry.stopId),
      departures,
      next: next ?? null,
      following: following ?? null,
      alerts: alertsForStop(
        alerts,
        { stopId: entry.stopId, routes: this.timetable.routesAt(entry.stopId, lines) },
        now,
      ),
      alertsLoaded: alerts !== null,
      realtime: tripUpdates !== null,
      realtimeAt: this.realtime.cached(FEEDS.TRIP_UPDATES)?.fetchedAt ?? null,
      computedAt: now,
    };
  }

  // --- Publication ----------------------------------------------------------

  buildDevices() {
    return (
      this.entries
        // A stop the timetable does not know is reported in the status, and
        // gets no device.
        .filter((entry) => !this.ready || this.timetable.stop(entry.stopId))
        .map((entry) =>
          buildStopDevice(
            this.gladys,
            entry,
            this.timetable?.stop(entry.stopId) ?? null,
            this.config.language,
          ),
        )
    );
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(this.buildDevices());
  }

  /** Application-level status of the Configuration screen. */
  async reportStatus() {
    let status;
    if (this.realtime.lastError?.code === 'unauthorized' && this.realtime.hasKey) {
      status = [false, tAll('status_key_refused')];
    } else if (this.timetableError) {
      status = [false, tAll('status_timetable_error', { message: this.timetableError.message })];
    } else if (this.entries.length === 0) {
      status = [false, tAll('status_no_stops')];
    } else if (!this.ready) {
      status = [false, tAll('status_loading')];
    } else {
      const unknown = this.entries
        .filter((entry) => !this.timetable.stop(entry.stopId))
        .map((entry) => entry.stopId);
      const ignored = [...this.invalidStops, ...unknown];
      status =
        ignored.length > 0
          ? [true, tAll('status_invalid_stops', { list: ignored.join(', ') })]
          : [true];
    }
    await this.gladys.setConnectionStatus(...status);
  }

  /** The cloud badge of every stop, degraded without fresh real-time. */
  async publishTransports() {
    if (this.entries.length === 0) {
      return;
    }
    let degraded = null;
    if (!this.realtime.hasKey) {
      degraded = tAll('transport_no_key');
    } else if (this.realtime.lastError && !this.freshTripUpdates()) {
      degraded = tAll('transport_realtime_down');
    }
    const key = JSON.stringify(degraded);
    if (key === this.lastTransports) {
      return;
    }
    await this.gladys.publishTransports(
      this.entries.map((entry) => ({
        external_id: this.deviceId(entry),
        transport: 'cloud',
        ...(degraded ? { degraded: true, message: degraded } : {}),
      })),
    );
    this.lastTransports = key;
  }

  /** Whether a monitored stop has a departure in the horizon. */
  hasUpcomingDepartures() {
    const now = this.now();
    const horizonMs = this.config.horizon_minutes * 60_000;
    return this.entries.some(
      (entry) =>
        this.timetable.scheduledDepartures(
          entry.stopId,
          now - 30 * 60_000,
          now + horizonMs,
          entry.lines,
        ).length > 0,
    );
  }

  /** Read the real-time feeds when due. Errors are logged, never thrown. */
  async refreshRealtime({ force = false } = {}) {
    const options = { refreshInterval: this.config.refresh_interval, force };
    // No departure ahead (night): the trip updates would say nothing.
    if (force || this.hasUpcomingDepartures()) {
      await this.realtime.get(FEEDS.TRIP_UPDATES, options).catch((err) => {
        logger.warn(`Trip updates unavailable: ${err.message}`);
      });
    }
    await this.realtime.get(FEEDS.ALERTS, options).catch((err) => {
      logger.warn(`Service alerts unavailable: ${err.message}`);
    });
  }

  /**
   * One refresh: real-time when due, then states, events and widgets.
   * @param {{ forceRealtime?: boolean }} [options]
   */
  async tick({ forceRealtime = false } = {}) {
    if (!this.ready || this.entries.length === 0) {
      return;
    }
    const previousError = this.realtime.lastError?.code;
    await this.refreshRealtime({ force: forceRealtime });

    const states = [];
    const events = [];
    const now = this.now();
    for (const entry of this.entries) {
      if (!this.timetable.stop(entry.stopId)) {
        continue;
      }
      const device = this.deviceId(entry);
      const snapshot = this.snapshot(entry);
      this.snapshots.set(device, snapshot);
      states.push(
        ...buildStopStates(
          this.gladys,
          entry,
          snapshot,
          this.config.language,
          this.config.horizon_minutes,
        ),
      );
      events.push(...this.tracker.evaluate(device, snapshot, this.config, now));
    }

    if (states.length > 0) {
      // Heartbeat: a stable value stays recently dated in Gladys.
      await this.gladys.publishChangedStates(states, { heartbeat: 30 * 60 * 1000 });
    }
    for (const { key, data } of events) {
      await this.gladys.publishSceneEvent(key, data).catch((err) => {
        logger.error(`Scene event ${key} refused`, err);
      });
    }
    await this.publishTransports();
    if (previousError !== this.realtime.lastError?.code) {
      await this.reportStatus();
    }
    // Nudge the widgets only when what they show changed.
    const signature = JSON.stringify(
      [...this.snapshots.values()].map((snapshot) => [
        snapshot.departures.map((d) => [d.key, d.minutes, d.delayMinutes, d.cancelled]),
        snapshot.alerts.map((alert) => alert.id),
        snapshot.realtimeAt,
      ]),
    );
    if (signature !== this.signature) {
      this.signature = signature;
      this.onChange();
    }
  }

  // --- Lifecycle ------------------------------------------------------------

  /** (Re)connection: read the config, load the timetable, start the loop. */
  async start() {
    this.stop();
    this.configure(await this.gladys.getConfig());
    await this.reportStatus();
    await this.publishDevices();
    this.schedule();
    // Loaded even without a monitored stop: the stop search needs it.
    await this.loadAndRefresh();
  }

  /** Load the timetable if needed, then publish and refresh. A failure is
   * reported in the Configuration screen and retried by the loop. */
  async loadAndRefresh() {
    this.lastLoadAttempt = this.now();
    try {
      await this.ensureTimetable();
    } catch {
      await this.reportStatus();
      return;
    }
    await this.publishDevices(); // with the stop names
    await this.reportStatus();
    await this.tick();
  }

  /** A new configuration from the user. */
  async reconfigure(rawConfig) {
    const stopsChanged = this.configure(rawConfig);
    this.lastTransports = undefined;
    await this.reportStatus();
    if (stopsChanged || !this.ready) {
      await this.publishDevices();
      await this.loadAndRefresh();
    } else {
      await this.publishDevices();
      await this.tick();
    }
  }

  schedule() {
    const guard = (label, task) => () =>
      task().catch((err) => logger.error(`${label} failed`, err));
    this.timers.push(
      setInterval(
        guard('Refresh', async () => {
          // A timetable that failed to load is retried every 10 minutes.
          if (
            !this.ready &&
            !this.loading &&
            this.now() - (this.lastLoadAttempt ?? 0) >= RETRY_MS
          ) {
            await this.loadAndRefresh();
            return;
          }
          await this.tick();
        }),
        TICK_MS,
      ),
    );
    this.timers.push(
      setInterval(
        guard('Timetable update', async () => {
          const { updated } = await this.ensureTimetable({ checkUpdate: true });
          if (updated) {
            await this.publishDevices();
            await this.tick();
          }
        }),
        TIMETABLE_CHECK_MS,
      ),
    );
  }

  stop() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
  }
}
