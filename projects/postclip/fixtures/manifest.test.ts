// @vitest-environment node
/**
 * Fixture manifest lint (A31): every committed fixture is synthetic, small,
 * hashed in the manifest, and carries a gold JSON with the fields its kind
 * requires. No stray files without manifest entries.
 *
 * S1: the lint evolves with the fixture set (10 → 25): German/Spanish
 * language fixtures (gold.language de/es), the bad-input fixtures (blank,
 * tiny, corrupt, non-image — empty body/ocr_expected plus an
 * `expected_error` the app must produce), the ≥ 4000 px huge render, and
 * the variant set (emoji, long post, low contrast, slight blur, heavy
 * chrome). Non-PNG committed files (the .txt non-image fixture, and a .jpg
 * if the generator's JPEG fallback ever fires) are covered by the same
 * hash/size/synthetic checks.
 *
 * S4: the set grows to 40 (plan "Fixtures and metrics": variants ≥ 40 by
 * S4): the ≥ 5 injection posts (gold.injection.markers — the attacker
 * strings that must never appear in the model's metadata fields, A16), the
 * non-text photo (a CSS-rendered dusk scene with no text → the no-text
 * error), slight rotation, tiny text, plus more of the named families.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(FIXTURES_DIR, 'manifest.json');
const IMAGES_DIR = join(FIXTURES_DIR, 'images');
const FILES_DIR = join(FIXTURES_DIR, 'files');
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

interface Gold {
  id: string;
  kind: string;
  author: string;
  language: string;
  body: string[];
  chrome: string[];
  ocr_expected: string[];
  expected_error?: string;
  injection?: { markers: string[] };
  nested_image_text?: string[];
}

const ALL_IDS = [
  // S0
  'clean01', 'clean02', 'clean03', 'clean04', 'clean05', 'clean06',
  'dark01', 'dark02', 'chrome01', 'chrome02',
  // S1 language fixtures
  'de01', 'de02', 'de03', 'es01', 'es02',
  // S1 variants
  'emoji01', 'longpost01', 'lowcontrast01', 'blur01', 'huge01', 'heavychrome01',
  // S1 bad inputs
  'blank01', 'tiny01', 'corrupt01', 'nonimage01',
  // S4 variants (plan "Fixtures and metrics": >= 40 by S4)
  'clean07', 'clean08', 'dark03',
  'emoji02', 'longpost02', 'lowcontrast02', 'heavychrome02',
  'rotate01', 'tinytext01',
  // S4 bad-input variant: a real non-text photo
  'photo01',
  // S4 injection posts (>= 5, A16)
  'inj01', 'inj02', 'inj03', 'inj04', 'inj05',
  // R2-1 nested-text fixtures (A35, plan UC16): text inside pictures
  'nested01', 'nested02', 'nested03',
];

const BAD_INPUT_KINDS: Record<string, string> = {
  blank: 'no-text',
  tiny: 'tiny',
  corrupt: 'corrupt',
  'non-image': 'non-image',
  photo: 'no-text',
};

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function manifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { schema: string; synthetic: boolean; images: ManifestEntry[] };
}

describe('fixture manifest lint (A31)', () => {
  it('has a manifest.json flagged synthetic', () => {
    expect(existsSync(MANIFEST), 'fixtures/manifest.json must exist').toBe(true);
    const m = manifest();
    expect(m.synthetic).toBe(true);
    expect(m.schema).toBe('postclip-fixtures/1');
  });

  it('lists exactly the 43 fixtures (S4: >= 40; R2-1 adds the 3 nested-text fixtures)', () => {
    const m = manifest();
    expect(m.images.map((e) => e.id).sort()).toEqual([...ALL_IDS].sort());
    expect(m.images.length, 'fixture count').toBeGreaterThanOrEqual(40);
  });

  it('every fixture file exists, matches its sha256, is small, and is flagged synthetic', () => {
    for (const entry of manifest().images) {
      const path = join(FIXTURES_DIR, entry.file);
      expect(existsSync(path), `missing file ${entry.file}`).toBe(true);
      expect(entry.synthetic, `${entry.id} must be flagged synthetic`).toBe(true);
      expect(entry.sha256, `${entry.id} sha256 must match the file`).toBe(sha256(path));
      const size = statSync(path).size;
      expect(entry.size_bytes, `${entry.id} manifest size must match`).toBe(size);
      expect(size, `${entry.id} must stay under 150 KB`).toBeLessThanOrEqual(MAX_BYTES);
    }
  });

  it('total committed fixture bytes stay under 6 MB', () => {
    const total = manifest().images.reduce((sum, entry) => sum + statSync(join(FIXTURES_DIR, entry.file)).size, 0);
    console.log(`fixture bytes total: ${total}`);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL);
  });

  it('every entry has a gold JSON with the fields its kind requires', () => {
    for (const entry of manifest().images) {
      const goldPath = join(FIXTURES_DIR, entry.gold);
      expect(existsSync(goldPath), `missing gold ${entry.gold}`).toBe(true);
      const gold = JSON.parse(readFileSync(goldPath, 'utf-8')) as Gold;
      expect(gold.id, `${entry.id} gold id`).toBe(entry.id);
      expect(typeof gold.kind, `${entry.id} kind`).toBe('string');
      expect(typeof gold.author, `${entry.id} author`).toBe('string');
      expect(Array.isArray(gold.body), `${entry.id} body`).toBe(true);
      expect(Array.isArray(gold.chrome), `${entry.id} chrome`).toBe(true);
      expect(Array.isArray(gold.ocr_expected), `${entry.id} ocr_expected`).toBe(true);
      const expectedError = BAD_INPUT_KINDS[gold.kind];
      if (expectedError) {
        // bad-input fixtures: nothing readable, and the app must error with it
        expect(gold.expected_error, `${entry.id} expected_error`).toBe(expectedError);
        expect(gold.language, `${entry.id} language`).toBe('none');
        expect(gold.body, `${entry.id} body must be empty`).toEqual([]);
        expect(gold.ocr_expected, `${entry.id} ocr_expected must be empty`).toEqual([]);
        expect(gold.chrome, `${entry.id} chrome must be empty`).toEqual([]);
      } else {
        // readable fixtures: language matches the kind family, body is real text
        expect(gold.expected_error, `${entry.id} must not declare an error`).toBeUndefined();
        expect(['en', 'de', 'es'].includes(gold.language), `${entry.id} language`).toBe(true);
        if (gold.kind === 'lang-de') expect(gold.language).toBe('de');
        if (gold.kind === 'lang-es') expect(gold.language).toBe('es');
        expect(gold.body.length, `${entry.id} body must be non-empty`).toBeGreaterThan(0);
        expect(gold.ocr_expected.length, `${entry.id} ocr_expected must be non-empty`).toBeGreaterThan(0);
        expect(gold.author.length, `${entry.id} author must be non-empty`).toBeGreaterThan(0);
        // R2-1 (A35): nested-text fixtures commit the recall ground truth —
        // every nested line is content (in the body) AND in `nested_image_text`.
        if (gold.kind === 'nested') {
          expect(Array.isArray(gold.nested_image_text), `${entry.id} nested_image_text`).toBe(true);
          const nested = (gold.nested_image_text ?? []) as string[];
          expect(nested.length, `${entry.id} nested_image_text must be non-empty`).toBeGreaterThan(0);
          for (const line of nested) {
            expect(gold.body, `${entry.id} nested line is content`).toContain(line);
            expect(gold.ocr_expected, `${entry.id} nested line is visible text`).toContain(line);
          }
        } else {
          expect(gold.nested_image_text, `${entry.id} non-nested must not claim nested text`).toBeUndefined();
        }
      }
      expect(gold.language, `${entry.id} language must match kind family`).toBe(
        gold.kind === 'lang-de' ? 'de' : gold.kind === 'lang-es' ? 'es' : expectedError ? 'none' : 'en',
      );
    }
  });

  it('the fixture families the plan names for S1 and S4 are all present', () => {
    const kinds = new Set(manifest().images.map((e) => (JSON.parse(readFileSync(join(FIXTURES_DIR, e.gold), 'utf-8')) as Gold).kind));
    for (const kind of [
      // S1 families
      'clean', 'dark', 'chrome', 'lang-de', 'lang-es', 'emoji', 'longpost', 'lowcontrast', 'blur', 'huge', 'heavychrome', 'blank', 'tiny', 'corrupt', 'non-image',
      // S4 families (plan "Fixtures and metrics", >= 40 by S4)
      'rotation', 'tinytext', 'photo', 'injection',
    ]) {
      expect(kinds.has(kind), `fixture family ${kind} must be present`).toBe(true);
    }
  });

  it('has >= 5 injection fixtures, each with attacker markers and instruction text as content (A16)', () => {
    const injectionGold = manifest().images
      .map((e) => JSON.parse(readFileSync(join(FIXTURES_DIR, e.gold), 'utf-8')) as Gold)
      .filter((g) => g.kind === 'injection');
    expect(injectionGold.length, 'at least 5 injection fixtures').toBeGreaterThanOrEqual(5);
    for (const gold of injectionGold) {
      expect(gold.injection, `${gold.id} must record injection markers`).toBeDefined();
      expect(gold.injection!.markers.length, `${gold.id} needs at least one marker`).toBeGreaterThan(0);
      for (const marker of gold.injection!.markers) {
        expect(typeof marker, `${gold.id} marker must be a string`).toBe('string');
        // The marker is post CONTENT: it must appear in the expected OCR
        // text (so the guard's body-faithfulness must keep it there).
        expect(
          gold.body.some((line) => line.includes(marker)),
          `${gold.id} marker ${marker} must appear in the gold body (it is content)`,
        ).toBe(true);
        expect(
          gold.language, `${gold.id} stays an English readable post`,
        ).toBe('en');
      }
    }
  });

  it('the huge fixture is >= 4000 px on its longest side', () => {
    const entry = manifest().images.find((e) => e.id === 'huge01');
    expect(entry).toBeDefined();
    const buf = readFileSync(join(FIXTURES_DIR, entry!.file));
    // PNG IHDR (the S1 generator writes the huge render as PNG)
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    expect(Math.max(width, height), `huge01 is ${width}x${height}`).toBeGreaterThanOrEqual(4000);
  });

  it('the corrupt fixture carries a PNG magic but is not a decodable image', () => {
    const buf = readFileSync(join(FIXTURES_DIR, 'images/corrupt01.png'));
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(buf.includes(Buffer.from('IDAT'))).toBe(false);
  });

  it('no stray fixture files without a manifest entry', () => {
    const listed = new Set(manifest().images.map((entry) => entry.file));
    const imageFiles = readdirSync(IMAGES_DIR).filter((f) => /\.(png|jpe?g)$/.test(f));
    for (const file of imageFiles) {
      expect(listed.has(`images/${file}`), `stray image images/${file}`).toBe(true);
    }
    if (existsSync(FILES_DIR)) {
      for (const file of readdirSync(FILES_DIR)) {
        expect(listed.has(`files/${file}`), `stray file files/${file}`).toBe(true);
      }
    }
    expect(existsSync(GOLD_DIR), 'gold dir must exist').toBe(true);
  });

  it('every gold JSON on disk belongs to a manifest entry', () => {
    const listed = new Set(manifest().images.map((entry) => entry.gold));
    for (const file of readdirSync(GOLD_DIR)) {
      expect(listed.has(`gold/${file}`), `stray gold gold/${file}`).toBe(true);
    }
  });
});
