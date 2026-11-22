// @vitest-environment node
/**
 * Evidence integrity (A25, host): the slice's committed summary.json is
 * structurally honest — every S0 acceptance ID has a valid status; every PASS
 * points at JUnit testcases that exist, passed, and cover the required
 * engines (judged from the JUnit file path, like verify_evidence.py); every
 * referenced video exists in the manifest; non-PASS entries carry notes.
 * The deeper check (source_digest freshness, plan-wide accounting) is
 * scripts/verify_evidence.py, run by scripts/verify.sh.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUMMARY = join(ROOT, 'docs/evidence/S0/summary.json');
const MANIFEST = join(ROOT, 'docs/evidence/video_manifest.json');

const S0_IDS = ['A01', 'A02', 'A03', 'A20', 'A25', 'A31'];
const STATUSES = new Set(['PASS', 'PARTIAL', 'NOT_RUN', 'BLOCKED']);

interface Summary {
  slice: string;
  source_digest: string;
  acceptance: Record<string, { status: string; tests?: string[]; videos?: string[]; notes?: string }>;
}

/**
 * Minimal dependency-free JUnit reader: a testcase either is self-closing
 * (passed — no failure child) or carries children (failure/skipped/error).
 */
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
    out.push({
      name,
      failed: /<(failure|error|skipped)\b/.test(body),
    });
  }
  return out;
}

function junitPassed(ref: string): { ok: boolean; why: string } {
  const m = ref.match(/^junit:(.+)::(.+)$/);
  if (!m) return { ok: false, why: `malformed ref ${ref}` };
  const [, rel, name] = m;
  const cases = readJunitCaseNames(rel);
  if (cases.length === 0 && !existsSync(join(ROOT, rel))) {
    return { ok: false, why: `missing junit file ${rel}` };
  }
  const tc = cases.find((c) => c.name === name);
  if (!tc) return { ok: false, why: `testcase ${name} not found in ${rel}` };
  if (tc.failed) return { ok: false, why: `testcase ${name} in ${rel} did not pass` };
  return { ok: true, why: '' };
}

describe('evidence integrity (A25)', () => {
  const summary = JSON.parse(readFileSync(SUMMARY, 'utf-8')) as Summary;

  it('covers every S0 acceptance ID with a valid status', () => {
    expect(summary.slice).toBe('S0');
    for (const id of S0_IDS) {
      const entry = summary.acceptance[id];
      expect(entry, `${id} must be present in summary.json`).toBeDefined();
      expect(STATUSES.has(entry.status), `${id} has status ${entry.status}`).toBe(true);
    }
  });

  it('every PASS points at JUnit testcases that exist and passed, per required engine', () => {
    for (const [id, entry] of Object.entries(summary.acceptance)) {
      if (entry.status !== 'PASS') continue;
      expect(entry.tests?.length, `${id} PASS must reference at least one test`).toBeGreaterThan(0);
      // A25 self-reference: this very file's committed JUnit is written by the
      // same run that executes this test, so a test can never validate its own
      // committed outcome (it would deadlock across runs). A25's refs are
      // validated against the committed junit by scripts/verify_evidence.py,
      // which runs after this file has been written green.
      if (id === 'A25') continue;
      const platforms = new Set(entry.tests?.map((t) => t.split('::')[0]) ?? []);
      for (const ref of entry.tests ?? []) {
        const { ok, why } = junitPassed(ref);
        expect(ok, `${id}: ${why}`).toBe(true);
      }
      // 'web' acceptance IDs (A01, A02, A03, A20) must be proven in BOTH engines.
      if (['A01', 'A02', 'A03', 'A20'].includes(id)) {
        const hasChromium = [...platforms].some((p) => p.includes('chromium'));
        const hasWebkit = [...platforms].some((p) => p.includes('webkit'));
        expect(hasChromium, `${id} needs a chromium JUnit reference`).toBe(true);
        expect(hasWebkit, `${id} needs a webkit JUnit reference`).toBe(true);
      }
    }
  });

  it('non-PASS entries carry notes, and referenced videos exist in the manifest', () => {
    for (const [id, entry] of Object.entries(summary.acceptance)) {
      if (entry.status !== 'PASS') {
        expect(entry.notes, `${id} (${entry.status}) must explain what was and was not done`).toBeTruthy();
      }
      for (const v of entry.videos ?? []) {
        const vid = v.replace(/^video:/, '');
        const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as {
          videos: { id: string; sha256: string; size_bytes: number; junit: string }[];
        };
        const rec = manifest.videos.find((x) => x.id === vid);
        expect(rec, `${id} references missing video ${vid}`).toBeDefined();
        if (rec) {
          expect(rec.sha256.length).toBe(64);
          expect(rec.size_bytes).toBeGreaterThan(0);
          const { ok, why } = junitPassed(rec.junit);
          expect(ok, `video ${vid}: ${why}`).toBe(true);
        }
      }
    }
  });

  it('records a source digest over the shipped source tree', () => {
    expect(summary.source_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(ROOT, 'src', 'main.tsx'))).toBe(true);
  });
});
