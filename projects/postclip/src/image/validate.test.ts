// @vitest-environment node
/**
 * Image validation (S1, A07): the byte-level header sniff over REAL fixture
 * bytes, the error-class decisions, and the downscale plan. The real decode
 * path (createImageBitmap catching corrupt01.png) and the real downscale
 * are exercised end-to-end in e2e/uc11_bad_inputs.spec.ts in both engines.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ERROR_MESSAGES,
  MIN_IMAGE_DIM,
  MAX_OCR_SIDE,
  DOWNSCALE_NOTE,
  sniffImageHeader,
  planDownscale,
} from './validate';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

const bytes = (rel: string) => new Uint8Array(readFileSync(join(FIXTURES, rel)));

describe('sniffImageHeader over real fixture bytes (A07)', () => {
  it('reads PNG dimensions from a real fixture', () => {
    expect(sniffImageHeader(bytes('images/clean01.png'))).toEqual({ kind: 'png', width: 1184, height: 556 });
  });

  it('parses the corrupt fixture structurally (valid magic + IHDR; decode catches the truncation)', () => {
    expect(sniffImageHeader(bytes('images/corrupt01.png'))).toEqual({ kind: 'png', width: 1184, height: 1400 });
  });

  it('returns null for the non-image text file', () => {
    expect(sniffImageHeader(bytes('files/nonimage01.txt'))).toBeNull();
  });

  it('reads the tiny fixture as 64×64', () => {
    expect(sniffImageHeader(bytes('images/tiny01.png'))).toEqual({ kind: 'png', width: 64, height: 64 });
  });

  it('reads the huge fixture as >= 4000 px wide', () => {
    const header = sniffImageHeader(bytes('images/huge01.png'));
    expect(header?.kind).toBe('png');
    expect(header?.width).toBeGreaterThanOrEqual(4000);
  });

  it('parses JPEG, GIF, BMP and WebP headers from minimal real byte sequences', () => {
    // JPEG: SOI + SOF0 (height 120, width 240, big-endian)
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x00, 0xf0, 0x03, 0x01, 0x11, 0x00,
    ]);
    expect(sniffImageHeader(jpeg)).toEqual({ kind: 'jpeg', width: 240, height: 120 });
    // GIF87a, 10×20 little-endian
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x0a, 0x00, 0x14, 0x00]);
    expect(sniffImageHeader(gif)).toEqual({ kind: 'gif', width: 10, height: 20 });
    // BMP, width 8 @18, height 4 @22, little-endian
    const bmp = new Uint8Array(26);
    bmp[0] = 0x42;
    bmp[1] = 0x4d;
    bmp[18] = 8;
    bmp[22] = 4;
    expect(sniffImageHeader(bmp)).toEqual({ kind: 'bmp', width: 8, height: 4 });
    // WebP (extended): RIFF size + WEBP + VP8X, canvas 101×51 minus one → 100×50, 24-bit LE
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00,
      0x63, 0x00, 0x00, 0x31, 0x00, 0x00,
    ]);
    expect(sniffImageHeader(webp)).toEqual({ kind: 'webp', width: 100, height: 50 });
  });
});

describe('image error classes and messages (A07)', () => {
  it('has a distinct, specific, kind message per error code', () => {
    const messages = Object.values(ERROR_MESSAGES);
    expect(new Set(messages).size).toBe(messages.length);
    expect(ERROR_MESSAGES['non-image']).toContain('not');
    expect(ERROR_MESSAGES['non-image']).toContain('image');
    expect(ERROR_MESSAGES.corrupt).toContain('damaged');
    expect(ERROR_MESSAGES.tiny).toContain('too small');
    expect(String(MIN_IMAGE_DIM)).toBeTruthy();
  });

  it('downscale note is user-facing and mentions downsizing', () => {
    expect(DOWNSCALE_NOTE).toContain('downscaled');
  });
});

describe('planDownscale (A07)', () => {
  it('flags images over the OCR side limit and preserves aspect ratio', () => {
    const plan = planDownscale(4008, 684);
    expect(plan.needed).toBe(true);
    expect(plan.width).toBe(MAX_OCR_SIDE);
    expect(Math.abs(plan.width / plan.height - 4008 / 684)).toBeLessThan(0.01);
  });

  it('leaves normal screenshots untouched', () => {
    expect(planDownscale(1184, 556)).toEqual({ needed: false, width: 1184, height: 556 });
    expect(planDownscale(2600, 100)).toEqual({ needed: false, width: 2600, height: 100 });
  });
});
