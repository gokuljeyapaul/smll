// @vitest-environment node
/**
 * Audit deps (A26, host, S6 tree): the committed
 * docs/evidence/S6/license_inventory.json — produced by
 * scripts/audit_deps.mjs from the real installed tree (npm ls) — is
 * re-checked here: every package carries a resolvable license; no
 * analytics/telemetry SDK in the inventory; the production CSP allows
 * only same-origin plus the pinned model host; the model pin is
 * well-formed and the cached weights (when present) byte-verify against
 * it. The audit's own ability to detect violations is proven separately
 * by scripts/audit_deps.mjs --seed-violation (the negative control in
 * docs/evidence/S6/red.log).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROD_CSP, PINNED_MODEL_HOST } from '../../scripts/csp-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INVENTORY = join(ROOT, 'docs/evidence/S6/license_inventory.json');

interface Inventory {
  package_count: number;
  packages: { name: string; version: string; license: string; licenseSource: string }[];
  telemetry_dependency_hits: string[];
  production_csp: { connect_src_remote: string[]; pinned_model_host: string; problems: string[] };
  pinned_model: {
    repo: string; revision: string; filename: string; url: string;
    sha256: string; sizeBytes: number; license: string; licenseUrl: string;
    cached_weights: { present?: boolean; sha256?: string; sizeBytes?: number };
  };
  violations: string[];
}

const inventory = JSON.parse(readFileSync(INVENTORY, 'utf-8')) as Inventory;

/** Read the pinned model from the committed single source of truth. */
const manifestSrc = readFileSync(join(ROOT, 'src/model/manifest.ts'), 'utf-8');
const field = (name: string) => manifestSrc.match(new RegExp(`\\b${name}:\\s*'([^']+)'`))?.[1] ?? '';
const pinned = {
  revision: field('revision'),
  sha256: field('sha256'),
  url: field('url'),
  filename: field('filename'),
  repo: field('repo'),
};

describe('audit deps (A26, S6)', () => {
  it('the committed license inventory covers every installed package with a resolvable license', () => {
    expect(inventory.packages.length).toBeGreaterThan(0);
    expect(inventory.package_count).toBe(inventory.packages.length);
    const unlicensed = inventory.packages.filter((p) => !p.license || p.license === 'UNKNOWN');
    expect(unlicensed, `no license: ${unlicensed.map((p) => `${p.name}@${p.version}`).join(', ')}`).toEqual([]);
  });

  it('no analytics/telemetry SDK anywhere in the dependency inventory', () => {
    expect(inventory.telemetry_dependency_hits).toEqual([]);
    expect(inventory.violations).toEqual([]);
  });

  it('the production CSP allows only same-origin plus the pinned model host', () => {
    expect(inventory.production_csp.pinned_model_host).toBe(PINNED_MODEL_HOST);
    expect(inventory.production_csp.connect_src_remote).toEqual([PINNED_MODEL_HOST]);
    expect(inventory.production_csp.problems).toEqual([]);
    // And the CSP this inventory was audited against is the shipped one.
    expect(PROD_CSP).toContain(`connect-src 'self' ${PINNED_MODEL_HOST}`);
  });

  it('the model pin is well-formed and the cached weights byte-verify against it', () => {
    const m = inventory.pinned_model;
    expect(m.repo).toBe(pinned.repo);
    expect(m.revision).toBe(pinned.revision);
    expect(m.sha256).toBe(pinned.sha256);
    expect(m.revision).toMatch(/^[0-9a-f]{40}$/); // a commit SHA, never a moving branch
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.url).toBe(`${PINNED_MODEL_HOST}/${m.repo}/resolve/${m.revision}/${m.filename}`);
    expect(new URL(m.url).origin).toBe(PINNED_MODEL_HOST); // matches the CSP's one allowed host
    expect(m.license.length).toBeGreaterThan(0); // the model's license is recorded
    expect(m.licenseUrl.length).toBeGreaterThan(0);
    expect(m.sizeBytes).toBeGreaterThan(0);
    const cached = join(ROOT, '.cache/models', m.filename);
    if (existsSync(cached)) {
      const bytes = readFileSync(cached);
      expect(bytes.length).toBe(m.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(m.sha256);
    }
  });
});
