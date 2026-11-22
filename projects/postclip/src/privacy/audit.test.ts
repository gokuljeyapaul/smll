// @vitest-environment node
/**
 * Privacy audit helpers (S1, A15): the storage allow-list judgment over
 * real snapshots, the distinctive-token scan, and log redaction. The
 * seeded-leak negative control proves the audit is real, not trivially
 * empty; the browser-level audits run after every e2e flow.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CACHE_NAME_PATTERNS,
  auditStorageSnapshot,
  distinctiveTokens,
  redactText,
  type StorageSnapshot,
} from './audit';

const POST_TEXT =
  'Shipped our first offline-first release today.\nNo cloud, no accounts, just a local cache that never lies.';

const EMPTY_SNAPSHOT: StorageSnapshot = {
  localStorage: {},
  sessionStorage: {},
  indexedDatabaseNames: [],
  cacheNames: [],
  cookies: [],
  url: 'http://127.0.0.1:4173/',
  referrer: '',
};

const snapshotWith = (patch: Partial<StorageSnapshot>): StorageSnapshot => ({ ...EMPTY_SNAPSHOT, ...patch });

describe('distinctiveTokens (A15)', () => {
  it('keeps only >= 6-char non-stopword tokens, deduplicated and lowercased', () => {
    expect(distinctiveTokens('Shipped our first offline-first release today. #buildinpublic')).toEqual([
      'shipped',
      'offline-first',
      'release',
      'today.',
      'buildinpublic',
    ]);
  });

  it('is empty for stopword-only text', () => {
    expect(distinctiveTokens('the and with about because which would')).toEqual([]);
  });
});

describe('auditStorageSnapshot — allow-list judgment (A15)', () => {
  it('passes a genuinely empty snapshot', () => {
    const report = auditStorageSnapshot(EMPTY_SNAPSHOT, distinctiveTokens(POST_TEXT));
    expect(report.violations).toEqual([]);
  });

  it('flags post text in localStorage', () => {
    const report = auditStorageSnapshot(
      snapshotWith({ localStorage: { draft: POST_TEXT } }),
      distinctiveTokens(POST_TEXT),
    );
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.where.includes('localStorage'))).toBe(true);
  });

  it('flags ANY localStorage entry, even without post text (allow-list: none in S1)', () => {
    const report = auditStorageSnapshot(
      snapshotWith({ localStorage: { ui: 'dark' } }),
      distinctiveTokens(POST_TEXT),
    );
    expect(report.violations.some((v) => v.where.includes('localStorage'))).toBe(true);
  });

  it('flags post text in sessionStorage values', () => {
    const report = auditStorageSnapshot(
      snapshotWith({ sessionStorage: { tmp: 'just a local cache that never lies' } }),
      distinctiveTokens(POST_TEXT),
    );
    expect(report.violations.some((v) => v.where.includes('sessionStorage'))).toBe(true);
  });

  it('flags cookies', () => {
    const report = auditStorageSnapshot(
      snapshotWith({ cookies: ['session=abc123'] }),
      distinctiveTokens(POST_TEXT),
    );
    expect(report.violations.some((v) => v.where.includes('cookie'))).toBe(true);
  });

  it('allows only the app-shell precache and model cache names', () => {
    const allowed = auditStorageSnapshot(
      snapshotWith({ cacheNames: ['workbox-precache-v2-http://127.0.0.1:4173/'] }),
      [],
    );
    expect(allowed.violations.filter((v) => v.where.includes('cache'))).toEqual([]);
    const modelCache = auditStorageSnapshot(snapshotWith({ cacheNames: ['postclip-model'] }), []);
    expect(modelCache.violations.filter((v) => v.where.includes('cache'))).toEqual([]);
    const alien = auditStorageSnapshot(snapshotWith({ cacheNames: ['my-notes'] }), []);
    expect(alien.violations.some((v) => v.where.includes('cache'))).toBe(true);
    expect(ALLOWED_CACHE_NAME_PATTERNS.length).toBeGreaterThanOrEqual(2);
  });

  it('flags IndexedDB databases (no post-derived DB is allowed)', () => {
    const report = auditStorageSnapshot(
      snapshotWith({ indexedDatabaseNames: ['post-drafts'] }),
      distinctiveTokens(POST_TEXT),
    );
    expect(report.violations.some((v) => v.where.includes('IndexedDB'))).toBe(true);
  });

  it('records unavailable IndexedDB enumeration as a note, not a violation', () => {
    const report = auditStorageSnapshot(
      snapshotWith({ indexedDatabaseNames: null }),
      distinctiveTokens(POST_TEXT),
    );
    expect(report.violations).toEqual([]);
    expect(report.notes.join(' ')).toContain('IndexedDB');
  });

  it('flags post tokens in the URL and referrer', () => {
    const urlReport = auditStorageSnapshot(
      snapshotWith({ url: 'http://127.0.0.1:4173/?text=offline-first' }),
      distinctiveTokens(POST_TEXT),
    );
    expect(urlReport.violations.some((v) => v.where.includes('url'))).toBe(true);
    const refReport = auditStorageSnapshot(
      snapshotWith({ referrer: 'http://evil.example/shipped' }),
      distinctiveTokens(POST_TEXT),
    );
    expect(refReport.violations.some((v) => v.where.includes('referrer'))).toBe(true);
  });

  it('negative control: a seeded leak in every storage kind is detected', () => {
    const seeded = snapshotWith({
      localStorage: { leak: POST_TEXT },
      sessionStorage: { leak: 'never lies about offline-first caches' },
      cacheNames: ['leak-cache'],
      cookies: ['post=offline-first'],
      url: 'http://127.0.0.1:4173/#shipped',
      indexedDatabaseNames: ['offline-first-db'],
    });
    const report = auditStorageSnapshot(seeded, distinctiveTokens(POST_TEXT));
    const wheres = report.violations.map((v) => v.where);
    expect(wheres.some((w) => w.includes('localStorage'))).toBe(true);
    expect(wheres.some((w) => w.includes('sessionStorage'))).toBe(true);
    expect(wheres.some((w) => w.includes('cache'))).toBe(true);
    expect(wheres.some((w) => w.includes('cookie'))).toBe(true);
    expect(wheres.some((w) => w.includes('url'))).toBe(true);
    expect(wheres.some((w) => w.includes('IndexedDB'))).toBe(true);
  });
});

describe('redactText — log redaction (A15)', () => {
  it('replaces exact secret occurrences with [redacted]', () => {
    const message = `processing failed on input "No cloud, no accounts, just a local cache that never lies." at stage 2`;
    const redacted = redactText(message, [POST_TEXT]);
    expect(redacted).not.toContain('local cache');
    expect(redacted).toContain('[redacted]');
    expect(redacted).toContain('at stage 2');
  });

  it('replaces fragments of the secret (3+ consecutive words), not just the full text', () => {
    const redacted = redactText('error near: offline-first release today', [POST_TEXT]);
    expect(redacted).not.toContain('release today');
  });

  it('leaves messages that carry no secret text untouched', () => {
    expect(redactText('OCR engine failed to start', [POST_TEXT])).toBe('OCR engine failed to start');
  });
});
