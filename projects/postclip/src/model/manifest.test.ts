// @vitest-environment node
/**
 * Pinned-model manifest unit tests (S3): the manifest is real recorded data
 * — repo + revision + URL + sha256 + size + license all pinned and mutually
 * consistent, the cache name is on the A15 storage allow-list, and the
 * test-only flag parsing accepts exactly http(s) URLs (never other schemes).
 */
import { describe, expect, it } from 'vitest';
import { ALLOWED_CACHE_NAME_PATTERNS } from '../privacy/audit';
import {
  MODEL_CACHE_NAME,
  PINNED_MODEL,
  modelUrl,
  parseTestFlags,
} from './manifest';

describe('PINNED_MODEL manifest invariants (S3)', () => {
  it('pins repo, revision, url, sha256 and size consistently', () => {
    expect(PINNED_MODEL.repo).toBe('unsloth/Qwen3-0.6B-GGUF');
    expect(PINNED_MODEL.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(PINNED_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PINNED_MODEL.sizeBytes).toBe(396705472); // the recorded size: hundreds of MB, not multi-GB
    expect(PINNED_MODEL.url).toBe(
      `https://huggingface.co/${PINNED_MODEL.repo}/resolve/${PINNED_MODEL.revision}/${PINNED_MODEL.filename}`,
    );
    expect(PINNED_MODEL.format).toBe('gguf');
  });

  it('records the license (plan D5: license recorded for the pinned candidate)', () => {
    expect(PINNED_MODEL.license).toBe('Apache-2.0');
    expect(PINNED_MODEL.licenseUrl).toMatch(/^https:\/\//);
    expect(PINNED_MODEL.licenseNote.length).toBeGreaterThan(20);
  });

  it('the model cache name is on the A15 storage allow-list', () => {
    expect(MODEL_CACHE_NAME).toBe('postclip-model-v1');
    expect(ALLOWED_CACHE_NAME_PATTERNS.some((p) => p.test(MODEL_CACHE_NAME))).toBe(true);
  });

  it('modelUrl() is the pinned production URL when no test override applies', () => {
    expect(modelUrl()).toBe(PINNED_MODEL.url);
  });
});

describe('parseTestFlags — test-only overrides (S3, A29)', () => {
  it('parses an http(s) test model URL', () => {
    expect(parseTestFlags('?testModelUrl=http://127.0.0.1:4599/model')).toEqual({
      modelUrl: 'http://127.0.0.1:4599/model',
      forceUnsupported: false,
      storage: null,
    });
    expect(parseTestFlags('?testModelUrl=https://example.test/x.gguf').modelUrl).toBe(
      'https://example.test/x.gguf',
    );
  });

  it('rejects non-http schemes and malformed URLs (fail closed)', () => {
    expect(parseTestFlags('?testModelUrl=javascript:alert(1)').modelUrl).toBeNull();
    expect(parseTestFlags('?testModelUrl=not a url').modelUrl).toBeNull();
    expect(parseTestFlags('').modelUrl).toBeNull();
  });

  it('parses the unsupported-probe override', () => {
    expect(parseTestFlags('?testProbe=unsupported').forceUnsupported).toBe(true);
    expect(parseTestFlags('?testProbe=other').forceUnsupported).toBe(false);
    expect(parseTestFlags('').forceUnsupported).toBe(false);
  });

  it('R2-3: parses the storage-scenario override (volatile | no-room), rejecting anything else', () => {
    expect(parseTestFlags('?testStorage=volatile').storage).toBe('volatile');
    expect(parseTestFlags('?testStorage=no-room').storage).toBe('no-room');
    expect(parseTestFlags('?testStorage=other').storage).toBeNull();
    expect(parseTestFlags('').storage).toBeNull();
  });
});
