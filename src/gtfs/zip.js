// -----------------------------------------------------------------------------
// Minimal ZIP reader for the GTFS archive.
//
// The TEC timetable is a ~80 MB archive whose stop_times.txt inflates to more
// than 400 MB: it is read entry by entry, as a stream, straight from the file
// on disk — never loaded in memory. Only what GTFS archives use is supported:
// stored (0) or deflated (8) entries, with ZIP64 sizes and offsets.
// -----------------------------------------------------------------------------

import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createInflateRaw } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_U32 = 0xffffffff;

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** Read the ZIP64 extended sizes/offset of a central directory entry. */
function applyZip64Extra(entry, extra) {
  let position = 0;
  while (position + 4 <= extra.length) {
    const id = extra.readUInt16LE(position);
    const size = extra.readUInt16LE(position + 2);
    if (id === 0x0001) {
      let field = position + 4;
      for (const key of ['size', 'compressedSize', 'offset']) {
        if (entry[key] === MAX_U32) {
          entry[key] = Number(extra.readBigUInt64LE(field));
          field += 8;
        }
      }
      return;
    }
    position += 4 + size;
  }
}

/**
 * List the entries of a ZIP file.
 * @param {string} path
 * @returns {Promise<Map<string, { name: string, method: number, size: number, compressedSize: number, offset: number }>>}
 */
export async function readZipEntries(path) {
  const handle = await open(path, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    // The end of central directory record sits in the last 22 + 65535 bytes.
    const tailLength = Math.min(fileSize, 22 + 0xffff);
    const tail = await readAt(handle, fileSize - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) {
      throw new Error('Not a ZIP archive (no end of central directory)');
    }
    let count = tail.readUInt16LE(eocd + 10);
    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);

    const locator = eocd - 20;
    if (locator >= 0 && tail.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Offset = Number(tail.readBigUInt64LE(locator + 8));
      const record = await readAt(handle, zip64Offset, 56);
      if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
        throw new Error('Corrupted ZIP64 archive');
      }
      count = Number(record.readBigUInt64LE(32));
      directorySize = Number(record.readBigUInt64LE(40));
      directoryOffset = Number(record.readBigUInt64LE(48));
    }

    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries = new Map();
    let position = 0;
    for (let i = 0; i < count; i += 1) {
      if (directory.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
        throw new Error('Corrupted ZIP central directory');
      }
      const nameLength = directory.readUInt16LE(position + 28);
      const extraLength = directory.readUInt16LE(position + 30);
      const commentLength = directory.readUInt16LE(position + 32);
      const name = directory.toString('utf8', position + 46, position + 46 + nameLength);
      const entry = {
        name,
        method: directory.readUInt16LE(position + 10),
        compressedSize: directory.readUInt32LE(position + 20),
        size: directory.readUInt32LE(position + 24),
        offset: directory.readUInt32LE(position + 42),
      };
      const extraStart = position + 46 + nameLength;
      applyZip64Extra(entry, directory.subarray(extraStart, extraStart + extraLength));
      // GTFS files may sit in a sub-folder of the archive: index by base name.
      entries.set(name.split('/').pop(), entry);
      position = extraStart + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/**
 * Open one entry as a stream of its uncompressed bytes.
 * @param {string} path - ZIP file.
 * @param {{ name: string, method: number, compressedSize: number, offset: number }} entry
 * @returns {Promise<import('node:stream').Readable>}
 */
export async function openZipEntry(path, entry) {
  const handle = await open(path, 'r');
  let header;
  try {
    header = await readAt(handle, entry.offset, 30);
  } finally {
    await handle.close();
  }
  if (header.length < 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error(`Corrupted ZIP entry ${entry.name}`);
  }
  const dataStart = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  if (entry.compressedSize === 0) {
    return Readable.from([]);
  }
  const raw = createReadStream(path, {
    start: dataStart,
    end: dataStart + entry.compressedSize - 1,
    highWaterMark: 1 << 20,
  });
  if (entry.method === 0) {
    return raw;
  }
  if (entry.method !== 8) {
    raw.destroy();
    throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
  }
  const inflate = createInflateRaw();
  raw.on('error', (err) => inflate.destroy(err));
  return raw.pipe(inflate);
}
