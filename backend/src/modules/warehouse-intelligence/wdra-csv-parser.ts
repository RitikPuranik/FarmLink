import fs from "node:fs";
import readline from "node:readline";

// ---------------------------------------------------------------------------
// Same quote-aware column-splitting convention as
// modules/market-data/import-market-data.ts's csvColumns — kept as its
// own small local copy rather than a shared cross-module helper, since
// the two importers have no other reason to depend on each other and
// this function is a handful of lines.
// ---------------------------------------------------------------------------

/** Splits one CSV line into cells, honoring double-quoted fields (with
 * "" as an escaped quote) so a comma inside a quoted Address field, for
 * instance, is never mistaken for a column boundary. */
export function csvColumns(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

/**
 * Streams a CSV file's data rows keyed by its header row. The header row
 * (first non-blank line) is read once and used as every subsequent row's
 * keys; a row with fewer cells than headers gets `undefined` for the
 * missing trailing columns rather than throwing — wdra-record-mapper.ts's
 * own `clean()` already treats `undefined` exactly like an empty cell, so
 * a short/malformed row degrades to missing-field warnings through the
 * normal validation path instead of aborting the whole import.
 */
export async function* readCsvRows(filePath: string): AsyncGenerator<Record<string, string | undefined>> {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let headers: string[] | undefined;
  for await (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const cells = csvColumns(line);
    if (!headers) {
      // Strip a UTF-8 BOM if the export was saved with one (common for
      // Excel-authored CSVs) so "WH ID" isn't accidentally keyed as
      // "\uFEFFWH ID" on the very first header.
      headers = cells.map((header) => header.replace(/^\uFEFF/, "").trim());
      continue;
    }
    yield Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  }
}
