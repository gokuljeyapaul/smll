// @vitest-environment node
/**
 * A29 (host): the committed bundle-inspection EVIDENCE is what it claims —
 * the production inspection came back CLEAN (no test hooks, no eval, the
 * strict CSP verbatim) and the test-build negative control TRIPPED on the
 * hooks (proving the detector detects). These artifacts are produced by
 * scripts/inspect_bundle.mjs in the slice's final evidence run
 * (scripts/run_s5_final_evidence.sh) and committed under
 * docs/evidence/S5/. The live bundle check itself runs in CI via
 * scripts/test.sh after `npm run test:e2e:prod` builds the production dist.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROD_REPORT = join(ROOT, 'docs/evidence/S5/bundle-inspection.txt');
const TEST_REPORT = join(ROOT, 'docs/evidence/S5/bundle-inspection-test-build.txt');

describe('bundle inspection evidence (A29)', () => {
  it('the committed PRODUCTION inspection is CLEAN: no test hooks, no eval, strict CSP verbatim', () => {
    expect(existsSync(PROD_REPORT), 'docs/evidence/S5/bundle-inspection.txt must be committed').toBe(true);
    const report = readFileSync(PROD_REPORT, 'utf-8');
    expect(report).toContain('PRODUCTION BUNDLE: CLEAN');
    expect(report).toContain('CSP meta: matches the expected policy verbatim');
    expect(report, 'no TEST HOOK FIND lines in the clean production report').not.toContain('TEST HOOK FOUND');
    expect(report).not.toContain('PROBLEM:');
  });

  it('the committed TEST-BUILD negative control TRIPPED on the hooks (the detector detects)', () => {
    expect(existsSync(TEST_REPORT), 'docs/evidence/S5/bundle-inspection-test-build.txt must be committed').toBe(true);
    const report = readFileSync(TEST_REPORT, 'utf-8');
    expect(report).toContain('TEST-BUILD CONTROL: detector works');
    // Every build-time-gated hook marker the S3/S4 slices introduced must
    // be present in a test build and therefore found by the detector.
    for (const marker of ['__postclipLlmDebug', 'testModelUrl', 'testProbe']) {
      expect(report, `the test build must contain (and the detector must find) "${marker}"`).toContain(marker);
    }
    expect(report, 'the test build carries the TEST CSP (its one extra connect-src origin)').toContain(
      'http://127.0.0.1:4599',
    );
  });
});
