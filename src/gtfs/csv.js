// -----------------------------------------------------------------------------
// Streaming CSV reader for GTFS files.
//
// GTFS files are plain RFC 4180 CSV with a header line. Records never span
// lines in practice, so the reader works line by line (readline) and only
// falls back to the quote-aware parser for the lines that hold a quote — the
// fast path matters for the millions of lines of stop_times.txt.
// -----------------------------------------------------------------------------

import { createInterface } from 'node:readline';

/** Split one CSV line into its fields. */
export function parseCsvLine(line) {
  if (!line.includes('"')) {
    return line.split(',');
  }
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Iterate over the records of a CSV stream.
 *
 * Yields arrays of fields; `columns` maps a header name to its index, so the
 * caller reads `record[columns.stop_id]` without building an object per line.
 *
 * @param {import('node:stream').Readable} stream
 * @param {(columns: Record<string, number>) => void} onHeader
 */
export async function* readCsv(stream, onHeader) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header = true;
  for await (const rawLine of lines) {
    if (header) {
      const names = parseCsvLine(rawLine.replace(/^\uFEFF/, '')).map((name) => name.trim());
      onHeader(Object.fromEntries(names.map((name, index) => [name, index])));
      header = false;
      continue;
    }
    if (rawLine.length === 0) {
      continue;
    }
    yield parseCsvLine(rawLine);
  }
}
