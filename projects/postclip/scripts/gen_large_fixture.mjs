#!/usr/bin/env node
/**
 * Large-image eval fixture generator (S5 — A28 memory safety).
 *
 * Generates a DETERMINISTIC ~20 MB PNG (seeded LCG noise + a big readable
 * text band drawn with a built-in 5x7 bitmap font) into
 * .cache/large-fixtures/ (gitignored — committed fixtures stay under the
 * plan's size caps, <= 150 KB each / <= 6 MB total; this eval input is
 * generated at run time and is never committed).
 *
 * The text band matters: the ~20 MB case must go through the WHOLE pipeline
 * (decode -> downscale -> OCR -> language gate -> cleanup -> review), not
 * stop at the designed no-text error state — that is what "processed without
 * crash, hang or tab failure" means for a huge input.
 *
 * PNG: 8-bit RGBA, one IDAT, filter byte 0 per scanline, zlib deflate.
 * CRC32 implemented here (no external dependency).
 *
 * Usage: node scripts/gen_large_fixture.mjs [--out <path>] [--width 3600] [--height 2500]
 *        prints JSON: { path, width, height, size_bytes, sha256 } to stdout.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const WIDTH = arg('width', 3200);
const HEIGHT = arg('height', 1900);
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(ROOT, '.cache', 'large-fixtures', `large20mb-${WIDTH}x${HEIGHT}.png`);

/** CRC32 (PNG chunk checksums). */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Seeded LCG (Park-Miller) — deterministic bytes on every machine/run. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 48271) % 2147483647;
    return s;
  };
}

/** 5x7 bitmap font — only the glyphs the banner needs (kept honest and small). */
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const BANNER = 'POSTCLIP LARGE IMAGE MEMORY TEST 12345';
const GLYPH = 14; // each font pixel becomes GLYPH x GLYPH image pixels (~98px cap height)

function ihdr(width, height) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d[8] = 8; // bit depth
  d[9] = 6; // color type: RGBA
  d[10] = 0;
  d[11] = 0;
  d[12] = 0;
  return d;
}

function main() {
  const rand = lcg(20260523); // fixed seed: the fixture is reproducible
  const rowStride = WIDTH * 4 + 1; // +1 filter byte
  const raw = Buffer.alloc(rowStride * HEIGHT);

  // The text band: a light, nearly-clean strip across the middle that carries
  // the banner glyphs large enough to survive the app's downscale to
  // MAX_OCR_SIDE and still OCR cleanly.
  const bandTop = Math.floor(HEIGHT * 0.42);
  const bandBottom = bandTop + 7 * GLYPH + 2 * GLYPH;
  const textWidth = BANNER.length * 6 * GLYPH;
  const textLeft = Math.floor((WIDTH - textWidth) / 2);

  for (let y = 0; y < HEIGHT; y++) {
    const row = y * rowStride;
    raw[row] = 0; // filter: None
    const inBand = y >= bandTop && y < bandBottom;
    for (let x = 0; x < WIDTH; x++) {
      const o = row + 1 + x * 4;
      if (inBand && x >= textLeft - 2 * GLYPH && x < textLeft + textWidth + 2 * GLYPH) {
        // Inside the band: light background, high-contrast glyphs.
        raw[o] = 246 + (rand() % 8);
        raw[o + 1] = 246 + (rand() % 8);
        raw[o + 2] = 248 + (rand() % 7);
        raw[o + 3] = 255;
      } else {
        // Outside the band: full-range noise — effectively incompressible, so
        // the committed-size question never arises (the file is ~raw size).
        raw[o] = rand() % 256;
        raw[o + 1] = rand() % 256;
        raw[o + 2] = rand() % 256;
        raw[o + 3] = 255;
      }
    }
  }

  // Stamp the banner: dark pixels (18,18,20) over the light band.
  for (let i = 0; i < BANNER.length; i++) {
    const glyph = FONT[BANNER[i]];
    if (!glyph) throw new Error(`gen_large_fixture: no glyph for "${BANNER[i]}"`);
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < GLYPH; py++) {
          const y = bandTop + GLYPH + gy * GLYPH + py;
          const row = y * rowStride;
          for (let px = 0; px < GLYPH; px++) {
            const x = textLeft + i * 6 * GLYPH + gx * GLYPH + px;
            const o = row + 1 + x * 4;
            raw[o] = 18;
            raw[o + 1] = 18;
            raw[o + 2] = 20;
          }
        }
      }
    }
  }

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr(WIDTH, HEIGHT)),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, png);
  const result = {
    path: OUT,
    width: WIDTH,
    height: HEIGHT,
    size_bytes: statSync(OUT).size,
    sha256: createHash('sha256').update(png).digest('hex'),
    banner: BANNER,
  };
  console.log(JSON.stringify(result));
}

main();
