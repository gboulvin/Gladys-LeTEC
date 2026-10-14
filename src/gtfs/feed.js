// -----------------------------------------------------------------------------
// Download and cache of the TEC timetable (GTFS static).
//
// Source: the TEC open data server (CC0), refreshed every night. The archive
// (~80 MB) is downloaded to /data — the only writable place of the container —
// with a conditional request, so an unchanged timetable costs a 304. The index
// built from it (src/gtfs/timetable.js) is cached next to it as JSON, so a
// restart is instant and never re-reads the archive.
// -----------------------------------------------------------------------------

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TIMETABLE_FORMAT } from './timetable.js';

export const GTFS_URL = 'https://opendata.tec-wl.be/Current%20GTFS/TEC-GTFS.zip';

const ARCHIVE_FILE = 'tec-gtfs.zip';
const META_FILE = 'tec-gtfs.json';
const INDEX_FILE = 'timetable.json';
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function archivePath(dataDir) {
  return join(dataDir, ARCHIVE_FILE);
}

/**
 * Download the archive when it changed on the server.
 * @returns {Promise<{ path: string, changed: boolean, version: string }>}
 *   `version` identifies the archive content (ETag or Last-Modified).
 */
export async function downloadFeed({
  dataDir,
  fetch = globalThis.fetch,
  url = GTFS_URL,
  force = false,
}) {
  await mkdir(dataDir, { recursive: true });
  const path = archivePath(dataDir);
  const metaPath = join(dataDir, META_FILE);
  const meta = (await readJson(metaPath)) ?? {};
  const haveArchive = await exists(path);

  const headers = {};
  if (haveArchive && !force) {
    if (meta.etag) headers['If-None-Match'] = meta.etag;
    if (meta.lastModified) headers['If-Modified-Since'] = meta.lastModified;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (response.status === 304 && haveArchive) {
    return { path, changed: false, version: meta.version };
  }
  if (!response.ok || !response.body) {
    throw new Error(`Timetable download failed (HTTP ${response.status})`);
  }

  // Write next to the target, then rename: a cut download never replaces a
  // good archive.
  const partial = `${path}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    await rename(partial, path);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }
  const etag = response.headers.get('etag') ?? '';
  const lastModified = response.headers.get('last-modified') ?? '';
  const version = etag || lastModified || new Date().toISOString();
  await writeFile(
    metaPath,
    JSON.stringify({ etag, lastModified, version, downloadedAt: new Date().toISOString() }),
  );
  return { path, changed: true, version };
}

/** The archive version recorded at the last download, or null. */
export async function archiveVersion(dataDir) {
  if (!(await exists(archivePath(dataDir)))) {
    return null;
  }
  return (await readJson(join(dataDir, META_FILE)))?.version ?? null;
}

/** The cached timetable index, or null when absent or of an older format. */
export async function loadIndex(dataDir) {
  const index = await readJson(join(dataDir, INDEX_FILE));
  if (!index || index.data?.format !== TIMETABLE_FORMAT) {
    return null;
  }
  return index; // { version, data }
}

export async function saveIndex(dataDir, version, data) {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, INDEX_FILE);
  await writeFile(`${path}.part`, JSON.stringify({ version, data }));
  await rename(`${path}.part`, path);
}
