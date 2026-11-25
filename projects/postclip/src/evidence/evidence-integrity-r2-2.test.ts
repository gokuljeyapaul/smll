// @vitest-environment node
/**
 * Evidence integrity (A25, host, R2-2 tree): the slice's committed
 * docs/evidence/R2-2/summary.json is structurally honest — every R2-2
 * acceptance ID (A42–A46, plan "Round 2"/S8) has a valid status; every PASS
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
const SUMMARY = join(ROOT, 'docs/evidence/R2-2/summary.json');
const MANIFEST = join(ROOT, 'docs/evidence/video_manifest.json');

/** R2-2 delivers these IDs (plan slice S8). */
const R2_2_IDS = ['A42', 'A43', 'A44', 'A45', 'A46'];
/** 'web' IDs need BOTH engines; A44/A46 are host (pure logic + the docs). */
const WEB_IDS = new Set(['A42', 'A43', 'A45']);
const HOST_IDS = new Set(['A44', 'A46']);
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

describe('evidence integrity (A25, R2-2)', () => {
  it('has a summary.json for the R2-2 slice', () => {
    expect(existsSync(SUMMARY), 'docs/evidence/R2-2/summary.json must exist').toBe(true);
  });

  it('accounts for every R2-2 acceptance ID with a valid status', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    expect(summary.slice).toBe('R2-2');
    for (const id of R2_2_IDS) {
      expect(summary.acceptance[id], `${id} must be accounted for`).toBeDefined();
      expect(STATUSES.has(summary.acceptance[id].status), `${id} status`).toBe(true);
    }
  });

  it('every PASS points at passed JUnit testcases covering the required engines', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    for (const id of R2_2_IDS) {
      const entry = summary.acceptance[id];
      if (entry.status !== 'PASS') {
        continue;
      }
      expect(entry.tests, `${id} PASS must cite at least one junit ref`).toBeDefined();
      expect(entry.tests!.length, `${id} PASS must cite at least one junit ref`).toBeGreaterThan(0);
      const seen = new Set<'chromium' | 'webkit' | 'host'>();
      for (const testRef of entry.tests!) {
        const m = testRef.match(/^junit:([^:]+)::(.+)$/);
        expect(m, `${id}: malformed ref ${testRef}`).toBeTruthy();
        const [, rel, testcase] = m!;
        const cases = readJunitCaseNames(rel);
        const found = cases.find((c) => c.name === testcase);
        expect(found, `${id}: testcase ${testcase} missing in ${rel}`).toBeTruthy();
        expect(found!.failed, `${id}: testcase ${testcase} did not pass in ${rel}`).toBe(false);
        if (junitPathHasEngine(rel, 'chromium')) seen.add('chromium');
        if (junitPathHasEngine(rel, 'webkit')) seen.add('webkit');
        if (junitPathHasEngine(rel, 'host')) seen.add('host');
      }
      if (WEB_IDS.has(id)) {
        expect(seen.has('chromium'), `${id} (web) needs a chromium-engine ref`).toBe(true);
        expect(seen.has('webkit'), `${id} (web) needs a webkit-engine ref`).toBe(true);
      }
      if (HOST_IDS.has(id)) {
        expect(seen.has('host'), `${id} (host) needs a host-engine ref`).toBe(true);
      }
    }
  });

  it('non-PASS entries carry notes; every referenced video exists in the manifest', () => {
    const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as {
      videos: { id: string }[];
    };
    const videoIds = new Set(manifest.videos.map((v) => v.id));
    for (const id of R2_2_IDS) {
      const entry = summary.acceptance[id];
      if (entry.status !== 'PASS') {
        expect(entry.notes, `${id} (${entry.status}) must carry notes`).toBeTruthy();
      }
      for (const video of entry.videos ?? []) {
        const m = video.match(/^video:(.+)$/);
        expect(m, `${id}: malformed video ref ${video}`).toBeTruthy();
        expect(videoIds.has(m![1]), `${id}: video ${m![1]} missing from the manifest`).toBe(true);
      }
    }
  });
});
