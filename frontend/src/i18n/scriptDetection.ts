/**
 * Rough Unicode-block heuristic for "does this text already look like it's
 * written in the target language's script?" Used by AutoTranslate to avoid
 * re-translating text that a t() call already put in the right language
 * (e.g. a dashboard label already rendered in Hindi shouldn't get sent
 * through the translator again as if it were English).
 *
 * This is intentionally approximate — for Latin-script targets (Spanish,
 * French, etc.) there's no reliable way to tell "already-translated" text
 * apart from English by script alone, so those return null and every pass
 * just re-checks the text (harmless, just a little redundant work).
 */
const SCRIPT_RANGES: Record<string, RegExp> = {
  hi: /[\u0900-\u097F]/,
  mr: /[\u0900-\u097F]/,
  ne: /[\u0900-\u097F]/,
  sa: /[\u0900-\u097F]/,
  kok: /[\u0900-\u097F]/,
  mai: /[\u0900-\u097F]/,
  bn: /[\u0980-\u09FF]/,
  as: /[\u0980-\u09FF]/,
  gu: /[\u0A80-\u0AFF]/,
  pa: /[\u0A00-\u0A7F]/,
  or: /[\u0B00-\u0B7F]/,
  ta: /[\u0B80-\u0BFF]/,
  te: /[\u0C00-\u0C7F]/,
  kn: /[\u0C80-\u0CFF]/,
  ml: /[\u0D00-\u0D7F]/,
  si: /[\u0D80-\u0DFF]/,
  ur: /[\u0600-\u06FF]/,
  ar: /[\u0600-\u06FF]/,
  fa: /[\u0600-\u06FF]/,
  sd: /[\u0600-\u06FF]/,
  he: /[\u0590-\u05FF]/,
  th: /[\u0E00-\u0E7F]/,
  km: /[\u1780-\u17FF]/,
  my: /[\u1000-\u109F]/,
  "zh-CN": /[\u4E00-\u9FFF]/,
  "zh-TW": /[\u4E00-\u9FFF]/,
  ja: /[\u3040-\u30FF\u4E00-\u9FFF]/,
  ko: /[\uAC00-\uD7AF]/,
  el: /[\u0370-\u03FF]/,
  ru: /[\u0400-\u04FF]/,
  uk: /[\u0400-\u04FF]/,
  am: /[\u1200-\u137F]/,
};

export function getScriptPattern(languageCode: string): RegExp | null {
  return SCRIPT_RANGES[languageCode] ?? null;
}

/** True if the string already looks like it's mostly written in the target script. */
export function looksAlreadyInLanguage(text: string, languageCode: string): boolean {
  const pattern = getScriptPattern(languageCode);
  if (!pattern) return false;
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  const matched = text.match(new RegExp(pattern.source, "gu"));
  return (matched?.length ?? 0) / letters.length > 0.3;
}

export function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text);
}
