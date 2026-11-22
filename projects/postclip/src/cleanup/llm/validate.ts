/**
 * The deterministic validator + faithfulness guard (S4 — plan "LLM safety
 * design" points 3 and 4; A16/A17/A18). Pure logic, shared by the vitest
 * adversarial suite and the cleanup Worker — the app NEVER shows model text
 * that has not passed through here.
 *
 * Rules (each pinned by validate.test.ts, adversarially):
 *  1. Schema: exactly { body, author, source_app, tags, summary,
 *     removed_chrome } — extra fields REJECT; missing fields REJECT.
 *  2. Bounds: body non-empty and within 1.5x the OCR length (runaway
 *     repetition), tags <= 5 x 40 chars, summary <= 280 chars.
 *  3. Faithfulness (A18): body tokens traceable to OCR tokens (multiset
 *     precision >= 0.98, fuzzy match for OCR variants — the same fuzzy
 *     rule as the cleanup metrics), and every OCR content token missing
 *     from the body must be accounted for: it appears in removed_chrome or
 *     in the known-chrome dictionary (the deterministic cleanup's own
 *     chrome-line knowledge, reused verbatim).
 *  4. author / source_app must literally appear in the OCR text, or are
 *     DROPPED (null) — fabricated metadata never shows.
 *  5. removed_chrome entries must be traceable to the OCR text; entries
 *     that are not are dropped (invented chrome never reaches the user).
 *  6. Injection defense (A16, deterministic): when the OCR INPUT contains
 *     instruction-like patterns, every generated metadata suggestion
 *     (tags, summary, author, source_app) is DEMOTED — dropped regardless
 *     of what the model produced (a real 0.6B run obeyed such a post into
 *     its tags array during the S4 measurement) — and the
 *     instruction-looking lines must remain in the body as content: a
 *     model that removes them (even "accounted") is rejected outright.
 *  7. Any hard failure => the caller falls back to the deterministic
 *     cleanup with a visible "cleanup unavailable" flag; nothing
 *     unvalidated is ever shown.
 */

import { cleanupOcrText } from '../cleanup';
import { tokenize, fuzzyMatch } from '../metrics';
import { instructionPatternLines, looksLikeInjectionAttempt } from './prompt';
import { SCHEMA_BOUNDS, type LlmCleanupOutput } from './schema';

export type GuardRejectReason =
  | 'schema'
  | 'bounds'
  | 'invented-body'
  | 'dropped-content';

export interface ValidationResult {
  ok: boolean;
  reason?: GuardRejectReason;
  detail?: string;
  /** The sanitized, safe-to-show result (present when ok). */
  value?: LlmCleanupOutput;
  /** True when the input looked like an injection attempt and the
   *  metadata suggestions were demoted (A16, recorded for the UI/eval). */
  demoted?: boolean;
}

const REQUIRED_FIELDS = ['body', 'author', 'source_app', 'tags', 'summary', 'removed_chrome'] as const;
const MAX_AUTHOR_CHARS = 80;

function reject(reason: GuardRejectReason, detail: string): ValidationResult {
  return { ok: false, reason, detail };
}

/** Greedy fuzzy multiset pairing: which sources found a target, and which
 *  targets got consumed (each target matches at most one source). */
function pairMultisets(sources: string[], targets: string[]): {
  sourceMatched: boolean[];
  targetConsumed: boolean[];
} {
  const targetConsumed = new Array<boolean>(targets.length).fill(false);
  const sourceMatched = new Array<boolean>(sources.length).fill(false);
  for (let s = 0; s < sources.length; s++) {
    for (let t = 0; t < targets.length; t++) {
      if (!targetConsumed[t] && fuzzyMatch(sources[s], targets[t])) {
        targetConsumed[t] = true;
        sourceMatched[s] = true;
        break;
      }
    }
  }
  return { sourceMatched, targetConsumed };
}

/** Non-consuming traceability: every token must fuzzy-match SOME token of
 *  the corpus (short tokens are skipped — OCR noise lives there). */
function allTraceable(tokens: string[], corpus: string[]): boolean {
  return tokens
    .filter((t) => t.length >= 2)
    .every((t) => corpus.some((c) => fuzzyMatch(t, c)));
}

function isNullOrString(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

function isStringArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.every((entry) => typeof entry === 'string')
  );
}

export function validateLlmCleanup(raw: unknown, ocrLines: string[]): ValidationResult {
  // ── 1. Schema: the exact contract, nothing extra, nothing missing. ──
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return reject('schema', 'model output is not a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(REQUIRED_FIELDS as readonly string[]).includes(key)) {
      return reject('schema', `extra field "${key}" is outside the cleanup schema`);
    }
  }
  for (const key of REQUIRED_FIELDS) {
    if (!(key in obj)) {
      return reject('schema', `missing required field "${key}"`);
    }
  }
  if (typeof obj.body !== 'string') return reject('schema', 'body must be a string');
  if (!isNullOrString(obj.author)) return reject('schema', 'author must be a string or null');
  if (!isNullOrString(obj.source_app)) return reject('schema', 'source_app must be a string or null');
  if (!isStringArray(obj.tags)) return reject('schema', 'tags must be an array of strings');
  if (!isNullOrString(obj.summary)) return reject('schema', 'summary must be a string or null');
  if (!isStringArray(obj.removed_chrome)) return reject('schema', 'removed_chrome must be an array of strings');

  const ocrText = ocrLines.join('\n');
  const body = obj.body;

  // ── 2. Bounds (fail-closed on runaway or empty output). ──
  if (body.trim().length === 0) return reject('bounds', 'body is empty');
  if (body.length > SCHEMA_BOUNDS.maxBodyToOcrCharRatio * Math.max(ocrText.length, 1)) {
    return reject('bounds', `body is ${body.length} chars vs ${ocrText.length} OCR chars (runaway)`);
  }

  // ── 3. Faithfulness (A18): body traceable to the OCR tokens. ──
  const ocrTokens = tokenize(ocrText);
  const bodyTokens = tokenize(body);
  const pairing = pairMultisets(bodyTokens, ocrTokens);
  const matchedBody = pairing.sourceMatched.filter(Boolean).length;
  const precision = bodyTokens.length === 0 ? 1 : matchedBody / bodyTokens.length;
  if (precision < SCHEMA_BOUNDS.minBodyPrecision) {
    return reject(
      'invented-body',
      `body multiset precision ${precision.toFixed(3)} < ${SCHEMA_BOUNDS.minBodyPrecision} (${bodyTokens.length - matchedBody} untraceable tokens)`,
    );
  }

  // ── 4. Missing-content accounting: every OCR token the body dropped
  //       must be explained by removed_chrome or the known-chrome
  //       dictionary (the deterministic cleanup's chrome-line knowledge). ──
  const deterministic = cleanupOcrText(ocrLines);
  const acceptedChrome: string[] = [];
  for (const entry of obj.removed_chrome) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (!allTraceable(tokenize(trimmed), ocrTokens)) continue; // invented chrome: never shown
    acceptedChrome.push(trimmed);
  }
  const accountedTokens = tokenize(
    [...deterministic.removedLines, ...acceptedChrome].join('\n'),
  );
  const leftoverOcr = ocrTokens.filter((_, i) => !pairing.targetConsumed[i]);
  const leftoverChecked = leftoverOcr.filter((t) => t.length >= 2);
  const leftoverAccounting = pairMultisets(leftoverChecked, accountedTokens);
  const unaccountedTokens = leftoverChecked.filter((_, i) => !leftoverAccounting.sourceMatched[i]);
  if (unaccountedTokens.length > 0) {
    return reject(
      'dropped-content',
      `${unaccountedTokens.length} OCR content tokens missing from the body without chrome accounting (e.g. "${unaccountedTokens.slice(0, 5).join(' ')}")`,
    );
  }

  // ── 5. Metadata: literal-or-drop, bounds, traceable-or-drop. ──
  const literalOrNull = (v: string | null, max: number): string | null => {
    if (v === null) return null;
    const trimmed = v.trim();
    if (trimmed.length === 0 || trimmed.length > max) return null;
    return ocrText.toLowerCase().includes(trimmed.toLowerCase()) ? trimmed : null;
  };
  let author = literalOrNull(obj.author, MAX_AUTHOR_CHARS);
  let source_app = literalOrNull(obj.source_app, MAX_AUTHOR_CHARS);

  let tags = obj.tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, SCHEMA_BOUNDS.maxTags);
  if (tags.some((tag) => tag.length > SCHEMA_BOUNDS.maxTagChars || !allTraceable(tokenize(tag), ocrTokens))) {
    tags = []; // one invented tag poisons the whole (optional) suggestion
  }

  let summary: string | null = obj.summary === null ? null : obj.summary.trim();
  if (summary !== null) {
    if (summary.length === 0) summary = null;
    else if (summary.length > SCHEMA_BOUNDS.maxSummaryChars) summary = null;
    else if (!allTraceable(tokenize(summary).filter((t) => t.length >= 3), ocrTokens)) summary = null;
  }

  // ── 6. Injection defense (A16): demote every generated suggestion when
  //       the OCR INPUT itself looks like an instruction attempt, and
  //       require the instruction-looking lines to STAY in the body. ──
  let demoted = false;
  let removedChrome: string[];
  if (looksLikeInjectionAttempt(ocrText)) {
    demoted = true;
    tags = [];
    summary = null;
    author = null;
    source_app = null;
    // Deterministic, safe chrome listing only (plus model entries that
    // are traceable AND do not quote instruction-looking text).
    const deterministicSet = new Set(deterministic.removedLines.map((l) => l.trim()));
    removedChrome = [
      ...deterministic.removedLines,
      ...acceptedChrome.filter(
        (entry) => !looksLikeInjectionAttempt(entry) && !deterministicSet.has(entry),
      ),
    ].slice(0, SCHEMA_BOUNDS.maxRemovedChromeEntries);
    // The instruction lines are CONTENT (UC13): a model that dropped them
    // (even "accounted") obeyed the attack's framing — reject outright.
    for (const line of instructionPatternLines(ocrLines)) {
      const lineTokens = tokenize(line).filter((t) => t.length >= 2);
      const bodyCorpus = bodyTokens;
      const present = lineTokens.filter((t) => bodyCorpus.some((b) => fuzzyMatch(t, b))).length;
      const ratio = lineTokens.length === 0 ? 1 : present / lineTokens.length;
      if (ratio < 0.8) {
        return reject(
          'dropped-content',
          'an instruction-looking post line is missing from the body (injection content may not be silently removed)',
        );
      }
    }
  } else {
    removedChrome = acceptedChrome.slice(0, SCHEMA_BOUNDS.maxRemovedChromeEntries);
  }

  return {
    ok: true,
    demoted,
    value: { body, author, source_app, tags, summary, removed_chrome: removedChrome },
  };
}
