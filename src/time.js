// -----------------------------------------------------------------------------
// Time helpers in the timezone of the TEC network (Europe/Brussels).
//
// GTFS times are counted from "noon minus 12 hours" of the service day, and
// go past 24:00:00 for the trips running after midnight: a departure is the
// pair (service date, seconds), never a wall-clock time alone.
// -----------------------------------------------------------------------------

export const TIMEZONE = 'Europe/Brussels';

const DAY_MS = 24 * 60 * 60 * 1000;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function zonedParts(epochMs) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(new Date(epochMs)).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of Brussels from UTC at an instant, in milliseconds. */
function offsetAt(epochMs) {
  const p = zonedParts(epochMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Service date `YYYYMMDD` of an instant, in Brussels. */
export function serviceDate(epochMs) {
  const p = zonedParts(epochMs);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

/** The service date `days` days after `date` (`YYYYMMDD`, may be negative). */
export function addDays(date, days) {
  const utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
  );
  return serviceDate(utc + days * DAY_MS + 12 * 60 * 60 * 1000);
}

/** Day of the week of a service date, 0 = Monday ... 6 = Sunday (GTFS order). */
export function weekday(date) {
  const utc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
  );
  return (new Date(utc).getUTCDay() + 6) % 7;
}

/**
 * Epoch (ms) of the origin of a service day: noon of that date in Brussels,
 * minus 12 hours. Equal to local midnight except on the two DST change days,
 * where GTFS wants exactly this.
 */
export function serviceDayStart(date) {
  const noonUtc = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    12,
  );
  return noonUtc - offsetAt(noonUtc) - 12 * 60 * 60 * 1000;
}

/** Seconds of a GTFS `HH:MM:SS` time (hours may exceed 23). */
export function parseGtfsTime(text) {
  const match = /^\s*(\d{1,3}):(\d{2}):(\d{2})\s*$/.exec(text ?? '');
  if (!match) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** `HH:MM` wall-clock time of an instant, in Brussels. */
export function formatClock(epochMs) {
  const p = zonedParts(epochMs);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Whole minutes from `now` to `epochMs`, never negative. */
export function minutesUntil(epochMs, now) {
  return Math.max(0, Math.floor((epochMs - now) / 60_000));
}
