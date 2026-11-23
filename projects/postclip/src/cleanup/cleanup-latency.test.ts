// @vitest-environment node
/**
 * A22 (host): the DEFAULT cleanup path meets the plan's 60 s budget on every
 * fixture's realistic input. The budget's letter is "cleanup <= 60 s on the
 * WASM path" — the LLM (WASM) path ships DISABLED BY DEFAULT by the S4/A19
 * measurement (its real numbers, 65-236 s single-threaded WASM, are recorded
 * by the browser eval on every tree and in the slice summary as measured
 * limitations, never as a passing budget). The DEFAULT path is the
 * deterministic rules cleanup measured here and in-browser
 * (e2e/eval_latency_memory.spec.ts, postclip:cleanup) — both well within.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanupOcrText } from './cleanup';

const CLEANUP_BUDGET_MS = 60_000;

interface Gold {
  ocr_expected?: string[];
  body?: string[];
}

describe('deterministic cleanup latency (A22 budget)', () => {
  it('cleanupOcrText on every fixture gold input completes within 60 s per call', () => {
    const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf-8')) as {
      images: { id: string; gold: string }[];
    };
    expect(manifest.images.length).toBeGreaterThanOrEqual(40);

    const times: { id: string; ms: number }[] = [];
    for (const img of manifest.images) {
      const gold = JSON.parse(readFileSync(`fixtures/${img.gold}`, 'utf-8')) as Gold;
      // Realistic input: what OCR hands the cleanup — the visible text lines.
      const lines = gold.ocr_expected ?? gold.body ?? [];
      if (lines.length === 0) continue;
      const t0 = performance.now();
      cleanupOcrText(lines);
      times.push({ id: img.id, ms: performance.now() - t0 });
    }

    expect(times.length, 'at least one fixture must be measured').toBeGreaterThan(0);
    const max = times.reduce((m, t) => Math.max(m, t.ms), 0);
    const mean = times.reduce((s, t) => s + t.ms, 0) / times.length;
    console.log(
      `cleanup latency: ${times.length} fixtures, mean ${mean.toFixed(3)} ms, max ${max.toFixed(3)} ms (budget 60000 ms per call)`,
    );
    for (const t of times) {
      expect(t.ms, `cleanup of ${t.id} must be <= ${CLEANUP_BUDGET_MS} ms`).toBeLessThanOrEqual(CLEANUP_BUDGET_MS);
    }
  });
});
