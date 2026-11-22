// @vitest-environment node
/**
 * The model-cleanup ORCHESTRATION (S4, A17): constrained-or-strict
 * generation, at most one retry on a PARSE failure, validation, and the
 * fail-closed fallback to the deterministic cleanup — driven here with a
 * FAKE generation function. The fake proves the orchestration logic only;
 * the real pinned model is measured by the browser eval (plan rule).
 */
import { describe, expect, it } from 'vitest';
import { runModelCleanup, type GenerateFn } from './pipeline';

const OCR = [
  'Maya Lindqvist',
  '@maya-builds · 2h',
  'Shipped our first offline-first release today.',
  '42 reactions · 9 comments',
  'Like Comment Share',
];

const FAITHFUL = JSON.stringify({
  body: 'Shipped our first offline-first release today.',
  author: 'Maya Lindqvist',
  source_app: null,
  tags: [],
  summary: 'Shipped a release today.',
  removed_chrome: ['Maya Lindqvist', '@maya-builds · 2h', '42 reactions · 9 comments', 'Like Comment Share'],
});

describe('runModelCleanup — orchestration + fail-closed fallback (A17)', () => {
  it('returns a verified model cleanup for a faithful first attempt', async () => {
    const gen: GenerateFn = async () => FAITHFUL;
    const out = await runModelCleanup(gen, OCR);
    expect(out.kind).toBe('model');
    if (out.kind === 'model') {
      expect(out.attempts).toBe(1);
      expect(out.output.body).toBe('Shipped our first offline-first release today.');
      expect(out.output.author).toBe('Maya Lindqvist');
      expect(out.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('retries EXACTLY ONCE on a parse failure, then falls back if it fails again', async () => {
    let calls = 0;
    const gen: GenerateFn = async () => {
      calls += 1;
      return calls === 1 ? 'This is not JSON at all, sorry.' : 'Still not JSON.';
    };
    const out = await runModelCleanup(gen, OCR);
    expect(calls).toBe(2); // 1 attempt + at most ONE retry
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') {
      expect(out.reason).toBe('invalid-output');
      expect(out.rawModelText).toBe('Still not JSON.');
    }
  });

  it('the single retry can save the run (garbage then faithful)', async () => {
    let calls = 0;
    const gen: GenerateFn = async () => {
      calls += 1;
      return calls === 1 ? 'nope' : FAITHFUL;
    };
    const out = await runModelCleanup(gen, OCR);
    expect(out.kind).toBe('model');
    if (out.kind === 'model') expect(out.attempts).toBe(2);
  });

  it('does NOT retry when the output parses but fails validation (fallback at once)', async () => {
    let calls = 0;
    const gen: GenerateFn = async () => {
      calls += 1;
      return JSON.stringify({
        body: 'Invented text the screenshot never contained.',
        author: null,
        source_app: null,
        tags: [],
        summary: null,
        removed_chrome: [],
      });
    };
    const out = await runModelCleanup(gen, OCR);
    expect(calls).toBe(1);
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') expect(out.reason).toBe('invalid-output');
  });

  it('falls back with reason runtime-error when generation throws', async () => {
    const gen: GenerateFn = async () => {
      throw new Error('wasm exploded');
    };
    const out = await runModelCleanup(gen, OCR);
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') expect(out.reason).toBe('runtime-error');
  });

  it('falls back with reason timeout when generation exceeds the budget', async () => {
    const gen: GenerateFn = () =>
      new Promise<string>(() => {
        /* never resolves */
      });
    const out = await runModelCleanup(gen, OCR, { timeoutMs: 25 });
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') expect(out.reason).toBe('timeout');
  });

  it('never surfaces unvalidated model text on any fallback path', async () => {
    const gen: GenerateFn = async () => '{"body":"INVENTED","author":null,"source_app":null,"tags":[],"summary":null,"removed_chrome":[]}';
    const out = await runModelCleanup(gen, OCR);
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') {
      // The only trace of the raw model text is the eval-only record,
      // never a user-visible value.
      expect(out).not.toHaveProperty('output');
    }
  });
});
