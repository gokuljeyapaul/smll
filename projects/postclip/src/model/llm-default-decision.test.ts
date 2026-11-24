// @vitest-environment node
/**
 * R2-3 (A41, plan S9): the off-by-default / advanced-section decision rests
 * on NUMBERS, never preference. The A19 measurement (S4) and its re-run on
 * every full tree are the committed evidence; this test pins the decision
 * constant to what those numbers actually say — the model cleanup is
 * slower and worse than the deterministic rules baseline, so the LLM ships
 * disabled by default and the download is opt-in behind the Advanced
 * section (issue #78's default policy).
 *
 * The JSONs are read from the COMMITTED evidence (docs/evidence/S4/),
 * refreshed by this tree's own eval re-run — no number is typed here.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { A19_DECISION_NOTE, LLM_CLEANUP_ENABLED_BY_DEFAULT } from '../cleanup/llm/config';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface EvalSummary {
  engine: string;
  fixtures: number;
  baseline: { meanF1: number; meanLeakage: number; meanFabricated: number };
  model: {
    meanF1: number;
    meanLeakage: number;
    meanFabricated: number;
    meanLatencyMs: number;
  } | null;
}

/** The A19 leakage bar and the A22 latency budget, as recorded in the plan. */
const LEAKAGE_BAR = 0.02;
const LATENCY_BUDGET_MS = 60_000;

/** The A19 eval is Chromium-ONLY by design (eval_llm_vs_baseline.spec.ts
 * skips every other engine: the pinned model cannot load in Playwright's
 * WebKit — A21's designed fallback covers that engine). */
function readChromiumEval(): EvalSummary {
  const path = join(ROOT, 'docs/evidence/S4/llm-eval-chromium.json');
  expect(existsSync(path), `the committed A19 eval evidence must exist: ${path}`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf-8')) as EvalSummary;
}

describe('the off-by-default decision rests on the measured numbers (R2-3, A41)', () => {
  it('the LLM cleanup ships DISABLED by default (A19/A21, pinned constant)', () => {
    expect(LLM_CLEANUP_ENABLED_BY_DEFAULT).toBe(false);
  });

  it('the recorded A19 note names the evidence the decision rests on', () => {
    expect(A19_DECISION_NOTE).toContain('disabled by default');
    expect(A19_DECISION_NOTE).toContain('did not beat the deterministic baseline');
    expect(A19_DECISION_NOTE).toContain('docs/evidence/S4/model_selection.md');
  });

  it('the committed A19 re-run shows the rules baseline at least as good as the model (the decision rests on these numbers)', () => {
    const evalRun = readChromiumEval();
    expect(evalRun.engine).toBe('chromium');
    expect(evalRun.fixtures).toBeGreaterThan(0);
    const baseline = evalRun.baseline;
    // The baseline meets its own bars (A19's deterministic quality gate).
    expect(baseline.meanF1).toBeGreaterThan(0.9);
    expect(baseline.meanLeakage).toBeLessThanOrEqual(LEAKAGE_BAR);
    if (evalRun.model) {
      // The measured reason the LLM stays off by default: the model mode
      // does NOT beat the baseline (F1), leaks chrome above the bar,
      // and/or exceeds the latency budget — at least one measured reason
      // must hold, and all three are recorded in the evidence.
      const model = evalRun.model;
      expect(model.meanF1).toBeLessThan(baseline.meanF1);
      const reasons = [
        model.meanF1 < baseline.meanF1,
        model.meanLeakage > LEAKAGE_BAR,
        model.meanLatencyMs > LATENCY_BUDGET_MS,
      ];
      expect(
        reasons.filter(Boolean).length,
        'the disabled-by-default decision must rest on at least one measured reason',
      ).toBeGreaterThan(0);
    }
  });
});
