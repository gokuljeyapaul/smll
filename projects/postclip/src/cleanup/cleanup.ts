/**
 * Deterministic baseline cleanup (S1): remove UI-chrome lines from
 * normalized OCR text and repair line breaks — no model, no invention.
 * English-only by design: localized (non-English) chrome is not cleaned
 * because the language gate rejects those screenshots before cleanup ever
 * runs (A06, gate before cleanup in the pipeline).
 *
 * Rules (each pinned by cleanup.test.ts):
 *  - drop symbol-only lines (the '···' overflow menu, stray dashes);
 *  - drop reaction-count lines ('42 reactions · 9 comments', '8 reactions')
 *    in the separator variants OCR actually produces ('·', '-', ':-', ':');
 *  - drop the @handle·time meta line and the author header line directly
 *    above it (header zone = first 4 lines), including merged
 *    'Author @handle · 2h' lines;
 *  - drop action-word-only lines (Like/Comment/Share/Follow/Connect/
 *    Promoted/Sponsored/…);
 *  - repair line breaks: a line that does not end a sentence, followed by
 *    a lowercase-starting line, was one wrapped paragraph — rejoin with a
 *    space (de-hyphenate when the break split a word). List items ('1.',
 *    '2.') and new sentences never join.
 *
 * Everything else passes through VERBATIM — body content is never edited,
 * reordered or invented (the fabricated-token-rate metric is 0 by design).
 */

import { normalizeOcrLines } from '../ocr/normalize';

export interface CleanupResult {
  lines: string[];
  text: string;
  removedLines: string[];
}

/** English UI-furniture words; a line made ONLY of these is chrome. */
const ACTION_WORDS = new Set([
  'like', 'comment', 'share', 'react', 'reply', 'follow', 'connect', 'send',
  'repost', 'more', 'promoted', 'sponsored', 'suggested', 'recommended',
  'trending', 'save', 'copy', 'link',
]);

/** '42 reactions · 9 comments', '8 reactions', '12 reactions - 1 comment' */
const REACTION_LINE =
  /^[\d.,]+[kmb]?\s+(?:reactions?|likes?|comments?|reposts?|views?)(?:\s*[·•\-—:]+\s*[\d.,]+[kmb]?\s+(?:reactions?|likes?|comments?|reposts?))?$/i;

/** '@maya-builds · 2h', '@lukas-berger - 3 Std.', '@elena-ruiz:- 2h',
 *  '@jonasw : 1 Tag' — handle, a separator OCR read from '·', a leading
 *  digit, at most one short unit token. */
const META_LINE = /^@\S{1,40}\s*[·•:;-]+\s*\d+\s*\S{0,8}\s*$/;

/** 'Maya Lindqvist @maya-builds · 2h' — author merged onto the meta line. */
const MERGED_AUTHOR_META = /^.{0,60}@\S{1,40}\s*[·•:;-]+\s*\d+\s*\S{0,8}\s*$/;

/** Lines made only of punctuation/symbols/whitespace (no letters/digits). */
const SYMBOL_ONLY = /^[\p{P}\p{S}\s]+$/u;

function isSymbolOnly(line: string): boolean {
  return SYMBOL_ONLY.test(line);
}

function isActionOnly(line: string): boolean {
  const tokens = line.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  return tokens.every((t) => {
    const word = t.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
    return word.length > 0 && ACTION_WORDS.has(word.toLowerCase());
  });
}

function isChromeLine(line: string): boolean {
  return (
    isSymbolOnly(line) ||
    REACTION_LINE.test(line) ||
    META_LINE.test(line) ||
    MERGED_AUTHOR_META.test(line) ||
    isActionOnly(line)
  );
}

/** Rejoin lines that OCR split mid-sentence (wrapped paragraphs). */
function repairLineBreaks(lines: string[]): string[] {
  const repaired: string[] = [];
  for (const line of lines) {
    const prev = repaired[repaired.length - 1];
    if (
      prev !== undefined &&
      /^[a-z]/.test(line) &&
      !/[.!?…][”’"')\]]?$/.test(prev)
    ) {
      repaired[repaired.length - 1] = prev.endsWith('-')
        ? prev.slice(0, -1) + line
        : `${prev} ${line}`;
    } else {
      repaired.push(line);
    }
  }
  return repaired;
}

export function cleanupOcrText(rawLines: string[]): CleanupResult {
  const { lines: normalized } = normalizeOcrLines(rawLines);

  const keep = normalized.map((line) => !isChromeLine(line));

  // The author header: the line directly above a handle·time meta line,
  // inside the header zone. Names carry no punctuation markers that
  // distinguish them from body text — position is the reliable signal.
  for (let i = 0; i < Math.min(4, normalized.length - 1); i++) {
    if (META_LINE.test(normalized[i + 1])) keep[i] = false;
  }

  const removedLines = normalized.filter((_, i) => !keep[i]);
  const survivors = normalized.filter((_, i) => keep[i]);
  const repaired = repairLineBreaks(survivors);

  return { lines: repaired, text: repaired.join('\n'), removedLines };
}
