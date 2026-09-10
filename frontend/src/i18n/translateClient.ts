"use client";

/**
 * Dynamic, on-demand translation client.
 *
 * There is deliberately no per-language dictionary file here (no hi.json,
 * mr.json, es.json, ...). English (`en.json`) stays as the single source
 * of truth for UI copy, and every other language is produced at runtime by
 * calling a live machine-translation endpoint — see I18nProvider.tsx for
 * the caching layer that makes repeat switches instant.
 *
 * Speed: translating ~130 short strings one request at a time is what made
 * the first switch to a new language slow. Instead we pack many strings
 * into a single request (joined by a marker the translator won't touch),
 * split the result back apart, and only fall back to one-by-one requests
 * for the rare batch where that split doesn't line up cleanly. That turns
 * ~130 network round trips into a handful of them.
 */

const TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

// How many strings we try to translate in a single request. Kept small
// enough to stay well under URL length limits for typical short UI copy.
const BATCH_SIZE = 40;
// How many requests (batches, or individual fallback calls) run at once.
const CONCURRENCY = 8;
// A separator unlikely to appear in UI copy and unlikely to be reworded by
// a translator, used to glue many strings into one request and split them
// back apart afterwards.
const BATCH_SEPARATOR = " || ";

// Matches our own `{{varName}}` interpolation tokens (see I18nProvider's
// `interpolate`). We swap these out before sending text to the translator
// and put them back afterwards so a machine translation never mangles a
// placeholder like {{name}}.
const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

function protectPlaceholders(text: string): { safeText: string; restore: (translated: string) => string } {
  const tokens: string[] = [];
  const safeText = text.replace(PLACEHOLDER_PATTERN, (match) => {
    tokens.push(match);
    return `[[${tokens.length - 1}]]`;
  });
  const restore = (translated: string) =>
    translated.replace(/\[\[\s*(\d+)\s*\]\]/g, (_, i) => tokens[Number(i)] ?? "");
  return { safeText, restore };
}

async function fetchTranslation(text: string, target: string, source: string): Promise<string> {
  const params = new URLSearchParams({ client: "gtx", sl: source, tl: target, dt: "t", q: text });
  const res = await fetch(`${TRANSLATE_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`Translation request failed with status ${res.status}`);
  const data = await res.json();
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  return segments.map((segment: unknown[]) => (Array.isArray(segment) ? segment[0] ?? "" : "")).join("");
}

async function translateOne(text: string, target: string, source: string, attempt = 0): Promise<string> {
  if (!text || !text.trim()) return text;
  const { safeText, restore } = protectPlaceholders(text);
  try {
    const translated = await fetchTranslation(safeText, target, source);
    return translated ? restore(translated) : text;
  } catch {
    if (attempt < 1) return translateOne(text, target, source, attempt + 1);
    // Never let a translation failure break the UI: keep the original text.
    return text;
  }
}

/**
 * Translates a whole batch of strings (already known to be non-empty) in
 * one network request, joined by BATCH_SEPARATOR. Returns null (rather
 * than throwing) if anything about the round trip looks unreliable — a
 * request failure, or the translator returning a different number of
 * pieces than we sent — so the caller can fall back to translating that
 * batch's strings individually instead of risking misaligned text.
 */
async function translateJoinedBatch(texts: string[], target: string, source: string): Promise<string[] | null> {
  const protections = texts.map(protectPlaceholders);
  const joined = protections.map((p) => p.safeText).join(BATCH_SEPARATOR);

  try {
    const translatedJoined = await fetchTranslation(joined, target, source);
    const parts = translatedJoined.split(/\s*\|\s*\|\s*/).map((p) => p.trim());
    if (parts.length !== texts.length) return null;
    return parts.map((part, i) => protections[i].restore(part) || texts[i]);
  } catch {
    return null;
  }
}

async function withConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    const current = cursor++;
    if (current >= items.length) return;
    results[current] = await worker(items[current]);
    return runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

/**
 * Translates a batch of strings from `source` to `target`. Strings are
 * packed BATCH_SIZE at a time into single requests (run with bounded
 * concurrency), with automatic per-string fallback for any batch whose
 * result doesn't split back apart cleanly.
 */
export async function translateBatch(texts: string[], target: string, source = "en"): Promise<string[]> {
  if (!target || target === source || texts.length === 0) return texts;

  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    chunks.push(texts.slice(i, i + BATCH_SIZE));
  }

  const chunkResults = await withConcurrency(chunks, CONCURRENCY, async (chunk) => {
    const joined = await translateJoinedBatch(chunk, target, source);
    if (joined) return joined;
    // Fall back to translating this chunk's strings one at a time.
    return withConcurrency(chunk, CONCURRENCY, (text) => translateOne(text, target, source));
  });

  return chunkResults.flat();
}
