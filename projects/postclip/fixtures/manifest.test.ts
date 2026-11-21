// @vitest-environment node
/**
 * Fixture manifest lint (A31): every committed fixture image is synthetic,
 * small, hashed in the manifest, and carries a gold JSON with the required
 * fields. No stray images without manifest entries.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(FIXTURES_DIR, 'manifest.json');
const IMAGES_DIR = join(FIXTURES_DIR, 'images');
const GOLD_DIR = join(FIXTURES_DIR, 'gold');
const MAX_BYTES = 150 * 1024;
const MAX_TOTAL = 6 * 1024 * 1024;

interface ManifestEntry {
  id: string;
  file: string;
  sha256: string;
  size_bytes: number;
  synthetic: boolean;
  gold: string;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('fixture manifest lint (A31)', () => {
  it('has a manifest.json', () => {
    expect(existsSync(MANIFEST), 'fixtures/manifest.json must exist').toBe(true);
  });

  it('lists at least the 10 S0 fixtures', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { images: ManifestEntry[] };
    expect(manifest.images.length).toBeGreaterThanOrEqual(10);
  });

  it('every image file exists, matches its sha256, is small, and is flagged synthetic', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { images: ManifestEntry[] };
    for (const entry of manifest.images) {
      const imagePath = join(FIXTURES_DIR, entry.file);
      expect(existsSync(imagePath), `missing image ${entry.file}`).toBe(true);
      expect(entry.synthetic, `${entry.id} must be flagged synthetic`).toBe(true);
      expect(entry.sha256, `${entry.id} sha256 must match the file`).toBe(sha256(imagePath));
      const size = statSync(imagePath).size;
      expect(entry.size_bytes, `${entry.id} manifest size must match`).toBe(size);
      expect(size, `${entry.id} must stay under 150 KB`).toBeLessThanOrEqual(MAX_BYTES);
    }
  });

  it('total committed fixture bytes stay under 6 MB', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { images: ManifestEntry[] };
    const total = manifest.images.reduce(
      (sum, entry) => sum + statSync(join(FIXTURES_DIR, entry.file)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(MAX_TOTAL);
  });

  it('every entry has a gold JSON with the required fields', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { images: ManifestEntry[] };
    for (const entry of manifest.images) {
      const goldPath = join(FIXTURES_DIR, entry.gold);
      expect(existsSync(goldPath), `missing gold ${entry.gold}`).toBe(true);
      const gold = JSON.parse(readFileSync(goldPath, 'utf-8')) as Record<string, unknown>;
      expect(Array.isArray(gold.ocr_expected), `${entry.id} ocr_expected`).toBe(true);
      expect(Array.isArray(gold.body), `${entry.id} body`).toBe(true);
      expect(Array.isArray(gold.chrome), `${entry.id} chrome`).toBe(true);
      expect(typeof gold.author, `${entry.id} author`).toBe('string');
      expect(gold.language, `${entry.id} language`).toBe('en');
      expect(typeof gold.kind, `${entry.id} kind`).toBe('string');
    }
  });

  it('no stray images without a manifest entry', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { images: ManifestEntry[] };
    const listed = new Set(manifest.images.map((entry) => entry.file));
    const onDisk = readdirSync(IMAGES_DIR).filter((f) => f.endsWith('.png'));
    for (const file of onDisk) {
      expect(listed.has(`images/${file}`), `stray image images/${file}`).toBe(true);
    }
    expect(existsSync(GOLD_DIR), 'gold dir must exist').toBe(true);
  });
});
