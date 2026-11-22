/**
 * English-only language gate (S1, A06, UC10): deterministic script check +
 * stopword ratio. The gate runs after OCR and BEFORE any cleanup, so a
 * non-English screenshot is rejected with a clear message and nothing
 * further runs.
 *
 * The stopword list is the ~150 most common English function words, chosen
 * to avoid words that are also common in German/Spanish posts ("die",
 * "hat", "war" are excluded; "no" stays in — Spanish uses it, but the
 * measured ratios still separate cleanly; see the confusion-matrix test).
 */

export type LanguageRejectReason = 'script' | 'stopwords' | 'too-short' | 'ok';

export interface LanguageVerdict {
  isEnglish: boolean;
  reason: LanguageRejectReason;
  stopwordRatio: number;
  latinRatio: number;
  wordCount: number;
}

/** The user-facing rejection message (the app shows it verbatim; the e2e
 *  flow asserts it). Clear and kind: what happened, why, and what to do. */
export const NON_ENGLISH_MESSAGE =
  'PostClip reads posts written in English only for now. This screenshot looks like it is written in another language, so it was not processed.';

/** Below this share of common-English-word tokens, text is judged not-English.
 *  Measured on the fixtures: every English post >= 0.20, every German/Spanish
 *  post <= 0.033 — the threshold sits centered in that gap (see the
 *  confusion-matrix test and docs/evidence/S1/metrics.md). */
export const STOPWORD_THRESHOLD = 0.12;

/** Fewer word tokens than this cannot be judged confidently; fail closed. */
export const MIN_WORDS = 5;

/** Below this share of Latin-script letters the script check rejects. */
export const LATIN_SCRIPT_MIN = 0.85;

export const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'between', 'both', 'but', 'by',
  'can', 'did', 'do', 'does', 'doing', 'down', 'each', 'even', 'every', 'first',
  'for', 'from', 'further', 'get', 'got', 'had', 'has', 'have', 'he', 'her',
  'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'itself', 'just', 'last', 'like', 'made', 'make', 'many', 'me',
  'more', 'most', 'much', 'my', 'myself', 'new', 'no', 'not', 'now', 'of', 'on',
  'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she',
  'should', 'so', 'some', 'still', 'such', 'than', 'that', 'the', 'their',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to',
  'too', 'under', 'until', 'up', 'us', 'use', 'used', 'very', 'was', 'we',
  'well', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why',
  'will', 'with', 'within', 'without', 'work', 'would', 'you', 'your', 'yours',
  'yourself', 'yourselves',
  // Ultra-frequent English words beyond function words — chosen so the list
  // stays free of common German/Spanish words (no "die", "hat", "war",
  // "real", "no"-like collisions beyond the deliberate "no"/"was" above;
  // measured non-English ratios stay <= 0.033 on the fixtures).
  'again', 'against', 'anything', 'below', 'best', 'better', 'day', 'few',
  'find', 'full', 'good', 'great', 'help', 'high', 'know', 'large', 'life',
  'long', 'look', 'need', 'next', 'nothing', 'off', 'once', 'open', 'people',
  'read', 'right', 'small', 'something', 'think', 'thing', 'things', 'time',
  'true', 'want', 'way', 'week', 'world', 'year',
]);

export function detectEnglish(text: string): LanguageVerdict {
  const wordTokens = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’._-]*/gu) ?? [];
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) {
    // nothing readable at all — cannot be judged English; fail closed
    return { isEnglish: false, reason: 'too-short', stopwordRatio: 0, latinRatio: 0, wordCount: wordTokens.length };
  }
  const latin = text.match(/\p{Script=Latin}/gu) ?? [];
  const latinRatio = latin.length / letters.length;
  if (latinRatio < LATIN_SCRIPT_MIN) {
    return { isEnglish: false, reason: 'script', stopwordRatio: 0, latinRatio, wordCount: wordTokens.length };
  }
  if (wordTokens.length < MIN_WORDS) {
    return { isEnglish: false, reason: 'too-short', stopwordRatio: 0, latinRatio, wordCount: wordTokens.length };
  }
  const stopwordHits = wordTokens.filter((t) => ENGLISH_STOPWORDS.has(t)).length;
  const stopwordRatio = stopwordHits / wordTokens.length;
  const isEnglish = stopwordRatio >= STOPWORD_THRESHOLD;
  return { isEnglish, reason: isEnglish ? 'ok' : 'stopwords', stopwordRatio, latinRatio, wordCount: wordTokens.length };
}
