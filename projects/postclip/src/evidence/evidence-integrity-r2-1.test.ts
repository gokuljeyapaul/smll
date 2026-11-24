// @vitest-environment node
/**
 * Evidence integrity (A25, host, R2-1 tree): the slice's committed
 * docs/evidence/R2-1/summary.json is structurally honest — every R2-1
 * acceptance ID (A32–A36, plan "Round 2"/S7) has a valid status; every PASS
 * points at JUnit testcases that exist, passed, and cover the required
 * engines (judged from the JUnit file path, like scripts/verify_evidence.py);
 * every referenced video exists in the manifest; non-PASS entries carry
 * notes. The digest freshness and plan-wide accounting are
 * scripts/verify_evidence.py, run by scripts/verify.sh.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUMMARY = join(ROOT, 'docs/evidence/R2-1/summary.json');
const MANIFEST = join(ROOT, 'docs/evidence/video_manifest.json');

/** R2-1 delivers these IDs (plan slice S7). */
const R2_1_IDS = ['A32', 'A33', 'A34', 'A35', 'A36'];
/** 'web' IDs need BOTH engines; A32/A36 are Chromium-only (the share-target
 * POST route, as A08); A34 is host (pure logic). */
const WEB_IDS = new Set(['A33', 'A35']);
const CHROMIUM_ONLY = new Set(['A32', 'A36']);
const HOST_IDS = new Set(['A34']);
const STATUSES = new Set(['PASS', 'PARTIAL', 'NOT_RUN', 'BLOCKED']);

interface Summary {
  slice: string;
  source_digest: string;
  acceptance: Record<string, { status: string; tests?: string[]; videos?: string[]; notes?: string }>;
}

function readJunitCaseNames(relPath: string): { name: string; failed: boolean }[] {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) return [];
  const xml = readFileSync(full, 'utf-8');
  const out: { name: string; failed: boolean }[] = [];
  const re = /<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[1] ?? m[2] ?? '';
    const body = m[3] ?? '';
    const name = attrs
      .match(/\bname="((?:[^"\\]|\\.)*)"/)?.[1]
      ?.replaceAll('\\"', '"')
      .replaceAll('&gt;', '>')
      .replaceAll('&lt;', '<')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&');
    if (!name) continue;
    out.push({ name, failed: /<(failure|error|skipped)\b/.test(body) });
  }
  return out;
}

function junitPathHasEngine(relPath: string, engine: 'chromium' | 'webkit' | 'host'): boolean {
  return new RegExp(`(^|[/_\\-.])${engine}([/_\\-.]|$)`).test(relPath.toLowerCase());
}

describe('evidence integrity (A25, R2-1)', () => {
  it('has a summary.json for the R2-1 slice', () => {
    expect(existsSync(SUMMARY), 'docs/evidence/R2-1/summary.json must exist').toBe(true);
  });

  it('accounts for every R2-1 acceptance ID with a valid status', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    expect(summary.slice).toBe('R2-1');
    for (const id of R2_1_IDS) {
      expect(summary.acceptance[id], `${id} must be accounted for`).toBeDefined();
      expect(STATUSES.has(summary.acceptance[id].status), `${id} status`).toBe(true);
    }
  });

  it('every PASS points at passed JUnit testcases covering the required engines', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    for (const id of R2_1_IDS) {
      const entry = summary.acceptance[id];
      if (entry.status !== 'PASS') {
        expect(entry.notes, `${id} non-PASS needs notes`).toBeTruthy();
        continue;
      }
      expect((entry.tests ?? []).length, `${id} PASS needs test references`).toBeGreaterThan(0);
      for (const ref of entry.tests ?? []) {
        const m = ref.match(/^junit:(.+?)::(.+)$/);
        expect(m, `${id} malformed test reference ${ref}`).toBeTruthy();
        if (!m) continue;
        const cases = readJunitCaseNames(m[1]);
        const found = cases.find((c) => c.name === m[2]);
        expect(found, `${id} testcase ${m[2]} not found in ${m[1]}`).toBeDefined();
        expect(found?.failed, `${id} testcase ${m[2]} in ${m[1]} did not pass`).toBe(false);
      }
      const refs = entry.tests ?? [];
      if (WEB_IDS.has(id)) {
        expect(refs.some((r) => junitPathHasEngine(r, 'chromium')), `${id} needs a chromium ref`).toBe(true);
        expect(refs.some((r) => junitPathHasEngine(r, 'webkit')), `${id} needs a webkit ref`).toBe(true);
      }
      if (CHROMIUM_ONLY.has(id)) {
        expect(refs.some((r) => junitPathHasEngine(r, 'chromium')), `${id} needs a chromium ref`).toBe(true);
      }
      if (HOST_IDS.has(id)) {
        expect(refs.some((r) => junitPathHasEngine(r, 'host')), `${id} needs a host ref`).toBe(true);
      }
    }
  });

  it('every referenced video exists in the manifest with its evidence fields', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as {
      videos: { id: string; sha256?: string; size_bytes?: number; junit?: string }[];
    };
    const byId = new Map(manifest.videos.map((v) => [v.id, v]));
    for (const id of R2_1_IDS) {
      for (const v of summary.acceptance[id].videos ?? []) {
        const vid = v.replace(/^video:/, '');
        const rec = byId.get(vid);
        expect(rec, `${id} references missing video ${vid}`).toBeDefined();
        expect(rec?.sha256, `${vid} sha256`).toBeTruthy();
        expect(rec?.size_bytes, `${vid} size_bytes`).toBeTruthy();
        expect(rec?.junit, `${vid} junit ref`).toBeTruthy();
      }
    }
  });
});
