// @vitest-environment node
/**
 * Deterministic baseline cleanup (S1): the UI-chrome rules, whitespace /
 * line-break repair, and the cleanup-quality metrics on GOLD INPUT for
 * every English fixture (the browser run measures the same metrics on real
 * OCR output in e2e/eval_cleanup_metrics.spec.ts; A19's real-model eval is
 * S4).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupOcrText } from './cleanup';
import { bodyTokenF1, chromeLeakageRate, fabricatedTokenRate } from './metrics';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Gold {
  id: string;
  kind: string;
  language: string;
  author: string;
  body: string[];
  chrome: string[];
  ocr_expected: string[];
  expected_error?: string;
}

function loadGold(): Gold[] {
  const dir = join(HERE, '..', '..', 'fixtures', 'gold');
  expect(existsSync(dir), 'fixtures/gold must exist').toBe(true);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Gold);
}

const englishFixtures = () => loadGold().filter((g) => g.language === 'en');

describe('cleanupOcrText — UI-chrome rules (S1)', () => {
  it('removes the action row, including Follow/Connect variants', () => {
    expect(cleanupOcrText(['Like Comment Share']).removedLines).toEqual(['Like Comment Share']);
    expect(cleanupOcrText(['Like Comment Share Follow Connect']).text).toBe('');
    expect(cleanupOcrText(['Follow']).text).toBe('');
    expect(cleanupOcrText(['Connect']).text).toBe('');
    expect(cleanupOcrText(['Save', 'Hello world.']).text).toBe('Hello world.');
  });

  it('is English-only by design: localized chrome (German) is NOT cleaned — those posts are rejected by the language gate before cleanup ever runs', () => {
    expect(cleanupOcrText(['Gefällt mir Kommentieren Teilen', 'Kein Cloud-Zugriff.']).text).toBe(
      'Gefällt mir Kommentieren Teilen\nKein Cloud-Zugriff.',
    );
  });

  it('removes promoted/sponsored/suggested labels', () => {
    expect(cleanupOcrText(['Promoted', 'Hello world.']).text).toBe('Hello world.');
    expect(cleanupOcrText(['Sponsored', 'Hello world.']).text).toBe('Hello world.');
    expect(cleanupOcrText(['Suggested', 'Hello world.']).text).toBe('Hello world.');
  });

  it('removes reaction-count lines in their OCR separator variants', () => {
    expect(cleanupOcrText(['42 reactions · 9 comments']).text).toBe('');
    expect(cleanupOcrText(['42 reactions - 9 comments']).text).toBe('');
    expect(cleanupOcrText(['8 reactions']).text).toBe('');
    expect(cleanupOcrText(['1,208 reactions · 89 comments']).text).toBe('');
    expect(cleanupOcrText(['12 reactions - 1 comment']).text).toBe('');
  });

  it('removes the handle+time meta line in every separator OCR produces', () => {
    expect(cleanupOcrText(['@maya-builds · 2h']).text).toBe('');
    expect(cleanupOcrText(['@maya-builds - 2h']).text).toBe('');
    expect(cleanupOcrText(['@lukas-berger - 3 Std.']).text).toBe('');
    expect(cleanupOcrText(['@elena-ruiz:- 2h']).text).toBe('');
    expect(cleanupOcrText(['@jonasw : 1 Tag']).text).toBe('');
    expect(cleanupOcrText(['@devon.park · 5h']).text).toBe('');
  });

  it('removes the author header line directly above the meta line', () => {
    const { text } = cleanupOcrText(['Maya Lindqvist', '@maya-builds · 2h', 'Shipped our first release today.']);
    expect(text).toBe('Shipped our first release today.');
    // even when OCR garbles the name into a pseudo-handle
    const garbled = cleanupOcrText(['@ Nadia Farouk', '@nadia-f - 4h', 'A long one for the readers.']);
    expect(garbled.text).toBe('A long one for the readers.');
  });

  it('removes symbol-only lines like the overflow dots', () => {
    expect(cleanupOcrText(['···', 'Promoted', 'Real post text.']).text).toBe('Real post text.');
    expect(cleanupOcrText(['—', 'Real post text.']).text).toBe('Real post text.');
  });

  it('never removes body content: bullets, hashtags, numbers, mentions stay', () => {
    const body = [
      'Hiring update from Brightpath Labs:',
      '• Senior platform engineer (Rust, distributed storage)',
      'We handle 40 MB and 1,208 requests. Ask @team-engineering.',
      'What did you delete recently? #observability',
    ];
    expect(cleanupOcrText(body).text).toBe(body.join('\n'));
  });

  it('keeps body lines that merely contain chrome words', () => {
    const lines = [
      'Maya Lindqvist',
      '@maya-builds · 2h',
      'Ask me anything about the migration — happy to share the runbook.',
      'I like to comment on every share of my work.',
      '42 reactions · 9 comments',
      'Like Comment Share',
    ];
    expect(cleanupOcrText(lines).text).toBe(
      [
        'Ask me anything about the migration — happy to share the runbook.',
        'I like to comment on every share of my work.',
      ].join('\n'),
    );
  });
});

describe('cleanupOcrText — line-break repair (S1)', () => {
  it('joins a wrapped sentence: line without end punctuation + lowercase continuation', () => {
    expect(
      cleanupOcrText([
        'A long one for the readers: here is everything we learned moving',
        'our ingestion pipeline to a single binary,',
        'and why the second attempt worked.',
      ]).text,
    ).toBe('A long one for the readers: here is everything we learned moving our ingestion pipeline to a single binary, and why the second attempt worked.');
  });

  it('de-hyphenates a word wrapped across lines', () => {
    expect(cleanupOcrText(['The state-', 'less design held up.']).text).toBe('The stateless design held up.');
  });

  it('does not join list items or new sentences', () => {
    const lines = [
      '1. We wrote down the schema before touching a handler.',
      '2. We deleted twice as much code as we added.',
      'Short version: delete first.',
    ];
    expect(cleanupOcrText(lines).lines).toEqual(lines);
  });

  it('does not join when the next line starts uppercase', () => {
    const lines = ['The pipeline now processes a day of traffic in eleven minutes,', 'Ask me anything about the migration.'];
    expect(cleanupOcrText(lines).lines).toEqual(lines);
  });
});

describe('cleanup quality on gold input — every English fixture (S1 + S4)', () => {
  const golds = englishFixtures();
  it('covers all 30 English fixtures', () => {
    expect(golds.length).toBe(30);
    expect(golds.map((g) => g.id).sort()).toEqual([
      'blur01', 'chrome01', 'chrome02', 'clean01', 'clean02', 'clean03', 'clean04', 'clean05',
      'clean06', 'clean07', 'clean08', 'dark01', 'dark02', 'dark03', 'emoji01', 'emoji02',
      'heavychrome01', 'heavychrome02', 'huge01', 'inj01', 'inj02', 'inj03', 'inj04', 'inj05',
      'longpost01', 'longpost02', 'lowcontrast01', 'lowcontrast02', 'rotate01', 'tinytext01',
    ].sort());
  });

  for (const gold of golds) {
    it(`${gold.id}: keeps the body, removes all chrome, fabricates nothing (F1=1, leakage=0, fabricated=0)`, () => {
      const input = gold.ocr_expected.join('\n');
      const { text } = cleanupOcrText(gold.ocr_expected);
      const f1 = bodyTokenF1(text, gold.body.join('\n'));
      const leakage = chromeLeakageRate(text, gold.body.join('\n'), gold.chrome);
      const fabricated = fabricatedTokenRate(text, input);
      expect(f1, `${gold.id} body-token F1`).toBe(1);
      expect(leakage, `${gold.id} chrome leakage`).toBe(0);
      expect(fabricated, `${gold.id} fabricated-token rate`).toBe(0);
    });
  }

  it('output tokens are always a subset of the input tokens (multiset)', () => {
    for (const gold of golds) {
      const { text } = cleanupOcrText(gold.ocr_expected);
      expect(fabricatedTokenRate(text, gold.ocr_expected.join('\n'))).toBe(0);
    }
  });
});
