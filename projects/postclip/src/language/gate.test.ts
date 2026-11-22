// @vitest-environment node
/**
 * English-only language gate (S1, A06, UC10): the confusion matrix over the
 * fixture gold text — zero non-English accepted, >= 95% English accepted —
 * plus the reject reasons and the threshold margin. The in-app flow
 * (reject with a clear message, no cleanup runs) is proven in
 * e2e/uc10_non_english_rejected.spec.ts in both engines.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectEnglish,
  NON_ENGLISH_MESSAGE,
  STOPWORD_THRESHOLD,
  LATIN_SCRIPT_MIN,
  MIN_WORDS,
} from './gate';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Gold {
  id: string;
  kind: string;
  language: string;
  body: string[];
  ocr_expected: string[];
}

function loadGold(): Gold[] {
  const dir = join(HERE, '..', '..', 'fixtures', 'gold');
  expect(existsSync(dir), 'fixtures/gold must exist').toBe(true);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Gold);
}

const english = () => loadGold().filter((g) => g.language === 'en');
const nonEnglish = () => loadGold().filter((g) => g.language === 'de' || g.language === 'es');

describe('detectEnglish — gate behavior (S1)', () => {
  it('rejects text with too few words (fail closed, honest reason)', () => {
    const verdict = detectEnglish('Hello world');
    expect(verdict.isEnglish).toBe(false);
    expect(verdict.reason).toBe('too-short');
  });

  it('rejects empty text', () => {
    expect(detectEnglish('').reason).toBe('too-short');
  });

  it('rejects non-Latin scripts before the stopword check', () => {
    const verdict = detectEnglish('这是一个测试，不是英文的帖子内容。');
    expect(verdict.isEnglish).toBe(false);
    expect(verdict.reason).toBe('script');
    expect(verdict.latinRatio).toBeLessThan(LATIN_SCRIPT_MIN);
  });

  it('accepts a plain English sentence', () => {
    const verdict = detectEnglish('We shipped the new release today and the tests are green.');
    expect(verdict.isEnglish).toBe(true);
    expect(verdict.reason).toBe('ok');
  });

  it('exposes a clear, kind user-facing rejection message', () => {
    expect(NON_ENGLISH_MESSAGE).toContain('English');
    expect(NON_ENGLISH_MESSAGE).toContain('not processed');
  });
});

describe('language gate confusion matrix over fixtures (A06)', () => {
  it('covers the 30 English and 5 German/Spanish fixtures', () => {
    expect(english().length).toBe(30);
    expect(nonEnglish().length).toBe(5);
  });

  it('accepts every English fixture (>= 95% required)', () => {
    const accepted = english().filter((g) => detectEnglish(g.ocr_expected.join('\n')).isEnglish);
    const rate = accepted.length / english().length;
    console.log(`language gate: English accepted ${accepted.length}/${english().length} = ${(rate * 100).toFixed(1)}%`);
    for (const g of english()) {
      const v = detectEnglish(g.ocr_expected.join('\n'));
      console.log(`  en ${g.id}: ratio=${v.stopwordRatio.toFixed(3)} words=${v.wordCount} accepted=${v.isEnglish}`);
    }
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it('rejects every German and Spanish fixture (zero non-English accepted)', () => {
    const accepted = nonEnglish().filter((g) => detectEnglish(g.ocr_expected.join('\n')).isEnglish);
    console.log(`language gate: non-English accepted ${accepted.length}/${nonEnglish().length}`);
    for (const g of nonEnglish()) {
      const v = detectEnglish(g.ocr_expected.join('\n'));
      console.log(`  ${g.language} ${g.id}: ratio=${v.stopwordRatio.toFixed(3)} words=${v.wordCount} reason=${v.reason}`);
    }
    expect(accepted).toEqual([]);
  });

  it('rejects the bad-input fixtures (empty text) as too-short, never accepts them', () => {
    const bad = loadGold().filter((g) => g.language === 'none');
    expect(bad.map((g) => g.id).sort()).toEqual(['blank01', 'corrupt01', 'nonimage01', 'photo01', 'tiny01'].sort());
    for (const g of bad) {
      expect(detectEnglish(g.ocr_expected.join('\n')).reason).toBe('too-short');
    }
  });

  it('separates English from non-English with a margin around the threshold', () => {
    const enRatios = english().map((g) => detectEnglish(g.ocr_expected.join('\n')).stopwordRatio);
    const nonEnRatios = nonEnglish().map((g) => detectEnglish(g.ocr_expected.join('\n')).stopwordRatio);
    const minEn = Math.min(...enRatios);
    const maxNonEn = Math.max(...nonEnRatios);
    console.log(
      `language gate margins: threshold=${STOPWORD_THRESHOLD} min(en)=${minEn.toFixed(3)} max(non-en)=${maxNonEn.toFixed(3)}`,
    );
    // The threshold must sit at least 0.05 away from both measured classes,
    // so OCR noise cannot flip a fixture across it.
    expect(minEn).toBeGreaterThanOrEqual(STOPWORD_THRESHOLD + 0.05);
    expect(maxNonEn).toBeLessThanOrEqual(STOPWORD_THRESHOLD - 0.05);
    expect(MIN_WORDS).toBeGreaterThanOrEqual(5);
  });
});
