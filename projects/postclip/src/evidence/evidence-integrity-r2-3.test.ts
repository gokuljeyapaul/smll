// @vitest-environment node
/**
 * Evidence integrity (A25, host, R2-3 tree): the slice's committed
 * docs/evidence/R2-3/summary.json is structurally honest — every R2-3
 * acceptance ID (A37–A41, plan "Round 2"/S9) has a valid status; every PASS
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
const SUMMARY = join(ROOT, 'docs/evidence/R2-3/summary.json');
const MANIFEST = join(ROOT, 'docs/evidence/video_manifest.json');

/** R2-3 delivers these IDs (plan slice S9). */
const R2_3_IDS = ['A37', 'A38', 'A39', 'A40', 'A41'];
/** 'web' IDs need BOTH engines; A38/A41 are host (pure logic + the recorded
 * decision numbers). */
const WEB_IDS = new Set(['A37', 'A39', 'A40']);
const HOST_IDS = new Set(['A38', 'A41']);
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

describe('evidence integrity (A25, R2-3)', () => {
  it('has a summary.json for the R2-3 slice', () => {
    expect(existsSync(SUMMARY), 'docs/evidence/R2-3/summary.json must exist').toBe(true);
  });

  it('accounts for every R2-3 acceptance ID with a valid status', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    expect(summary.slice).toBe('R2-3');
    for (const id of R2_3_IDS) {
      expect(summary.acceptance[id], `${id} must be accounted for`).toBeDefined();
      expect(STATUSES.has(summary.acceptance[id].status), `${id} status`).toBe(true);
    }
  });

  it('every PASS points at passed JUnit testcases covering the required engines', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    for (const id of R2_3_IDS) {
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
    for (const id of R2_3_IDS) {
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

  it('the persistent-vs-ephemeral scenario table is committed with real numbers', () => {
    const table = JSON.parse(
      readFileSync(join(ROOT, 'docs/evidence/R2-3/scenario-table.json'), 'utf-8'),
    ) as { scenario: string; engine: string; model_bytes: number | null }[];
    expect(table.length).toBeGreaterThanOrEqual(8); // both engines × the recorded scenarios
    for (const row of table) {
      expect(row.scenario.length).toBeGreaterThan(0);
      expect(row.engine === 'chromium' || row.engine === 'webkit').toBe(true);
      expect(typeof row.model_bytes).toBe('number');
    }
  });

  it('the measured environments probe is committed (reproduce-first, issue #78)', () => {
    const probe = JSON.parse(
      readFileSync(join(ROOT, 'docs/evidence/R2-3/env-probe.json'), 'utf-8'),
    ) as { environments: unknown[] };
    expect(probe.environments.length).toBeGreaterThanOrEqual(6);
  });
});
